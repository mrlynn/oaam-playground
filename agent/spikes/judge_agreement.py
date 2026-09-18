"""Spike 0.3: how often does an LLM judge agree with hand labels on memory pairs?

Reads inspector/tests/fixtures/judge_pairs.json (11 seed pairs under 0.15
cosine, hand-labelled), asks each model to classify each pair, and scores it.
A verdict counts if it is in the pair's accepted set; a "supersedes" verdict
must also pick the right memory as current.

    uv run python spikes/judge_agreement.py [model ...]
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import litellm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aim_demo.config import REPO_DIR, load_settings  # noqa: E402

FIXTURE = REPO_DIR / "inspector" / "tests" / "fixtures" / "judge_pairs.json"
JUDGE_VERSION = "pair-v1"
PROMPT = """You review an AI agent's long-term memory. Two memories about the same user were stored close together \
in embedding space. Decide how they relate.

Memory A (stored earlier, type {a_type}): {a}
Memory B (stored later, type {b_type}): {b}

Answer with one relation:
- duplicate: they say the same thing (wording, detail or memory type may differ). Keeping both adds nothing.
- supersedes: one makes the other out of date: a correction, a changed decision, or an answer to a pending question.
- contradicts: they conflict and nothing says which is current.
- complementary: related but each adds something the other lacks (e.g. a cause and its fix). Both are worth keeping.
- unrelated: close in wording only.

Reply with JSON only: {{"relation": "...", "current": "A" | "B" | null, "rationale": "one sentence"}}
"current" is required for supersedes (the one that is up to date) and null otherwise."""


def judge(model: str, pair: dict) -> dict:
    msg = PROMPT.format(a_type=pair["older"]["type"], a=pair["older"]["content"],
                        b_type=pair["newer"]["type"], b=pair["newer"]["content"])
    resp = litellm.completion(model=model, messages=[{"role": "user", "content": msg}], max_tokens=1000)  # newer models reject temperature=0; the cache gives stability
    raw = (resp.choices[0].message.content or "").strip()
    try:
        out = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except ValueError:
        # A reply with no parseable JSON is a verdict of its own, never a crash.
        out = {"relation": "unparsed", "current": None,
               "rationale": f"raw={raw[:120]!r} finish={resp.choices[0].finish_reason}"}
    out["_tokens"] = getattr(resp.usage, "total_tokens", None)
    return out


def score(pair: dict, verdict: dict) -> bool:
    if verdict["relation"] not in pair["accept"]:
        return False
    if verdict["relation"] == "supersedes":
        return {"A": "older", "B": "newer"}.get(verdict.get("current")) == pair["current"]
    return True


def main() -> None:
    pairs = json.loads(FIXTURE.read_text())["pairs"]
    models = sys.argv[1:] or [load_settings().llm_model, "anthropic/claude-haiku-4-5-20251001"]
    for model in models:
        start, right, tokens = time.perf_counter(), 0, 0
        print(f"\n== {model} ({JUDGE_VERSION})")
        for p in pairs:
            v = judge(model, p)
            ok = score(p, v)
            right += ok
            tokens += v["_tokens"] or 0
            cur = f" current={v.get('current')}" if v["relation"] == "supersedes" else ""
            print(f"  {'ok ' if ok else 'MISS'} {p['distance']:<6} want {'/'.join(p['accept']):<24} got {v['relation']}{cur}"
                  f"  | {v['rationale'][:90]}")
        print(f"  agreement {right}/{len(pairs)} · {tokens} tokens · {time.perf_counter() - start:.1f}s")


if __name__ == "__main__":
    main()
