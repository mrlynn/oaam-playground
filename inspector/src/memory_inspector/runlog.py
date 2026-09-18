"""Write turns and events to the run log. Never raises into the agent.

Each turn is one transaction: upsert the run, lock its row to take the next
turn number (so numbering continues across processes and restarts), insert the
turn and its events, commit. Any failure is logged to the `memory_inspector`
logger and the turn is dropped.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import oracledb

from .spans import Event

log = logging.getLogger("memory_inspector")

FAIL_ENV = "MEMORY_INSPECTOR_FAIL_WRITES"  # test hook: set to 1 to make every write fail


@dataclass
class TurnRecord:
    run_id: str
    started: float  # epoch seconds
    duration_ms: float
    user_id: str | None = None
    agent_id: str | None = None
    user_message: str | None = None
    retrieved: list[dict[str, Any]] = field(default_factory=list)
    message_ids: list[str] = field(default_factory=list)
    memory_diff: dict[str, Any] | None = None
    attrs: dict[str, Any] = field(default_factory=dict)
    assembled_prompt: str | None = None
    prompt_tokens: int | None = None
    flat_history_tokens: int | None = None
    token_method: str | None = None
    reply: str | None = None
    reply_source: str | None = None
    usage: dict[str, Any] | None = None


def _utc(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).replace(tzinfo=None)


def _json(value: Any) -> Any:
    """Anything JSON can't hold becomes its str(); None stays NULL."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


_TS = "FROM_TZ(CAST(:{0} AS TIMESTAMP(6)), 'UTC')"

_MERGE_RUN = """
MERGE INTO aim_runs r USING (SELECT :run_id AS run_id FROM dual) s ON (r.run_id = s.run_id)
WHEN NOT MATCHED THEN INSERT (run_id, source, user_id, agent_id, llm_model, embed_model, package_version, first_turn_at)
VALUES (:run_id, :source, :user_id, :agent_id, :llm_model, :embed_model, :package_version, """ + _TS.format("started") + ")"

_INSERT_TURN = f"""
INSERT INTO aim_turns (run_id, turn, started_at, duration_ms, user_message, retrieved, message_ids, memory_diff,
                       attrs, assembled_prompt, prompt_tokens, flat_history_tokens, token_method, reply,
                       reply_source, usage)
VALUES (:run_id, :turn, {_TS.format("started")}, :duration_ms, :user_message, :retrieved, :message_ids, :memory_diff,
        :attrs, :assembled_prompt, :prompt_tokens, :flat_history_tokens, :token_method, :reply,
        :reply_source, :usage)"""

_INSERT_EVENT = f"""
INSERT INTO aim_run_events (run_id, turn, seq, parent_seq, depth, stage, name, source, started_at, duration_ms,
                            input_summary, output_summary, memory_ids, scope, tokens, attrs, error)
VALUES (:run_id, :turn, :seq, :parent_seq, :depth, :stage, :name, :source, {_TS.format("started")}, :duration_ms,
        :input_summary, :output_summary, :memory_ids, :scope, :tokens, :attrs, :error)"""

_EVENT_JSON = ("memory_ids", "scope", "tokens", "attrs")
_TURN_JSON = ("retrieved", "message_ids", "memory_diff", "attrs", "usage")
_TURN_CLOB = ("user_message", "assembled_prompt", "reply")


def _event_row(ev: Event, run_id: str | None, turn: int | None) -> dict[str, Any]:
    return {
        "run_id": run_id, "turn": turn, "seq": ev.seq, "parent_seq": ev.parent_seq, "depth": ev.depth,
        "stage": ev.stage, "name": ev.name[:256], "source": ev.source, "started": _utc(ev.started),
        "duration_ms": ev.duration_ms, "input_summary": ev.input_summary, "output_summary": ev.output_summary,
        "memory_ids": _json(ev.memory_ids), "scope": _json(ev.scope), "tokens": _json(ev.attrs.pop("tokens", None)),
        "attrs": _json(ev.attrs or None), "error": ev.error,
    }


class RunLogWriter:
    def __init__(self, pool, *, source: str = "instrumented", llm_model: str | None = None,
                 embed_model: str | None = None, package_version: str | None = None) -> None:
        self._pool = pool
        self._run_meta = {"source": source, "llm_model": llm_model, "embed_model": embed_model,
                          "package_version": package_version}

    def flush_turn(self, turn: TurnRecord, events: list[Event]) -> int | None:
        """Returns the turn number written, or None if the write failed."""
        try:
            self._maybe_fail()
            with self._pool.acquire() as conn:
                cur = conn.cursor()
                cur.execute(_MERGE_RUN, {"run_id": turn.run_id, "user_id": turn.user_id, "agent_id": turn.agent_id,
                                         "started": _utc(turn.started), **self._run_meta})
                (count,) = cur.execute("SELECT turn_count FROM aim_runs WHERE run_id = :r FOR UPDATE",
                                       {"r": turn.run_id}).fetchone()
                number = count + 1
                cur.execute(
                    f"""UPDATE aim_runs SET turn_count = :n, last_turn_at = {_TS.format("ended")},
                               user_id = NVL(user_id, :u), agent_id = NVL(agent_id, :a)
                         WHERE run_id = :r""",
                    {"n": number, "ended": _utc(turn.started + turn.duration_ms / 1000), "u": turn.user_id,
                     "a": turn.agent_id, "r": turn.run_id},
                )
                row = {k: v for k, v in vars(turn).items() if k not in ("user_id", "agent_id")}
                row.update(turn=number, started=_utc(turn.started))
                for k in _TURN_JSON:
                    row[k] = _json(row[k])
                cur.setinputsizes(**{k: oracledb.DB_TYPE_JSON for k in _TURN_JSON},
                                  **{k: oracledb.DB_TYPE_CLOB for k in _TURN_CLOB})
                cur.execute(_INSERT_TURN, row)
                self._insert_events(cur, events, turn.run_id, number)
                conn.commit()
                return number
        except Exception as exc:  # the agent must not notice
            log.warning("memory-inspector: dropped turn for run %s (%d events): %s", turn.run_id, len(events), exc)
            return None

    def flush_unattributed(self, events: list[Event]) -> None:
        if not events:
            return
        try:
            self._maybe_fail()
            with self._pool.acquire() as conn:
                self._insert_events(conn.cursor(), events, None, None)
                conn.commit()
        except Exception as exc:
            log.warning("memory-inspector: dropped %d unattributed events: %s", len(events), exc)

    @staticmethod
    def _insert_events(cur, events: list[Event], run_id: str | None, turn: int | None) -> None:
        if not events:
            return
        cur.setinputsizes(**{k: oracledb.DB_TYPE_JSON for k in _EVENT_JSON})
        cur.executemany(_INSERT_EVENT, [_event_row(ev, run_id, turn) for ev in events])

    @staticmethod
    def _maybe_fail() -> None:
        if os.environ.get(FAIL_ENV) == "1":
            raise RuntimeError(f"{FAIL_ENV}=1")
