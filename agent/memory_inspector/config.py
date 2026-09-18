"""Environment-driven settings for the agent side of the inspector."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = AGENT_DIR.parent

# agent/.env holds API keys; infra/.env holds DB passwords. Neither is committed.
load_dotenv(AGENT_DIR / ".env")
load_dotenv(REPO_DIR / "infra" / ".env")


@dataclass(frozen=True)
class Settings:
    db_user: str
    db_password: str
    db_dsn: str
    llm_model: str
    embed_model: str
    memory_store_id: str | None


def load_settings() -> Settings:
    return Settings(
        db_user=os.getenv("AIM_DB_USER", "aim_app"),
        db_password=os.environ["AIM_APP_PASSWORD"],
        db_dsn=os.getenv("AIM_DB_DSN", "localhost:1521/FREEPDB1"),
        llm_model=os.getenv("AIM_LLM_MODEL", "anthropic/claude-sonnet-5"),
        embed_model=os.getenv("AIM_EMBED_MODEL", "ollama/nomic-embed-text"),
        memory_store_id=os.getenv("AIM_MEMORY_STORE_ID") or None,
    )
