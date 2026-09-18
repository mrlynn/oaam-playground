"""Plain data passed between gathering, judging and checking."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

MEMORY_TYPES = ("memory", "fact", "preference", "guideline")


@dataclass(frozen=True)
class Memory:
    id: str
    type: str
    content: str
    user_id: str | None
    thread_id: str | None
    created_at: datetime
    seq: int = 0  # ORDER_SEQ: breaks created_at ties
    scope_label: str | None = None  # what the extractor called its scope


@dataclass(frozen=True)
class Pair:
    """Two memories of one user, close in embedding space. older/newer by creation."""

    older: Memory
    newer: Memory
    distance: float


@dataclass(frozen=True)
class Verdict:
    """What the judge said. relation is one of duplicate, supersedes, contradicts,
    complementary, unrelated, unparsed (pairs) or durable, transient, unparsed
    (memories). current is "older" or "newer" for supersedes."""

    relation: str
    rationale: str
    model: str
    current: str | None = None
    cached: bool = False


@dataclass
class Finding:
    kind: str
    severity: str
    title: str
    detail: str
    suggestion: str
    method: str
    user_id: str | None = None
    memory_ids: list[str] = field(default_factory=list)
    turns: list[dict[str, Any]] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    # What the finding is about, when that isn't its exact memories: a
    # conversation for crowded_turn, a user for scope_mismatch. It stays the
    # same finding (still open) while its contents shrink or grow.
    subject: str | None = None

    @property
    def fingerprint(self) -> str:
        """Same kind and subject (or same memories and turns): the same finding across check runs."""
        if self.subject is not None:
            key: list[Any] = [self.kind, self.subject]
        else:
            key = [self.kind, sorted(self.memory_ids), sorted((t["run_id"], t["turn"]) for t in self.turns)]
        return hashlib.sha256(json.dumps(key).encode()).hexdigest()


def older_newer(a: Memory, b: Memory) -> tuple[Memory, Memory]:
    return (a, b) if (a.created_at, a.seq, a.id) <= (b.created_at, b.seq, b.id) else (b, a)


def quote(text: str, limit: int = 90) -> str:
    text = " ".join(text.split())
    return f"“{text if len(text) <= limit else text[: limit - 1] + '…'}”"
