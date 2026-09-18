"""Seed the store with every scripted conversation, one thread each.

    uv run python scripts/seed.py            # add threads to the existing store
    uv run python scripts/seed.py --reset    # DROP and recreate the managed schema first

Messages are added one exchange (user + assistant) per call, the way an agent
writes them turn by turn, so extraction runs per turn and timestamps spread out.
Extraction is an LLM call, so the memories differ run to run. Nothing
downstream should depend on their exact content.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from oracleagentmemory.core.dbschemapolicy import SchemaPolicy  # noqa: E402

from memory_inspector.db import build_memory, create_pool  # noqa: E402

CONVERSATIONS = Path(__file__).resolve().parent.parent / "conversations"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop and recreate the managed schema (destructive)")
    args = parser.parse_args()

    pool = create_pool()
    policy = SchemaPolicy.RECREATE if args.reset else SchemaPolicy.CREATE_IF_NECESSARY
    memory = build_memory(pool, schema_policy=policy)
    if args.reset:
        print("schema recreated")

    for path in sorted(CONVERSATIONS.glob("*.yaml")):
        convo = yaml.safe_load(path.read_text())
        start = time.perf_counter()
        thread = memory.create_thread(user_id=convo["user_id"], agent_id=convo["agent_id"])
        messages = convo["messages"]
        for i in range(0, len(messages), 2):
            thread.add_messages(messages[i : i + 2])
        if convo.get("explicit_memory"):
            thread.add_memory(convo["explicit_memory"], memory_type="fact")
        print(f"{path.stem:<16} {convo['user_id']:<8} {thread.thread_id}  {time.perf_counter() - start:5.1f}s")

    memory.wait_for_memory_extraction()
    memory.close()
    pool.close()


if __name__ == "__main__":
    main()
