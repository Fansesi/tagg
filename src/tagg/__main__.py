#!/usr/bin/env python3
"""
Dependency-free tagg CLI using a JEV (Joint Evaluation & Verification)
decision model against a local llama.cpp server endpoint.
"""

import argparse
import json
import logging
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def setup_logger(
    name: str = "app",
    level: str = "INFO",
    log_file: str | None = None,
) -> logging.Logger:
    """Configures and returns a standardized logger instance.

    Args:
        name: Hierarchy name for the logger.
        level: Minimum threshold level ('DEBUG', 'INFO', 'WARNING', 'ERROR').
        log_file: Optional path to append logs to a file.
    """
    logger = logging.getLogger(name)

    # Normalize log level string to logging constant
    log_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(log_level)

    # Prevent duplicate handlers if called multiple times
    if logger.hasHandlers():
        logger.handlers.clear()

    # Log format: [Timestamp] [LEVEL] [module:line] - Message
    formatter = logging.Formatter(
        fmt="[%(asctime)s] [%(levelname)-7s] [%(name)s:%(lineno)d] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Keep stdout reserved for the final machine-readable result.
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # Optional file handler
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    # Do not propagate to root logger to avoid duplicate prints
    logger.propagate = False

    return logger


def curate_json_schema(
    model: str, content: str, tags: list[str]
) -> dict[str, Any]:
    """Returns a JSON schema to constrain llama.cpp output."""
    return {
        "model": model,
        "state": content,
        "questions": {
            "tag": {
                "type": "choice",
                # TODO(burak): Maybe inside a config too?
                "instructions": "Given the file contents, which tag is the most appropriate one?",
                "criteria": {k: None for k in tags},
            }
        },
    }


def query_endpoint(
    url: str,
    schema: dict[str, Any],
    timeout: int = 60,
) -> dict[str, Any]:
    """Sends the payload to the /v1/systemone endpoint via urllib."""
    data = json.dumps(schema).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw_body = response.read().decode("utf-8")
        return json.loads(raw_body)


def filter_tags(
    api_response: dict[str, Any], max_n: int = 1, threshold: float = 0.3
) -> dict[str, Any]:
    probs = api_response["answers"]["tag"]["probabilities"]
    logger.debug(f"Probs for each tag:\n{probs}")
    keys = sorted(probs, key=lambda x: probs[x], reverse=True)
    logger.debug(f"Sorted probs:\n{keys}")

    if len(keys) > max_n:
        keys = keys[:max_n]

    keys = [
        key
        for key in keys
        if probs.get(key) is not None and probs[key] >= threshold
    ]

    return {"tags": keys}


def read_file_excerpt(path: Path, max_bytes: int) -> str:
    """Reads file text safely up to max_bytes."""
    with path.open("rb") as f:
        raw = f.read(max_bytes)
    return raw.decode("utf-8", errors="replace")


def wait_for_server(
    url: str = "http://127.0.0.1:9931/health",
    timeout: float = 60.0,
    interval: float = 0.5,
) -> bool:
    """Polls the /health endpoint until it returns HTTP 200 or times out."""
    start_time = time.monotonic()

    while time.monotonic() - start_time < timeout:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "healthcheck"}
            )
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except urllib.error.URLError, TimeoutError, ConnectionRefusedError:
            # Server is either not up yet or returned 503 (loading)
            pass

        time.sleep(interval)

    return False


def start_server(
    model: str, endpoint_url: str
) -> subprocess.Popen[bytes] | None:
    cmd = ["llama", "serve", "-hf", model]
    proc = subprocess.Popen(cmd)
    health_url = (
        endpoint_url.split("/v1/", maxsplit=1)[0].rstrip("/") + "/health"
    )
    logger.debug("Waiting for llama.cpp server to initialize...")
    if wait_for_server(health_url, timeout=90):
        logger.debug("Server is healthy and ready for inference.")
        return proc

    logger.debug("Timeout reached: server failed to report healthy.")
    proc.terminate()
    proc.wait()
    return None


def infer_tags(
    model: str,
    content: str,
    candidate_tags: list[str],
    url: str,
    num_tags: int,
    threshold: float,
    ask_separately: bool,
) -> dict[str, Any]:
    if not ask_separately:
        schema = curate_json_schema(model, content, candidate_tags)
        return filter_tags(query_endpoint(url, schema), num_tags, threshold)

    remaining = list(candidate_tags)
    selected: list[str] = []
    for _ in range(num_tags):
        if not remaining:
            break
        schema = curate_json_schema(model, content, remaining)
        tags = filter_tags(query_endpoint(url, schema), 1, threshold)["tags"]
        if not tags:
            break
        selected.append(tags[0])
        remaining.remove(tags[0])
    return {"tags": selected}


def emit_progress(path: Path, completed: int, total: int) -> None:
    print(
        json.dumps(
            {
                "event": "progress",
                "path": str(path),
                "completed": completed,
                "total": total,
            }
        ),
        file=sys.stderr,
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Auto-tag files using a JEV decision model and a llama.cpp server."
    )
    parser.add_argument(
        "-p",
        "--paths",
        nargs="+",
        required=True,
        type=Path,
        help="List of file paths to evaluate.",
    )
    parser.add_argument(
        "-t",
        "--tags",
        nargs="+",
        required=True,
        help="List of candidate tags.",
    )
    parser.add_argument(
        "-u",
        "--url",
        default="http://127.0.0.1:9931/v1/systemone",
        help="Target llama.cpp endpoint URL (default: http://127.0.0.1:9931/v1/systemone).",
    )
    parser.add_argument(
        "-m",
        "--max-bytes",
        type=int,
        default=16384,
        help="Maximum bytes to read per file (default: 16384).",
    )
    parser.add_argument(
        "-n",
        "--num-tags-per-file",
        type=int,
        default=1,
        help="Number of tags to deduce for each file.",
    )
    parser.add_argument(
        "-th",
        "--threshold",
        type=float,
        default=0.1,
        help="Minimum threshold for selected tags.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable logs. Default filters out every logging so that we output a "
        "ready to use json schema that can be piped etc.",
    )
    parser.add_argument(
        "--log-file",
        type=str,
        default=None,
        help="Optional path to write logs to disk.",
    )
    parser.add_argument(
        "--save-file",
        type=str,
        default=None,
        help="Optional path to write the outputs to.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="model",
        help="Model name. Can be used to start the server. Optional if you start the llama server with a single model.",
    )
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="Start the server as follows: llama serve -hf [MODEL].",
    )
    parser.add_argument(
        "--ask-separately",
        action="store_true",
        help="TODO: for a single file, ask --num-tags-per-file many times "
        "each time removing the most confident tag.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    log_level = "DEBUG" if args.verbose else "INFO"
    global logger
    logger = setup_logger("tagg", level=log_level, log_file=args.log_file)

    server_process = None
    if args.start_server:
        server_process = start_server(args.model, args.url)
        if server_process is None:
            return 1

    results: dict[str, dict[str, Any]] = {}
    total = len(args.paths)
    try:
        for completed, path in enumerate(args.paths, start=1):
            if not path.is_file():
                logger.debug(f"Skipping invalid file: {path}")
                results[str(path)] = {
                    "error": "File not found or is a directory."
                }
                emit_progress(path, completed, total)
                continue

            try:
                content = read_file_excerpt(path, args.max_bytes)
                results[str(path)] = infer_tags(
                    args.model,
                    content,
                    args.tags,
                    args.url,
                    args.num_tags_per_file,
                    args.threshold,
                    args.ask_separately,
                )
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="replace")
                logger.debug(f"[HTTP {e.code}] {path}: {err_body}")
                results[str(path)] = {"error": f"HTTP {e.code}"}
            except urllib.error.URLError as e:
                logger.debug(f"[NETWORK ERROR] {path}: {e.reason}")
                results[str(path)] = {"error": str(e.reason)}
            except (json.JSONDecodeError, ValueError) as e:
                logger.debug(f"[PARSE ERROR] {path}: {e}")
                results[str(path)] = {"error": "Malformed JSON from model"}
            except Exception as e:
                logger.debug(f"[ERROR] {path}: {e}")
                results[str(path)] = {"error": str(e)}
            finally:
                emit_progress(path, completed, total)
    finally:
        if server_process is not None and server_process.poll() is None:
            server_process.terminate()
            server_process.wait()

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
