"""Phase 0 smoke test: thread, messages, one explicit memory, one retrieval.

Prints every step's elapsed time (feeds time-to-first-memory in docs/friction.md)
and the full shape of each search result so we can see what the API returns.

    uv run python scripts/smoke.py
"""

from __future__ import annotations

import json
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aim_demo.db import build_memory, create_pool, enable_package_logging  # noqa: E402

CONVERSATION = Path(__file__).resolve().parent.parent / "conversations" / "support_01.yaml"
timings: dict[str, float] = {}


@contextmanager
def step(name: str):
    start = time.perf_counter()
    print(f"\n--- {name}", flush=True)
    yield
    timings[name] = round((time.perf_counter() - start) * 1000, 1)
    print(f"--- {name}: {timings[name]} ms", flush=True)


def describe(obj) -> dict:
    """Everything an object exposes, so we see fields the docs do not mention."""
    out = {}
    for name in dir(obj):
        if name.startswith("__"):
            continue
        try:
            value = getattr(obj, name)
        except Exception as exc:  # properties can raise
            value = f"<{type(exc).__name__}: {exc}>"
        if callable(value):
            continue
        out[name] = value if isinstance(value, (str, int, float, bool, type(None), list, dict)) else repr(value)
    return out


def main() -> None:
    enable_package_logging()
    convo = yaml.safe_load(CONVERSATION.read_text())

    with step("open pool"):
        pool = create_pool()
    with step("build client (schema create if needed)"):
        memory = build_memory(pool)
    with step("create thread"):
        thread = memory.create_thread(user_id=convo["user_id"], agent_id=convo["agent_id"])
        print("thread_id:", thread.thread_id)
    with step("add messages (inline extraction)"):
        message_ids = thread.add_messages(convo["messages"])
        print("message ids:", message_ids)
    with step("wait for extraction"):
        memory.wait_for_memory_extraction()
    with step("add explicit memory"):
        memory_id = thread.add_memory(convo["explicit_memory"], memory_type="fact")
        print("memory id:", memory_id)
    with step("search"):
        results = memory.search(convo["query"], user_id=convo["user_id"], max_results=10)
    print(f"\n{len(results)} results for {convo['query']!r}:")
    for r in results:
        print(json.dumps({"result": describe(r), "record": describe(r.record)}, indent=2, default=str))
    with step("context card"):
        card = thread.get_context_card()
    print(json.dumps(describe(card), indent=2, default=str)[:4000])

    memory.close()
    pool.close()
    print("\nTIMINGS_MS", json.dumps(timings))


if __name__ == "__main__":
    main()
