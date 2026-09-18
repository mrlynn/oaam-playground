"""Which models the web page may pick: the configured default plus the local
Ollama chat models, read from Ollama each time so a `ollama pull` shows up.

The chosen model writes the replies and extracts the memories. Embeddings
don't change: the store's vectors must all come from one embedder.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.request import urlopen

OLLAMA_PREFIX = "ollama_chat/"  # LiteLLM's chat route, which keeps reasoning out of the reply


@dataclass(frozen=True)
class Model:
    id: str  # a LiteLLM model id
    label: str
    local: bool


def ollama_base() -> str:
    return (os.getenv("OLLAMA_API_BASE") or "http://localhost:11434").rstrip("/")


def is_chat_model(tag: dict[str, Any]) -> bool:
    name = tag.get("name", "")
    family = (tag.get("details") or {}).get("family") or ""
    if "embed" in name or "bert" in family:
        return False  # embedding models can't chat
    return not (tag.get("remote_host") or name.endswith(":cloud"))  # not local


def ollama_models(base: str | None = None, timeout: float = 2.0) -> list[Model]:
    """Local Ollama chat models, largest first. Raises OSError if Ollama is unreachable."""
    with urlopen(f"{base or ollama_base()}/api/tags", timeout=timeout) as resp:
        tags = json.load(resp).get("models", [])
    tags = sorted((t for t in tags if is_chat_model(t)), key=lambda t: (-(t.get("size") or 0), t["name"]))
    return [Model(OLLAMA_PREFIX + t["name"], _label(t), True) for t in tags]


def _label(tag: dict[str, Any]) -> str:
    size = (tag.get("details") or {}).get("parameter_size")
    return f"{tag['name']} · {size}" if size else tag["name"]


def available_models(default: str) -> tuple[list[Model], str | None]:
    """The default first, then local models; plus an error if Ollama didn't answer."""
    models = [Model(default, f"{default} (default)", default.startswith(("ollama/", "ollama_chat/")))]
    try:
        models += [m for m in ollama_models() if m.id != default]
    except (OSError, ValueError) as e:
        return models, f"Ollama not reachable at {ollama_base()}: {e}"
    return models, None
