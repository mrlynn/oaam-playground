"""Spike 0.3: how often does the health check's judge agree with hand labels?

Reads inspector/tests/fixtures/judge_pairs.json (11 seed pairs under 0.15
cosine, hand-labelled) and runs the library's own Judge on each, uncached, so
this measures exactly the prompt `memory-inspector check` uses. A verdict
counts if it is in the pair's accepted set; a "supersedes" verdict must also
pick the right memory as current. Rerun whenever PAIR_VERSION changes.

    uv run python spikes/judge_agreement.py [model ...]
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.health.judge import PAIR_VERSION, DictCache, Judge  # noqa: E402
from memory_inspector.health.model import Memory  # noqa: E402

from aim_demo.config import REPO_DIR, load_settings  # noqa: E402

FIXTURE = REPO_DIR / "inspector" / "tests" / "fixtures" / "judge_pairs.json"
T0 = datetime(2026, 9, 18)


def as_memory(i: str, side: dict, minutes: int) -> Memory:
    return Memory(i, side["type"], side["content"], "u", "t", T0 + timedelta(minutes=minutes))


def score(pair: dict, relation: str, current: str | None) -> bool:
    if relation not in pair["accept"]:
        return False
    return relation != "supersedes" or current == pair["current"]


def main() -> None:
    pairs = json.loads(FIXTURE.read_text())["pairs"]
    models = sys.argv[1:] or [load_settings().llm_model, "anthropic/claude-haiku-4-5-20251001"]
    for model in models:
        judge = Judge(model, DictCache())
        start, right = time.perf_counter(), 0
        print(f"\n== {model} ({PAIR_VERSION})")
        for i, p in enumerate(pairs):
            v = judge.pair(as_memory(f"o{i}", p["older"], 1), as_memory(f"n{i}", p["newer"], 2))
            ok = score(p, v.relation, v.current)
            right += ok
            cur = f" current={v.current}" if v.relation == "supersedes" else ""
            print(f"  {'ok ' if ok else 'MISS'} {p['distance']:<6} want {'/'.join(p['accept']):<24} got {v.relation}{cur}"
                  f"  | {v.rationale[:90]}")
        print(f"  agreement {right}/{len(pairs)} · {judge.calls} calls · {time.perf_counter() - start:.1f}s")


if __name__ == "__main__":
    main()
