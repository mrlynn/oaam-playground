"""What changed in durable memory during a turn.

The package has no API that lists memories and no UPDATED_AT column, so the
only way to see a revision is to read the memory table before and after and
compare. This is computed, not observed (attrs.computed on the turn).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import oracledb


@dataclass(frozen=True)
class MemoryRow:
    id: str
    type: str
    content: str | None
    thread_id: str | None


Snapshot = dict[str, MemoryRow]


def diff_memories(before: Snapshot, after: Snapshot) -> dict[str, list[dict[str, Any]]]:
    created = [_row(r) for i, r in after.items() if i not in before]
    deleted = [_row(r) for i, r in before.items() if i not in after]
    updated = [
        {"id": i, "type": r.type, "before": before[i].content, "after": r.content}
        for i, r in after.items()
        if i in before and (before[i].content != r.content or before[i].type != r.type)
    ]
    return {"created": created, "updated": updated, "deleted": deleted}


def _row(r: MemoryRow) -> dict[str, Any]:
    return {"id": r.id, "type": r.type, "content": r.content, "thread_id": r.thread_id}


@dataclass(frozen=True)
class Scope:
    user_id: str | None = None
    agent_id: str | None = None
    thread_id: str | None = None

    def usable(self) -> bool:
        return bool(self.user_id or self.thread_id)


def _clob_as_str(cursor, metadata):
    if metadata.type_code is oracledb.DB_TYPE_CLOB:
        return cursor.var(oracledb.DB_TYPE_LONG, arraysize=cursor.arraysize)
    return None


class Snapshotter:
    """Reads the package's memory table. Read-only, on the inspector's pool."""

    def __init__(self, pool, memory_table: str, thread_table: str) -> None:
        for name in (memory_table, thread_table):
            if not name.replace("_", "").replace("$", "").replace("#", "").isalnum():
                raise ValueError(f"unexpected table name {name!r}")
        self._pool = pool
        self._memory = memory_table
        self._thread = thread_table

    def take(self, scope: Scope) -> Snapshot:
        """Every memory for the user (all threads, since extraction can revise
        memories from earlier threads), or for the thread when there is no user."""
        if scope.user_id:
            where, binds = "user_id = :u", {"u": scope.user_id}
        elif scope.thread_id:
            where, binds = "thread_id = :t", {"t": scope.thread_id}
        else:
            return {}
        with self._pool.acquire() as conn:
            cur = conn.cursor()
            cur.outputtypehandler = _clob_as_str
            cur.execute(f"select record_id, memory_type, content, thread_id from {self._memory} where {where}", binds)
            return {r[0]: MemoryRow(r[0], r[1], r[2], r[3]) for r in cur}

    def thread_owner(self, thread_id: str) -> Scope:
        with self._pool.acquire() as conn:
            row = conn.cursor().execute(
                f"select user_id, agent_id from {self._thread} where record_id = :t", {"t": thread_id}
            ).fetchone()
        return Scope(row[0], row[1], thread_id) if row else Scope(thread_id=thread_id)

    def memory_owner(self, memory_id: str) -> Scope:
        with self._pool.acquire() as conn:
            row = conn.cursor().execute(
                f"select user_id, agent_id, thread_id from {self._memory} where record_id = :m", {"m": memory_id}
            ).fetchone()
        return Scope(*row) if row else Scope()
