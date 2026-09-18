"""End-to-end check of memory-inspector against the real package and database.

Drives two real turns through inspect() on a throwaway user in aim_app (a fact,
then a correction of it), deletes the thread, and checks what reached the run
log. Rerun after any oracleagentmemory bump: it is the stage mapping's
regression test against live log records. Makes 4 to 6 LLM calls.

    uv run python scripts/probe_inspector.py
    MEMORY_INSPECTOR_FAIL_WRITES=1 uv run python scripts/probe_inspector.py   # writes fail, agent must not
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector import inspect  # noqa: E402
from memory_inspector.runlog import FAIL_ENV  # noqa: E402

from aim_demo.config import SEED_USER, load_settings  # noqa: E402
from aim_demo.db import build_memory, create_pool  # noqa: E402

USER = "u_probe"
MEMORY_TYPES = ["memory", "fact", "preference", "guideline"]
TURNS = [
    ("Our nightly export lands in an S3 bucket in us-east-1. Alerts should come by email, never Slack.",
     "Noted: export bucket in us-east-1, and email for alerts."),
    ("Correction: the export bucket is actually in us-west-2, not us-east-1.",
     "Thanks, updated: the export bucket is in us-west-2."),
]


def main() -> None:
    settings = load_settings(SEED_USER)
    pool = create_pool(settings)
    memory = inspect(build_memory(pool, settings), pool=pool, source="replay",
                     llm_model=settings.llm_model, embed_model=settings.embed_model)
    thread = memory.create_thread(user_id=USER, agent_id="a_probe")
    print("thread", thread.thread_id)

    for i, (user_msg, reply) in enumerate(TURNS, start=1):
        results = memory.search(user_msg, user_id=USER, record_types=MEMORY_TYPES, max_results=5)
        used = [r.id for r in results[:3]]
        memory.inspector.record_prompt(f"<system>\n{user_msg}", reply, memory_ids_used=used, reply_source="scripted")
        thread.add_messages([{"role": "user", "content": user_msg}, {"role": "assistant", "content": reply}])
        last = memory.inspector.last_turn
        print(f"turn {i}: written as #{last.number}, {len(last.retrieved)} retrieved, diff "
              + json.dumps({k: len(v) for k, v in (last.memory_diff or {}).items()}))

    print("delete_thread ->", memory.delete_thread(thread.thread_id))
    memory.close()

    failing = os.environ.get(FAIL_ENV) == "1"
    with pool.acquire() as conn:
        cur = conn.cursor()
        turns = cur.execute("select turn, json_serialize(attrs), json_serialize(memory_diff), prompt_tokens, reply_source "
                            "from aim_turns where run_id = :r order by turn", {"r": thread.thread_id}).fetchall()
        stages = cur.execute("select stage, count(*), sum(case when json_value(attrs, '$.mapped') = 'false' then 1 else 0 end) "
                             "from aim_run_events where run_id = :r group by stage order by 2 desc",
                             {"r": thread.thread_id}).fetchall()
        retrievals = cur.execute("select turn, rank, record_type, round(distance, 3), in_prompt from aim_v_memory_retrievals "
                                 "where run_id = :r order by turn, rank", {"r": thread.thread_id}).fetchall()
    pool.close()

    if failing:
        print(f"\n{FAIL_ENV}=1: {len(turns)} turns written (expected 0); the conversation completed anyway")
        sys.exit(0 if not turns else 1)

    print("\nturns:")
    for n, attrs, diff, ptok, src in turns:
        d = json.loads(diff) if diff else {}
        print(f"  #{n} closed_by={json.loads(attrs)['closed_by']:<20} created={len(d.get('created', []))} "
              f"updated={len(d.get('updated', []))} deleted={len(d.get('deleted', []))} reply_source={src}")
    print("events by stage (count, unmapped):", stages)
    print("retrievals (turn, rank, type, distance, in_prompt):")
    for r in retrievals:
        print("  ", r)

    problems = []
    if [t[0] for t in turns] != [1, 2, 3]:
        problems.append(f"expected turns 1-3, got {[t[0] for t in turns]}")
    if any(unmapped for _, _, unmapped in stages):
        problems.append("unmapped events: extend RULES in memory_inspector/stages.py")
    if turns and json.loads(turns[-1][1])["closed_by"] != "delete_thread":
        problems.append("last turn should be closed by delete_thread")
    if turns and not json.loads(turns[-1][2] or "{}").get("deleted"):
        problems.append("delete turn should show the memories it removed")
    print("\nOK" if not problems else "\nPROBLEMS:\n  " + "\n  ".join(problems))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
