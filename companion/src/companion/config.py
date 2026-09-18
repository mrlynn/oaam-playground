"""Settings and the memory client.

The companion is deliberately its own project: it builds its own pool and
client instead of importing the demo's. Settings come from companion/.env;
inside this repo it also falls back to agent/.env and infra/.env so you don't
copy secrets around.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import oracledb
from dotenv import load_dotenv
from oracleagentmemory.core.dbschemapolicy import SchemaPolicy
from oracleagentmemory.core.embedders.embedder import Embedder
from oracleagentmemory.core.llms.llm import Llm
from oracleagentmemory.core.oracleagentmemory import OracleAgentMemory

from memory_inspector import InspectedMemory, inspect
from memory_inspector.health.checks import EXTRACTION_INSTRUCTIONS

# Live chat (terminal and web) keeps only durable memories. Scripted replays
# don't use it: the seeds must still produce the transient memories that the
# demo and the labs find and fix.
LIVE_EXTRACTION_INSTRUCTIONS = EXTRACTION_INSTRUCTIONS

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = PROJECT_DIR.parent

for env_file in (PROJECT_DIR / ".env", REPO_DIR / "agent" / ".env", REPO_DIR / "infra" / ".env"):
    load_dotenv(env_file, override=False)


def _env(name: str, fallback: str | None = None, default: str | None = None) -> str | None:
    return os.getenv(f"COMPANION_{name}") or (os.getenv(fallback) if fallback else None) or default


@dataclass(frozen=True)
class Config:
    db_user: str
    db_password: str
    db_dsn: str
    llm_model: str
    embed_model: str
    user_id: str
    agent_id: str


def load_config(db_user: str | None = None, user_id: str | None = None) -> Config:
    user = (db_user or _env("DB_USER", default="aim_live")).lower()
    password = _env("DB_PASSWORD") or os.getenv(f"{user.upper()}_PASSWORD")
    if not password:
        raise SystemExit(f"No password for {user}: set COMPANION_DB_PASSWORD or {user.upper()}_PASSWORD.")
    return Config(
        db_user=user,
        db_password=password,
        db_dsn=_env("DB_DSN", "AIM_DB_DSN", "localhost:1521/FREEPDB1"),
        llm_model=_env("LLM_MODEL", "AIM_LLM_MODEL", "anthropic/claude-sonnet-5"),
        embed_model=_env("EMBED_MODEL", "AIM_EMBED_MODEL", "ollama/nomic-embed-text"),
        user_id=user_id or _env("USER_ID", default="me"),
        agent_id=_env("AGENT_ID", default="companion"),
    )


def open_memory(cfg: Config, *, source: str) -> tuple[oracledb.ConnectionPool, InspectedMemory]:
    pool = oracledb.create_pool(user=cfg.db_user, password=cfg.db_password, dsn=cfg.db_dsn, min=1, max=4, increment=1)
    client = OracleAgentMemory(connection=pool, embedder=Embedder(model=cfg.embed_model), llm=Llm(model=cfg.llm_model),
                               schema_policy=SchemaPolicy.CREATE_IF_NECESSARY)
    memory = inspect(client, pool=pool, source=source, llm_model=cfg.llm_model, embed_model=cfg.embed_model)
    return pool, memory
