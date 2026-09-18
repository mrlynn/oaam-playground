"""Map oracleagentmemory log records to lifecycle stages.

Built from records captured on oracleagentmemory 26.6.0
(tests/fixtures/turn_log.jsonl). The package names each operation in its
message ("DB store add started." / "DB store add completed."), so a span is
identified by its logger plus that operation name.

Stages come from the agent memory lifecycle: ingestion, extraction,
consolidation, retrieval, summarization, revision, and other for anything
unmapped. Unmapped records are kept with attrs.mapped = false, never dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

STAGES = ("ingestion", "extraction", "consolidation", "retrieval", "summarization", "revision", "other")
LOGGER_ROOT = "oracleagentmemory"

_START = re.compile(r"^(?P<key>.+?) started\.$")
_END = re.compile(r"^(?P<key>.+?) (?P<verb>completed|initialized|created|failed)\b.*$")
# "X initialized." closes "X initialization started.", "X created." closes "X creation started."
_END_SUFFIX = {"initialized": " initialization", "created": " creation"}


@dataclass(frozen=True)
class Parsed:
    phase: str  # "start", "end" or "point"
    key: str  # operation name, e.g. "DB store add"; for points, the whole message
    failed: bool = False


def parse_message(message: str) -> Parsed:
    m = _START.match(message)
    if m:
        return Parsed("start", m["key"])
    m = _END.match(message)
    if m:
        return Parsed("end", m["key"] + _END_SUFFIX.get(m["verb"], ""), failed=m["verb"] == "failed")
    return Parsed("point", message.rstrip("."))


@dataclass(frozen=True)
class Rule:
    logger: str  # suffix after "oracleagentmemory."; prefix match
    key: str  # operation name prefix; "" matches any
    stage: str
    inherit: bool = False  # generic operation: take the enclosing span's stage when nested


# First match wins, so specific rules come before general ones.
RULES: tuple[Rule, ...] = (
    # Setup work inside create_thread / get_thread.
    Rule("core.thread", "OracleThread initialization", "other"),
    Rule("core._threadsummarizer", "Thread summarizer initialization", "other"),
    Rule("core.extractors", "Thread memory extractor initialization", "other"),
    Rule("core.oracledbmemorystore", "DB store thread record creation", "other"),
    Rule("core.oracleagentmemory", "OracleAgentMemory thread creation", "other"),
    # add_messages: append, then extraction with its own summary and lookup.
    Rule("core.thread", "Thread message append", "ingestion"),
    Rule("core.extractors", "Extractor context-summary", "summarization"),
    Rule("core.extractors", "Memory extraction past-memory lookup", "consolidation"),
    Rule("core.extractors", "Memory extraction prompt flow", "extraction"),
    Rule("core.extractors", "Thread memory extraction", "extraction"),
    Rule("core._threadsummarizer", "", "summarization"),
    Rule("core.oracledbmemorystore", "DB store add", "ingestion"),
    Rule("core._chunkers", "", "ingestion"),
    Rule("core._db.recordchunks", "Record-chunk insert", "ingestion"),
    # Explicit add_memory: "Thread memory creation started." / "Thread memory created."
    # (seen on thread.add_memory; the client-level name is assumed by analogy).
    Rule("core.thread", "Thread memory creation", "ingestion"),
    Rule("core.oracleagentmemory", "OracleAgentMemory memory creation", "ingestion"),
    # Deletes.
    Rule("core._db.recordchunks", "Record-chunk", "revision"),
    Rule("core.oracledbmemorystore", "DB store delete", "revision"),
    Rule("core.oracleagentmemory", "OracleAgentMemory thread deletion", "revision"),
    # The next two names are assumed by analogy; nothing has exercised them yet.
    Rule("core.oracleagentmemory", "OracleAgentMemory memory deletion", "revision"),
    Rule("core.oracleagentmemory", "OracleAgentMemory memory update", "revision"),
    # Generic operations: their stage is whatever they are doing it for. A
    # search inside the past-memory lookup is consolidation, not retrieval.
    Rule("core.thread", "Thread search", "retrieval", inherit=True),
    Rule("core.oracleagentmemory", "OracleAgentMemory search", "retrieval", inherit=True),
    Rule("core.oracledbmemorystore", "DB store search", "retrieval", inherit=True),
    Rule("core.oracledbmemorystore", "DB store vector search", "retrieval", inherit=True),
    Rule("core.oracledbmemorystore", "DB store keyword search", "retrieval", inherit=True),
    Rule("core.oracledbmemorystore", "DB store hybrid search", "retrieval", inherit=True),
    Rule("core.embedders", "", "other", inherit=True),
    Rule("core.llms", "", "other", inherit=True),
)


# Operations the package starts but never logs the end of. When the inner
# operation (key) completes, the outer one (value) is closed with it and marked
# attrs.end_inferred. 26.6.0 logs "Extractor context-summary update started."
# with no matching completion; its LLM request is the last thing it does.
CLOSES_WITH: dict[str, str] = {
    "Extractor context-summary LLM request": "Extractor context-summary update",
}


@dataclass(frozen=True)
class Classified:
    stage: str
    inherit: bool
    mapped: bool


def classify(logger_name: str, key: str) -> Classified:
    suffix = logger_name[len(LOGGER_ROOT) + 1 :] if logger_name.startswith(LOGGER_ROOT + ".") else logger_name
    for rule in RULES:
        if suffix.startswith(rule.logger) and key.startswith(rule.key):
            return Classified(rule.stage, rule.inherit, True)
    # Unknown: follow the enclosing span if there is one, flagged so mapping
    # gaps can be counted (attrs.mapped = false).
    return Classified("other", True, False)
