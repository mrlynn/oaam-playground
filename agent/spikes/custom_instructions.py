"""Spike 0.2: do memory_extraction_custom_instructions stop transient memories
and make corrections replace the stale fact?

Replays conversations one exchange at a time (as an agent writes) into
throwaway users, with and without instructions, TRIALS times each. Prints
every memory so the counts can be checked by eye, then deletes the users.

    uv run python spikes/custom_instructions.py
    uv run python spikes/custom_instructions.py --compare   # INSTRUCTIONS vs INSTRUCTIONS_V2, with PROBE

--compare adds PROBE, which reproduces what got past INSTRUCTIONS on real
use: "the user has asked about X again", "X remains unresolved", and the
assistant's statements about itself.
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
# V2 adds: nothing about which questions were asked, how often, or whether they were answered; nothing the
# assistant said about itself; keep the lasting interest behind a question. The correction rule is unchanged.
INSTRUCTIONS_V2 = (
    "Store only durable information: facts about the user, their systems and their work; their preferences; "
    "and guidelines worth following next time. Never store what the assistant asked, said, is waiting for, or is "
    "about to do, or what the assistant can or cannot do. Never store the state of the conversation itself: which "
    "questions the user asked, how often, or whether they were answered. If a question shows a lasting interest, "
    "store the interest, e.g. 'is evaluating Oracle AI Agent Memory'. When the user corrects something they said "
    "earlier, store the corrected fact and say what it corrects, e.g. 'bucket is in us-west-2 (corrects us-east-1)'."
)
PROBE = [  # one exchange at a time, like the companion
    {"role": "user", "content": "What's the weather in Boston right now?"},
    {"role": "assistant", "content": "I can't check real-time weather, so I don't know. A weather site will have it."},
    {"role": "user", "content": "OK. What is Oracle AI Agent Memory? I'm deciding whether to use it for our support agent."},
    {"role": "assistant", "content": "I don't have verified details on it, so I won't guess. What does your support agent need to remember?"},
    {"role": "user", "content": "I asked about Oracle AI Agent Memory before. Do you know what it is yet?"},
    {"role": "assistant", "content": "Still no verified details, sorry. The Oracle docs are the place to check."},
]
# First version ended "...store only the corrected fact, stated plainly, without mentioning the earlier
# value." It removed transient memories but also the "(corrected from ...)" note, the only signal of which
# fact is current. Extraction never revises the earlier memory either way; see docs/friction.md.
TRANSIENT = re.compile(r"\b(asked|awaiting|waiting for|has not yet|not yet confirmed|will (check|follow up)|pending|"
                       r"again|unresolved|remains|as of (this|the latest))\b", re.I)
ABOUT_ASSISTANT = re.compile(r"\b(the )?assistant (said|stated|described|does not|doesn't|cannot|can't|lacks|has no)\b", re.I)
INTEREST = re.compile(r"oracle ai agent memory", re.I)
STALE = re.compile(r"us-east-1", re.I)


def run(memory, user: str, instructions: str | None, probe: bool = False) -> None:
    convos = [yaml.safe_load((REPO_DIR / "companion" / "conversations" / f"{n}.yaml").read_text()) for n in CONVERSATIONS]
    if probe:
        convos.append({"agent_id": "companion", "messages": PROBE})
    for convo in convos:
        kwargs = {"memory_extraction_custom_instructions": instructions} if instructions else {}
        thread = memory.create_thread(user_id=user, agent_id=convo["agent_id"], **kwargs)
        msgs = convo["messages"]
        for i in range(0, len(msgs) - 1, 2):
            thread.add_messages(msgs[i : i + 2])


def main() -> None:
    pool = create_pool()
    memory = build_memory(pool)
    compare = "--compare" in sys.argv
    if compare:
        conditions, trials = (("v1", INSTRUCTIONS), ("v2", INSTRUCTIONS_V2)), 3
    elif "--instr-only" in sys.argv:
        conditions, trials = (("instr", INSTRUCTIONS),), 1
    else:
        conditions, trials = (("base", None), ("instr", INSTRUCTIONS)), TRIALS
    users = [(f"spike_{cond}_{t}", instr) for t in range(trials) for cond, instr in conditions]
    summary = []
    try:
        for user, instr in users:
            run(memory, user, instr, probe=compare)
            with pool.acquire() as conn:
                rows = conn.cursor().execute(
                    "select memory_type, dbms_lob.substr(content, 300, 1) from memory where user_id = :u order by order_seq",
                    {"u": user}).fetchall()
            transient = [c for _, c in rows if TRANSIENT.search(c)]
            stale = [c for _, c in rows if STALE.search(c)]
            about = [c for _, c in rows if ABOUT_ASSISTANT.search(c)]
            interest = [c for _, c in rows if INTEREST.search(c) and not TRANSIENT.search(c)]
            summary.append((user, len(rows), len(transient), len(stale), len(about), len(interest)))
            print(f"\n== {user}: {len(rows)} memories, {len(transient)} transient-looking, {len(stale)} mention us-east-1, "
                  f"{len(about)} about the assistant, {len(interest)} keep the interest")
            for t, c in rows:
                flag = ("T" if TRANSIENT.search(c) else "A" if ABOUT_ASSISTANT.search(c)
                        else "S" if STALE.search(c) else "I" if INTEREST.search(c) else " ")
                print(f"  {flag} [{t}] {c[:150]}")
    finally:
        for user, _ in users:
            memory.delete_user(user, cascade=True)
        memory.close()
        pool.close()
    print("\nuser, memories, transient-looking, mention us-east-1, about the assistant, keep the interest")
    for s in summary:
        print("  ", s)


if __name__ == "__main__":
    main()
