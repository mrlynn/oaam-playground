"""/why: what the last reply was built from, and where each memory came from.

The terminal version of the dashboard's "why" panel. Search results come from
the companion's last turn. The turn that created each memory comes from the
run log, which is the part the package can't tell you.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass
from typing import Any

from .agent import Reply

_ORIGIN_SQL = """
SELECT run_id, turn FROM aim_v_turns
 WHERE JSON_EXISTS(memory_diff, '$.created[*]?(@.id == $mid)' PASSING :mid AS "mid")
 ORDER BY started_at FETCH FIRST 1 ROW ONLY"""


@dataclass(frozen=True)
class Origin:
    run_id: str | None
    turn: int | None


def find_origins(pool: Any, ids: list[str]) -> dict[str, Origin]:
    out: dict[str, Origin] = {}
    with pool.acquire() as conn:
        cur = conn.cursor()
        for mid in ids:
            row = cur.execute(_ORIGIN_SQL, {"mid": mid}).fetchone()
            out[mid] = Origin(row[0], row[1]) if row else Origin(None, None)
    return out


def describe_origin(origin: Origin, current_thread: str | None) -> str:
    if origin.run_id is None:
        return "created before the inspector was running"
    if origin.run_id == current_thread:
        return f"created at turn {origin.turn} of this conversation"
    return f"created in an earlier conversation ({origin.run_id[:8]}…, turn {origin.turn})"


@dataclass(frozen=True)
class WhyRow:
    rank: int
    id: str
    record_type: str
    distance: float
    in_prompt: bool
    origin: Origin
    origin_text: str
    content: str


def why_rows(reply: Reply, origins: dict[str, Origin], current_thread: str | None) -> list[WhyRow]:
    used = {r.id for r in reply.used}
    rows = []
    for rank, r in enumerate(reply.results, start=1):
        origin = origins.get(r.id, Origin(None, None))
        rows.append(WhyRow(rank, r.id, r.record.record_type, r.distance, r.id in used, origin,
                           describe_origin(origin, current_thread), r.record.content or ""))
    return rows


def render_why(reply: Reply | None, origins: dict[str, Origin], current_thread: str | None, width: int = 100) -> str:
    if reply is None:
        return "Nothing to explain yet: say something first."
    if not reply.results:
        return f'why: "{reply.user_message}"\n  search returned nothing, so the reply used no memories.'
    lines = [f'why: "{textwrap.shorten(reply.user_message, 80)}"',
             "  rank  type        distance  (lower is closer)"]
    for row in why_rows(reply, origins, current_thread):
        label = "in prompt" if row.in_prompt else "also returned"
        lines.append(f"  #{row.rank:<3} {row.record_type:<11} {row.distance:.3f}     {label:<14} {row.origin_text}")
        lines += textwrap.wrap(row.content, width=width, initial_indent="        ", subsequent_indent="        ")
    return "\n".join(lines)
