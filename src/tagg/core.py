"""Shared tag inference primitives used by the CLI and native hosts."""

import json
import logging
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("tagg")


def curate_json_schema(
    model: str, content: str, tags: list[str]
) -> dict[str, Any]:
    """Return a JSON schema constraining the model to the candidate tags."""
    return {
        "model": model,
        "state": content,
        "questions": {
            "tag": {
                "type": "choice",
                "instructions": "Given the file contents, which tag is the most appropriate one?",
                "criteria": {tag: None for tag in tags},
            }
        },
    }


def query_endpoint(
    url: str,
    schema: dict[str, Any],
    timeout: int = 60,
) -> dict[str, Any]:
    """Send a model request to the llama.cpp endpoint."""
    data = json.dumps(schema).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def filter_tags(
    api_response: dict[str, Any], max_n: int = 1, threshold: float = 0.3
) -> dict[str, Any]:
    """Filter model probabilities into the public tag result shape."""
    probabilities = api_response["answers"]["tag"]["probabilities"]
    logger.debug("Probabilities for each tag: %s", probabilities)
    keys = sorted(probabilities, key=probabilities.__getitem__, reverse=True)
    keys = keys[:max_n]
    return {
        "tags": [
            key
            for key in keys
            if probabilities.get(key) is not None
            and probabilities[key] >= threshold
        ]
    }


def infer_tags(
    model: str,
    content: str,
    candidate_tags: list[str],
    url: str,
    num_tags: int,
    threshold: float,
    ask_separately: bool,
) -> dict[str, Any]:
    """Infer tags for one content item using the configured model endpoint."""
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


def format_inference_error(error: Exception) -> str:
    """Convert endpoint errors into stable, user-facing result messages."""
    if isinstance(error, urllib.error.HTTPError):
        return f"HTTP {error.code}"
    if isinstance(error, urllib.error.URLError):
        return str(error.reason)
    if isinstance(error, json.JSONDecodeError):
        return "Malformed JSON from model"
    if isinstance(error, ValueError):
        return str(error)
    return str(error)
