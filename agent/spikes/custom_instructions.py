"""Spike 0.2: do memory_extraction_custom_instructions stop transient memories
and make corrections replace the stale fact?

Replays conversations one exchange at a time (as an agent writes) into
throwaway users, with and without instructions, TRIALS times each. Prints
every memory so the counts can be checked by eye, then deletes the users.

    uv run python spikes/custom_instructions.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aim_demo.config import REPO_DIR  # noqa: E402
from aim_demo.db import build_memory, create_pool  # noqa: E402

CONVERSATIONS = ["support_01", "onboarding_01"]
TRIALS = 2
INSTRUCTIONS = (
    "Store only durable information: facts about the user, their systems and their work; their preferences; "
    "and guidelines worth following next time. Never store what the assistant asked, is waiting for, or is about "
    "to do, and never store the state of the conversation itself. When the user corrects something they said "
    "earlier, store the corrected fact and say what it corrects, e.g. 'bucket is in us-west-2 (corrects us-east-1)'."
)
# First version ended "...store only the corrected fact, stated plainly, without mentioning the earlier
# value." It removed transient memories but also the "(corrected from ...)" note, the only signal of which
# fact is current. Extraction never revises the earlier memory either way; see docs/friction.md.
TRANSIENT = re.compile(r"\b(asked|awaiting|waiting for|has not yet|not yet confirmed|will (check|follow up)|pending)\b", re.I)
STALE = re.compile(r"us-east-1", re.I)


def run(memory, user: str, instructions: str | None) -> None:
    for name in CONVERSATIONS:
        convo = yaml.safe_load((REPO_DIR / "companion" / "conversations" / f"{name}.yaml").read_text())
        kwargs = {"memory_extraction_custom_instructions": instructions} if instructions else {}
        thread = memory.create_thread(user_id=user, agent_id=convo["agent_id"], **kwargs)
        msgs = convo["messages"]
        for i in range(0, len(msgs) - 1, 2):
            thread.add_messages(msgs[i : i + 2])


def main() -> None:
    pool = create_pool()
    memory = build_memory(pool)
    conditions = (("instr", INSTRUCTIONS),) if "--instr-only" in sys.argv else (("base", None), ("instr", INSTRUCTIONS))
    trials = 1 if "--instr-only" in sys.argv else TRIALS
    users = [(f"spike_{cond}_{t}", instr) for t in range(trials) for cond, instr in conditions]
    summary = []
    try:
        for user, instr in users:
            run(memory, user, instr)
            with pool.acquire() as conn:
                rows = conn.cursor().execute(
                    "select memory_type, dbms_lob.substr(content, 300, 1) from memory where user_id = :u order by order_seq",
                    {"u": user}).fetchall()
            transient = [c for _, c in rows if TRANSIENT.search(c)]
            stale = [c for _, c in rows if STALE.search(c)]
            summary.append((user, len(rows), len(transient), len(stale)))
            print(f"\n== {user}: {len(rows)} memories, {len(transient)} transient-looking, {len(stale)} mention us-east-1")
            for t, c in rows:
                flag = "T" if TRANSIENT.search(c) else ("S" if STALE.search(c) else " ")
                print(f"  {flag} [{t}] {c[:150]}")
    finally:
        for user, _ in users:
            memory.delete_user(user, cascade=True)
        memory.close()
        pool.close()
    print("\nuser, memories, transient-looking, mention us-east-1")
    for s in summary:
        print("  ", s)


if __name__ == "__main__":
    main()
