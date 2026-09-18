"""Read what the checks need. Runs as the schema owner; reads only.

Candidate pairs come from one self-join on the package's chunk table with
VECTOR_DISTANCE(..., COSINE), inside the database. Spike 0.1 confirmed that is
the same metric search() reports. Each memory is one chunk today; if one ever
has several, a pair's distance is its closest chunks.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import oracledb

from .checks import TurnInput
from .model import MEMORY_TYPES, Memory, Pair, older_newer


@dataclass(frozen=True)
class Tables:
    memory: str = "MEMORY"
    chunks: str = "RECORD_CHUNKS"
    message: str = "MESSAGE"

    def __post_init__(self) -> None:
        for name in (self.memory, self.chunks, self.message):
            if not name.replace("_", "").replace("$", "").replace("#", "").isalnum():
                raise ValueError(f"unexpected table name {name!r}")


_TYPES_SQL = ", ".join(f"'{t}'" for t in MEMORY_TYPES)


def _clob_as_str(cursor, metadata):
    if metadata.type_code is oracledb.DB_TYPE_CLOB:
        return cursor.var(oracledb.DB_TYPE_LONG, arraysize=cursor.arraysize)
    return None


def load_memories(conn, tables: Tables, user_id: str | None) -> dict[str, Memory]:
    cur = conn.cursor()
    cur.outputtypehandler = _clob_as_str
    where = "(expires_at is null or expires_at > systimestamp)" + (" and user_id = :u" if user_id else "")
    cur.execute(
        f"""select record_id, memory_type, content, user_id, thread_id, created_at, order_seq,
                   json_value(metadata, '$."$agent_memory".scope')
              from {tables.memory} where {where}""",
        {"u": user_id} if user_id else {})
    return {r[0]: Memory(r[0], r[1], r[2] or "", r[3], r[4], r[5], int(r[6] or 0), r[7]) for r in cur}


def candidate_pairs(conn, tables: Tables, memories: dict[str, Memory], threshold: float,
                    user_id: str | None) -> list[Pair]:
    user_filter = " and a.user_id = :u" if user_id else ""
    binds: dict[str, Any] = {"t": threshold, **({"u": user_id} if user_id else {})}
    rows = conn.cursor().execute(
        f"""select a.source_id, b.source_id, min(vector_distance(a.embedding, b.embedding, COSINE))
              from {tables.chunks} a
              join {tables.chunks} b on a.source_id < b.source_id and a.user_id = b.user_id
             where a.source_record_type in ({_TYPES_SQL}) and b.source_record_type in ({_TYPES_SQL})
               and vector_distance(a.embedding, b.embedding, COSINE) < :t{user_filter}
             group by a.source_id, b.source_id""",
        binds).fetchall()
    pairs = []
    for a, b, d in rows:
        if a in memories and b in memories:  # skip expired rows and orphan chunks
            older, newer = older_newer(memories[a], memories[b])
            pairs.append(Pair(older, newer, float(d)))
    return sorted(pairs, key=lambda p: p.distance)


def orphan_chunks(conn, tables: Tables) -> list[str]:
    rows = conn.cursor().execute(
        f"""select distinct c.source_id from {tables.chunks} c
             where (c.source_record_type in ({_TYPES_SQL})
                    and not exists (select 1 from {tables.memory} m where m.record_id = c.source_id))
                or (c.source_record_type = 'message'
                    and not exists (select 1 from {tables.message} m where m.record_id = c.source_id))""").fetchall()
    return [r[0] for r in rows]


def recorded_turns(conn, user_id: str | None) -> list[TurnInput]:
    """Turns from the run log, if it is installed here and has any."""
    cur = conn.cursor()
    if not cur.execute("select count(*) from user_tables where table_name = 'AIM_TURNS'").fetchone()[0]:
        return []
    where = " where r.user_id = :u" if user_id else ""
    cur.execute(
        f"""select t.run_id, t.turn, r.user_id, t.retrieved
              from aim_turns t join aim_runs r on r.run_id = t.run_id{where}
             order by t.run_id, t.turn""",
        {"u": user_id} if user_id else {})
    return [TurnInput(run_id, turn, uid, retrieved or []) for run_id, turn, uid, retrieved in cur]
