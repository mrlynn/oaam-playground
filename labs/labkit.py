"""Shared plumbing for the labs, so each notebook shows only what it teaches.

Every lab uses its own memory user (lab1, lab2, lab3, plus LAB_SUFFIX if set),
so a lab can start cold, in any order, without touching the others' data.
Settings come from labs/.env, falling back to the repo's agent/.env and
infra/.env: AIM_APP_PASSWORD, ANTHROPIC_API_KEY, AIM_LLM_MODEL, AIM_EMBED_MODEL.
"""

from __future__ import annotations

import os
import re
import textwrap
import warnings
from pathlib import Path
from typing import Any

import oracledb
import yaml
from dotenv import load_dotenv
from oracleagentmemory.core.dbschemapolicy import SchemaPolicy
from oracleagentmemory.core.embedders.embedder import Embedder
from oracleagentmemory.core.llms.llm import Llm
from oracleagentmemory.core.oracleagentmemory import OracleAgentMemory

from memory_inspector import inspect
from memory_inspector.health import run_check
from memory_inspector.health.checks import TRANSIENT_PATTERN

# In Jupyter an event loop is already running, and the package's synchronous
# methods warn that calling them from it "can lead to deadlocks". They work here
# (each call finishes before the next starts); the warning would only teach
# learners to ignore warnings. Recorded in docs/friction.md.
warnings.filterwarnings("ignore", message="You are calling an asynchronous method in a synchronous method")

LABS = Path(__file__).resolve().parent
REPO = LABS.parent
for env_file in (LABS / ".env", REPO / "agent" / ".env", REPO / "infra" / ".env"):
    load_dotenv(env_file, override=False)

DB_USER = os.getenv("LAB_DB_USER", "aim_app")
DSN = os.getenv("AIM_DB_DSN", "localhost:1521/FREEPDB1")
LLM_MODEL = os.getenv("AIM_LLM_MODEL", "anthropic/claude-sonnet-5")
EMBED_MODEL = os.getenv("AIM_EMBED_MODEL", "ollama/nomic-embed-text")
DASHBOARD = os.getenv("LAB_DASHBOARD", "http://localhost:3000")
SUFFIX = os.getenv("LAB_SUFFIX", "")
MEMORY_TYPES = ["memory", "fact", "preference", "guideline"]
# The seeded user's durable contact preference ("only by email, never by phone").
CONTACT_PREFERENCE = r"never by phone|email only|only by email|by email, never"


def lab_user(lab: int, variant: str = "") -> str:
    return f"lab{lab}{'_' + variant if variant else ''}{SUFFIX}"


def open_pool() -> oracledb.ConnectionPool:
    password = os.getenv("LAB_DB_PASSWORD") or os.environ[f"{DB_USER.upper()}_PASSWORD"]
    return oracledb.create_pool(user=DB_USER, password=password, dsn=DSN, min=1, max=4, increment=1)


def connect(source: str = "instrumented") -> tuple[oracledb.ConnectionPool, Any]:
    """A pool and an inspected memory client: the same two lines lab 1 writes out by hand."""
    pool = open_pool()
    client = OracleAgentMemory(connection=pool, embedder=Embedder(model=EMBED_MODEL), llm=Llm(model=LLM_MODEL),
                               schema_policy=SchemaPolicy.CREATE_IF_NECESSARY)
    return pool, inspect(client, pool=pool, source=source, llm_model=LLM_MODEL, embed_model=EMBED_MODEL)


def reset_user(memory, user: str) -> None:
    """Delete a lab user's threads, messages and memories so the lab starts clean."""
    n = memory.delete_user(user, cascade=True)
    print(f"reset {user}: {n} records deleted" if n else f"{user} starts empty")


def conversation(name: str) -> dict[str, Any]:
    return yaml.safe_load((REPO / "companion" / "conversations" / f"{name}.yaml").read_text())


def replay(memory, user: str, name: str, **thread_options) -> Any:
    """Write a scripted conversation one exchange at a time, the way an agent does,
    so extraction runs after every exchange. Returns the thread."""
    convo = conversation(name)
    thread = memory.create_thread(user_id=user, agent_id=convo["agent_id"], **thread_options)
    messages = convo["messages"]
    for i in range(0, len(messages) - 1, 2):
        thread.add_messages(messages[i : i + 2])
        print(f"  {name} exchange {i // 2 + 1}: “{shorten(messages[i]['content'], 70)}”")
    return thread


def shorten(text: str, width: int = 100) -> str:
    return textwrap.shorten(" ".join(str(text).split()), width=width, placeholder="…")


def memories(pool, user: str) -> list[dict[str, Any]]:
    """The user's durable memories, straight from the table: these are ordinary rows."""
    with pool.acquire() as conn:
        cur = conn.cursor()
        cur.execute(
            """select record_id, memory_type, dbms_lob.substr(content, 400, 1), thread_id, created_at
                 from memory where user_id = :u order by created_at, order_seq""", {"u": user})
        return [{"id": r[0], "type": r[1], "content": r[2], "thread": r[3], "created": r[4]} for r in cur]


def show_memories(pool, user: str, flag_transient: bool = False) -> None:
    """Print the user's memories (use memories() for the rows themselves)."""
    rows = memories(pool, user)
    print(f"{len(rows)} memories for {user}")
    for m in rows:
        flag = "  ← conversation state?" if flag_transient and TRANSIENT_PATTERN.search(m["content"]) else ""
        print(f"  [{m['type']:<10}] {shorten(m['content'], 110)}{flag}")


def show_results(results, *, highlight: str | None = None) -> None:
    """Search results ranked, with cosine distance (lower is closer)."""
    for rank, r in enumerate(results, start=1):
        rec = r.record
        mark = "  ←" if highlight and re.search(highlight, rec.content or "", re.I) else ""
        print(f"  #{rank:<2} {r.distance:.3f}  [{rec.record_type:<10}] {shorten(rec.content, 95)}{mark}")


def check(pool, user: str, judge: bool = True):
    """Run the memory health check for one user and print what it found."""
    report = run_check(pool, user_id=user, judge_model=LLM_MODEL if judge else None)
    c = report.counts
    print(f"check #{report.check_run_id} for {user}: {c['memories']} memories, {c['candidate_pairs']} close pairs, "
          f"{len(report.findings)} findings ({c['judge_calls']} judge calls, {c['judge_cache_hits']} cached)")
    new = {f.fingerprint for f in report.new}
    for f in report.findings:
        print(f"  {'new ' if f.fingerprint in new else '    '}{f.severity:<6} {f.kind:<14} {shorten(f.title, 110)}")
    for r in report.resolved:
        print(f"  resolved    {r['kind']:<14} {shorten(r['title'], 110)}")
    return report


def run_url(thread_id: str, turn: int | None = None, view: str | None = None) -> str:
    params = "&".join(p for p in (f"turn={turn}" if turn else "", f"view={view}" if view else "") if p)
    return f"{DASHBOARD}/runs/{thread_id}{'?' + params if params else ''}"


def memories_url() -> str:
    return f"{DASHBOARD}/memories"
