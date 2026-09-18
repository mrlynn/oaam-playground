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


# aim_app holds the scripted seeds and is reset freely. aim_live holds real
# companion conversations and must never be reset (docs/plans/m3-run-log.md).
SEED_USER = "aim_app"
KNOWN_USERS = (SEED_USER, "aim_live")


def load_settings(db_user: str | None = None) -> Settings:
    """Settings for one schema. The password comes from <USER>_PASSWORD in
    infra/.env, e.g. AIM_LIVE_PASSWORD for aim_live."""
    user = (db_user or os.getenv("AIM_DB_USER", SEED_USER)).lower()
    password_var = f"{user.upper()}_PASSWORD"
    if password_var not in os.environ:
        raise SystemExit(f"{password_var} is not set. Add it to infra/.env (see infra/.env.example).")
    return Settings(
        db_user=user,
        db_password=os.environ[password_var],
        db_dsn=os.getenv("AIM_DB_DSN", "localhost:1521/FREEPDB1"),
        llm_model=os.getenv("AIM_LLM_MODEL", "anthropic/claude-sonnet-5"),
        embed_model=os.getenv("AIM_EMBED_MODEL", "ollama/nomic-embed-text"),
        memory_store_id=os.getenv("AIM_MEMORY_STORE_ID") or None,
    )
