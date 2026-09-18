"""An LLM judge for memory pairs and single memories, with a verdict cache.

Prompts are versioned; a verdict is cached under (version, model, the exact
content judged), so reruns agree with themselves and cost nothing, and a
changed memory is judged afresh. A reply without usable JSON is recorded as
"unparsed", never raised. Agreement with hand labels on the seed pairs is
measured by agent/spikes/judge_agreement.py (Sonnet 5: 10/11).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Protocol

from .model import Memory, Verdict

# Bump a version whenever its prompt changes: cached verdicts are keyed on it.
PAIR_VERSION = "pair-v3"  # v3: a broader or narrower restatement of a preference is a duplicate
MEMORY_VERSION = "memory-v2"  # v2: ongoing work and completed actions are durable
MAX_TOKENS = 1000  # at 300, Sonnet 5 sometimes returned nothing (finish_reason=length)

PAIR_RELATIONS = ("duplicate", "supersedes", "contradicts", "complementary", "unrelated")
MEMORY_KINDS = ("durable", "transient")

PAIR_PROMPT = """You review an AI agent's long-term memory. Two memories about the same user were stored close together \
in embedding space. Decide how they relate.

Memory A (stored earlier, type {a_type}): {a}
Memory B (stored later, type {b_type}): {b}

Answer with one relation:
- duplicate: they say the same thing (wording, detail or memory type may differ). Keeping both adds nothing. \
This includes a broader or narrower restatement of the same preference.
- supersedes: one makes the other out of date: a correction, a changed decision, or an answer to a pending question. \
Restating a preference more broadly or more narrowly is not a change.
- contradicts: they conflict and nothing says which is current.
- complementary: related but each adds something the other lacks (e.g. a cause and its fix). Both are worth keeping.
- unrelated: close in wording only.

Reply with JSON only: {{"relation": "...", "current": "A" | "B" | null, "rationale": "one sentence"}}
"current" is required for supersedes (the one that is up to date) and null otherwise."""

MEMORY_PROMPT = """You review an AI agent's long-term memory, which should hold only what is worth knowing in a later, \
separate conversation: facts about the user and their work, their preferences, and guidelines.

Memory (type {type}): {content}

Is it durable, or transient conversation state (what the assistant asked, is waiting for, or is about to do; a step \
that only mattered while that conversation was open)? Work the user is doing or has planned, decisions they made, and \
actions already completed are durable, even when unfinished: they may matter next time.

Reply with JSON only: {{"kind": "durable" | "transient", "rationale": "one sentence"}}"""

# (model, prompt) -> reply text. Injected so tests never call a model.
Complete = Callable[[str, str], str]


class Cache(Protocol):
    def get(self, key: str) -> dict[str, Any] | None: ...
    def put(self, key: str, kind: str, value: dict[str, Any], model: str, version: str) -> None: ...


class DictCache:
    def __init__(self) -> None:
        self.data: dict[str, dict[str, Any]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        return self.data.get(key)

    def put(self, key: str, kind: str, value: dict[str, Any], model: str, version: str) -> None:
        self.data[key] = value


def litellm_complete(model: str, prompt: str) -> str:
    import litellm  # optional dependency: memory-inspector[judge]

    # No temperature: newer models reject temperature=0. The cache gives stability.
    resp = litellm.completion(model=model, messages=[{"role": "user", "content": prompt}], max_tokens=MAX_TOKENS)
    return resp.choices[0].message.content or ""


def _parse(raw: str) -> dict[str, Any] | None:
    try:
        value = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _key(*parts: str) -> str:
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()


class Judge:
    def __init__(self, model: str, cache: Cache, complete: Complete = litellm_complete) -> None:
        self.model = model
        self.cache = cache
        self.complete = complete
        self.calls = 0
        self.hits = 0

    def pair(self, older: Memory, newer: Memory) -> Verdict:
        key = _key(PAIR_VERSION, self.model, older.type, older.content, newer.type, newer.content)
        cached = self.cache.get(key)
        if cached is not None:
            self.hits += 1
            return Verdict(cached["relation"], cached["rationale"], self.model, cached.get("current"), cached=True)
        self.calls += 1
        raw = self.complete(self.model, PAIR_PROMPT.format(a_type=older.type, a=older.content,
                                                           b_type=newer.type, b=newer.content))
        out = _parse(raw)
        relation = (out or {}).get("relation")
        if relation not in PAIR_RELATIONS:
            return Verdict("unparsed", f"judge reply not understood: {raw[:200]!r}", self.model)
        side = {"A": "older", "B": "newer"}.get((out or {}).get("current") or "")
        if relation == "supersedes" and side is None:
            return Verdict("unparsed", f"supersedes without a current side: {raw[:200]!r}", self.model)
        verdict = {"relation": relation, "rationale": str(out.get("rationale", ""))[:1000],
                   "current": side if relation == "supersedes" else None}
        self.cache.put(key, "pair", verdict, self.model, PAIR_VERSION)
        return Verdict(verdict["relation"], verdict["rationale"], self.model, verdict["current"])

    def memory(self, m: Memory) -> Verdict:
        key = _key(MEMORY_VERSION, self.model, m.type, m.content)
        cached = self.cache.get(key)
        if cached is not None:
            self.hits += 1
            return Verdict(cached["relation"], cached["rationale"], self.model, cached=True)
        self.calls += 1
        out = _parse(self.complete(self.model, MEMORY_PROMPT.format(type=m.type, content=m.content)))
        kind = (out or {}).get("kind")
        if kind not in MEMORY_KINDS:
            return Verdict("unparsed", "judge reply not understood", self.model)
        verdict = {"relation": kind, "rationale": str(out.get("rationale", ""))[:1000]}
        self.cache.put(key, "memory", verdict, self.model, MEMORY_VERSION)
        return Verdict(kind, verdict["rationale"], self.model)
