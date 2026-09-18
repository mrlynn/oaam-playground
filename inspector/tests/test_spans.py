"""Stage mapping and span pairing, against real records from oracleagentmemory 26.6.0."""

import json
import logging
from collections import Counter
from pathlib import Path

import pytest

from memory_inspector.spans import LogRecordView, SpanBuilder
from memory_inspector.stages import STAGES, classify, parse_message

FIXTURE = Path(__file__).parent / "fixtures" / "turn_log.jsonl"


def records(phase: str) -> list[LogRecordView]:
    out = []
    for line in FIXTURE.read_text().splitlines():
        r = json.loads(line)
        if r["phase"] == phase:
            level = getattr(logging, r["level"])
            out.append(LogRecordView(r["name"], r["msg"], r["created"], level, r["extras"]))
    return out


def build(phase: str, wrapper: str, stage: str) -> list:
    recs = records(phase)
    b = SpanBuilder()
    ev = b.open_wrapper(wrapper, stage, now=recs[0].created - 0.001)
    for r in recs:
        b.feed(r)
    assert b.open_count == 1, "every package span should have closed, leaving only the wrapper"
    b.close_wrapper(ev, now=recs[-1].created + 0.001)
    return b.drain()


@pytest.mark.parametrize("message,phase,key", [
    ("DB store add started.", "start", "DB store add"),
    ("DB store add completed.", "end", "DB store add"),
    ("OracleThread initialization started.", "start", "OracleThread initialization"),
    ("OracleThread initialized.", "end", "OracleThread initialization"),
    ("OracleAgentMemory thread creation started.", "start", "OracleAgentMemory thread creation"),
    ("OracleAgentMemory thread created.", "end", "OracleAgentMemory thread creation"),
    ("Embedding provider response processed.", "point", "Embedding provider response processed"),
    ("Memory extraction prompt flow parsed records.", "point", "Memory extraction prompt flow parsed records"),
])
def test_parse_message(message, phase, key):
    p = parse_message(message)
    assert (p.phase, p.key) == (phase, key)


def test_parse_failure_is_an_end():
    p = parse_message("Embedding provider call failed with a retryable error.")
    assert p.phase == "end" and p.failed and p.key == "Embedding provider call"


def test_every_fixture_span_is_mapped():
    keys = {(r.name, parse_message(r.message).key) for p in ("create_thread", "search_1", "add_messages",
                                                            "thread_search", "delete_thread")
            for r in records(p) if parse_message(r.message).phase == "start"}
    unmapped = [k for k in keys if not classify(*k).mapped]
    assert unmapped == []


def test_add_messages_turn_stages():
    events = build("add_messages", "thread.add_messages", "ingestion")
    by_name = {e.name: e for e in events}
    assert all(e.stage in STAGES for e in events)
    assert by_name["Thread message append"].stage == "ingestion"
    assert by_name["Thread memory extraction"].stage == "extraction"
    assert by_name["Extractor context-summary update"].stage == "summarization"
    assert by_name["Memory extraction prompt flow"].stage == "extraction"
    assert by_name["Memory extraction past-memory lookup"].stage == "consolidation"
    assert by_name["DB store add"].stage == "ingestion"


def test_generic_spans_inherit_what_they_serve():
    events = build("add_messages", "thread.add_messages", "ingestion")
    by_seq = {e.seq: e for e in events}
    lookup = next(e for e in events if e.name == "Memory extraction past-memory lookup")
    nested_search = next(e for e in events if e.name == "OracleAgentMemory search")
    assert nested_search.stage == "consolidation"
    assert by_seq[nested_search.parent_seq].name == "Thread search"
    assert by_seq[by_seq[nested_search.parent_seq].parent_seq] is lookup
    embeds = Counter(e.stage for e in events if e.name == "Embedding request")
    assert embeds == {"consolidation": 1, "ingestion": 3}
    llm = Counter(e.stage for e in events if e.name == "Async LLM generation")
    assert llm == {"summarization": 1, "extraction": 1}


def test_summary_update_end_is_inferred_so_extraction_is_not_nested_under_it():
    events = build("add_messages", "thread.add_messages", "ingestion")
    by_seq = {e.seq: e for e in events}
    update = next(e for e in events if e.name == "Extractor context-summary update")
    flow = next(e for e in events if e.name == "Memory extraction prompt flow")
    assert update.attrs["end_inferred"] and not update.attrs.get("unclosed")
    assert by_seq[flow.parent_seq].name == "Thread memory extraction"
    assert not any(e.attrs.get("unclosed") for e in events)


def test_closing_a_span_closes_what_was_left_open_inside_it():
    b = SpanBuilder()
    name = "oracleagentmemory.core.x"
    b.feed(LogRecordView(name, "Outer started.", 1.0, 10, {}))
    b.feed(LogRecordView(name, "Inner started.", 2.0, 10, {}))
    b.feed(LogRecordView(name, "Outer completed.", 3.0, 10, {}))
    b.feed(LogRecordView(name, "Next started.", 4.0, 10, {}))
    outer, inner, nxt = sorted(b.drain() + [b._open[0]], key=lambda e: e.seq)
    assert inner.attrs["unclosed"] and inner.ended == 3.0
    assert nxt.parent_seq is None


def test_nesting_and_timing():
    events = build("add_messages", "thread.add_messages", "ingestion")
    root = events[0]
    assert root.source == "wrapper" and root.depth == 0
    append = next(e for e in events if e.name == "Thread message append")
    assert append.parent_seq == root.seq and append.depth == 1
    for e in events:
        assert e.duration_ms is not None and e.duration_ms >= 0
        if e.parent_seq:
            parent = next(p for p in events if p.seq == e.parent_seq)
            assert parent.started <= e.started and e.ended <= parent.ended + 1e-6


def test_points_fold_into_their_span():
    events = build("add_messages", "thread.add_messages", "ingestion")
    store_add = next(e for e in events if e.name == "DB store add")
    inserts = [p for p in store_add.attrs.get("points", []) if p["msg"] == "Record-chunk insert completed."]
    assert sum(p["extras"]["inserted_row_count"] for p in inserts) == 4
    # The package logs "parsed records" after "prompt flow completed", so the
    # count lands on the enclosing extraction span.
    extraction = next(e for e in events if e.name == "Thread memory extraction")
    parsed = [p for p in extraction.attrs["points"] if "parsed records" in p["msg"]]
    assert parsed[0]["extras"]["extracted_memory_count"] == 2
    assert all(not e.attrs.get("point") for e in events)


def test_end_extras_are_kept():
    events = build("search_2", "search", "retrieval")
    path = next(e for e in events if e.name == "DB store vector search path")
    assert path.attrs["end"]["result_count"] == 4
    assert {e.stage for e in events} == {"retrieval"}


def test_delete_is_revision():
    events = build("delete_thread", "delete_thread", "revision")
    assert {e.stage for e in events} == {"revision"}


def test_unclosed_spans_close_at_turn_end():
    b = SpanBuilder()
    b.feed(LogRecordView("oracleagentmemory.core.oracledbmemorystore", "DB store add started.", 1.0, 10, {}))
    b.close_all(now=2.0)
    (ev,) = b.drain()
    assert ev.attrs["unclosed"] and ev.duration_ms == 1000


def test_root_point_becomes_its_own_event_and_warnings_are_errors():
    b = SpanBuilder()
    b.feed(LogRecordView("oracleagentmemory.core.embedders.embedder",
                         "Embedding provider call failed with a retryable error.", 1.0, 30, {}))
    (ev,) = b.drain()
    assert ev.attrs["point"] and ev.error and ev.duration_ms == 0


def test_same_key_nests_lifo():
    b = SpanBuilder()
    name = "oracleagentmemory.core.oracleagentmemory"
    for t, msg in [(1, "OracleAgentMemory search started."), (2, "OracleAgentMemory search started."),
                   (3, "OracleAgentMemory search completed."), (4, "OracleAgentMemory search completed.")]:
        b.feed(LogRecordView(name, msg, float(t), 10, {}))
    outer, inner = b.drain()
    assert (outer.started, outer.ended, inner.started, inner.ended) == (1, 4, 2, 3)
    assert inner.parent_seq == outer.seq
