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


def render_why(reply: Reply | None, origins: dict[str, Origin], current_thread: str | None, width: int = 100) -> str:
    if reply is None:
        return "Nothing to explain yet: say something first."
    if not reply.results:
        return f'why: "{reply.user_message}"\n  search returned nothing, so the reply used no memories.'
    used = {r.id for r in reply.used}
    lines = [f'why: "{textwrap.shorten(reply.user_message, 80)}"',
             "  rank  type        distance  (lower is closer)"]
    for rank, r in enumerate(reply.results, start=1):
        label = "in prompt" if r.id in used else "also returned"
        rec = r.record
        lines.append(f"  #{rank:<3} {rec.record_type:<11} {r.distance:.3f}     {label:<14} "
                     f"{describe_origin(origins.get(r.id, Origin(None, None)), current_thread)}")
        lines += textwrap.wrap(rec.content or "", width=width, initial_indent="        ", subsequent_indent="        ")
    return "\n".join(lines)
