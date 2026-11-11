"""Thunderbird native-messaging protocol for the tagg host."""

import json
import struct
import sys
from typing import Any, BinaryIO

from .core import format_inference_error, infer_tags

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 8 * 1024 * 1024


def _read_exact(stream: BinaryIO, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message(stream: BinaryIO) -> dict[str, Any] | None:
    """Read one Thunderbird native-messaging frame, or None at clean EOF."""
    header = _read_exact(stream, 4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("Truncated native-messaging header")
    length = struct.unpack("<I", header)[0]
    if length > MAX_MESSAGE_BYTES:
        raise ValueError("Native-messaging message is too large")
    payload = _read_exact(stream, length)
    if len(payload) != length:
        raise ValueError("Truncated native-messaging payload")
    message = json.loads(payload.decode("utf-8"))
    if not isinstance(message, dict):
        raise ValueError("Native-messaging message must be a JSON object")
    return message


def write_message(stream: BinaryIO, message: dict[str, Any]) -> None:
    """Write one JSON object using Thunderbird's native-messaging framing."""
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise ValueError("Native-messaging response is too large")
    stream.write(struct.pack("<I", len(payload)))
    stream.write(payload)
    stream.flush()


def _validate_request(
    request: dict[str, Any],
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    if request.get("version") != PROTOCOL_VERSION:
        raise ValueError(
            f"Unsupported protocol version: {request.get('version')!r}"
        )

    messages = request.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty list")
    validated_messages: list[dict[str, str]] = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("each message must be an object")
        message_id = message.get("id")
        content = message.get("content")
        if not isinstance(message_id, str) or not message_id:
            raise ValueError("each message requires a non-empty string id")
        if not isinstance(content, str):
            raise ValueError("each message requires string content")
        validated_messages.append({"id": message_id, "content": content})

    tags = request.get("tags")
    if (
        not isinstance(tags, list)
        or not tags
        or not all(isinstance(tag, str) and tag for tag in tags)
    ):
        raise ValueError("tags must be a non-empty list of strings")

    settings = {
        "model": request.get("model", "model"),
        "tags": tags,
        "url": request.get("url", "http://127.0.0.1:9931/v1/systemone"),
        "num_tags": request.get("num_tags", 1),
        "threshold": request.get("threshold", 0.1),
        "ask_separately": request.get("ask_separately", False),
    }
    if not isinstance(settings["model"], str) or not isinstance(
        settings["url"], str
    ):
        raise ValueError("model and url must be strings")
    if not isinstance(settings["num_tags"], int) or settings["num_tags"] < 1:
        raise ValueError("num_tags must be a positive integer")
    if (
        not isinstance(settings["threshold"], (int, float))
        or not 0 <= settings["threshold"] <= 1
    ):
        raise ValueError("threshold must be between 0 and 1")
    if not isinstance(settings["ask_separately"], bool):
        raise ValueError("ask_separately must be a boolean")
    return validated_messages, settings


def process_request(request: dict[str, Any]) -> dict[str, Any]:
    """Infer tags for every message in a validated host request."""
    messages, settings = _validate_request(request)
    results: list[dict[str, Any]] = []
    for message in messages:
        try:
            result = infer_tags(
                settings["model"],
                message["content"],
                settings["tags"],
                settings["url"],
                settings["num_tags"],
                settings["threshold"],
                settings["ask_separately"],
            )
            results.append({"id": message["id"], **result})
        except Exception as error:
            results.append(
                {"id": message["id"], "error": format_inference_error(error)}
            )
    return {"version": PROTOCOL_VERSION, "results": results}


def run_host(input_stream: BinaryIO, output_stream: BinaryIO) -> None:
    """Process native-messaging frames until Thunderbird closes stdin."""
    while True:
        try:
            request = read_message(input_stream)
            if request is None:
                return
            response = process_request(request)
        except Exception as error:
            response = {"version": PROTOCOL_VERSION, "error": str(error)}
        write_message(output_stream, response)


def main() -> int:
    run_host(sys.stdin.buffer, sys.stdout.buffer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
