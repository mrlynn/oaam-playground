"""Turn inference, attribution and failure isolation, against a fake client
that logs the way oracleagentmemory 26.6.0 does (including from a worker thread)."""

import contextvars
import logging
import threading
import warnings
from dataclasses import dataclass

import pytest

from memory_inspector.diff import MemoryRow, Scope
from memory_inspector.inspector import Inspector
from memory_inspector.wrapper import InspectedMemory

PKG = "oracleagentmemory"


class FakeWriter:
    def __init__(self):
        self.turns, self.unattributed, self.counts = [], [], {}

    def flush_turn(self, rec, events):
        n = self.counts.get(rec.run_id, 0) + 1
        self.counts[rec.run_id] = n
        self.turns.append((n, rec, events))
        return n

    def flush_unattributed(self, events):
        self.unattributed.extend(events)


class FakeSnapshotter:
    def __init__(self, store):
        self.store = store
        self.fail = False

    def take(self, scope):
        if self.fail:
            raise RuntimeError("snapshot broke")
        return {k: v for k, v in self.store.items() if v.thread_id and (scope.user_id or scope.thread_id)}

    def thread_owner(self, thread_id):
        return Scope("u1", "a1", thread_id)

    def memory_owner(self, memory_id):
        return Scope("u1", "a1", "t1")


@dataclass
class Record:
    record_type: str
    thread_id: str


@dataclass
class Result:
    id: str
    distance: float
    record: Record


def plog(logger, msg, level=logging.DEBUG):
    logging.getLogger(f"{PKG}.{logger}").log(level, msg)


def on_worker(fn):
    """Run fn on another thread with the caller's context, as AnyIO's to_thread does."""
    ctx = contextvars.copy_context()
    t = threading.Thread(target=ctx.run, args=(fn,))
    t.start()
    t.join()


class FakeThread:
    def __init__(self, store, thread_id, user_id="u1", agent_id="a1"):
        self.store, self.thread_id, self.user_id, self.agent_id = store, thread_id, user_id, agent_id
        self.n = 0

    def add_messages(self, messages, **kw):
        plog("core.thread", "Thread message append started.")
        plog("core.extractors._oneshotextractor", "Thread memory extraction started.")
        plog("core.extractors._oneshotextractor", "Thread memory extraction completed.")

        def write():
            plog("core.oracledbmemorystore", "DB store add started.")
            self.n += 1
            mid = f"{self.thread_id}-m{self.n}"
            self.store[mid] = MemoryRow(mid, "fact", f"fact {self.n}", self.thread_id)
            plog("core.oracledbmemorystore", "DB store add completed.")
        on_worker(write)
        plog("core.thread", "Thread message append completed.")
        return [f"msg{i}" for i in range(len(messages))]

    def search(self, query, **kw):
        return FakeMemory.search(self, query)

    def get_messages(self):
        return ["passthrough"]


class FakeMemory:
    def __init__(self):
        self.store = {}
        self.closed = False

    def create_thread(self, **kw):
        plog("core.oracleagentmemory", "OracleAgentMemory thread creation started.")
        plog("core.oracleagentmemory", "OracleAgentMemory thread created.")
        return FakeThread(self.store, kw.get("thread_id", "t1"), kw.get("user_id", "u1"))

    def search(self, query, **kw):
        plog("core.oracleagentmemory", "OracleAgentMemory search started.")
        on_worker(lambda: plog("core.oracledbmemorystore", "DB store search started.")
                  or plog("core.oracledbmemorystore", "DB store search completed."))
        plog("core.oracleagentmemory", "OracleAgentMemory search completed.")
        return [Result("m-a", 0.27, Record("preference", "t0")), Result("msg-x", 0.41, Record("message", "t1"))]

    def delete_thread(self, thread_id):
        for k in [k for k, v in self.store.items() if v.thread_id == thread_id]:
            del self.store[k]
        return 1

    def search_async(self, *a, **k):
        return "async"

    def close(self, *a, **k):
        self.closed = True


@pytest.fixture
def env():
    fake = FakeMemory()
    writer = FakeWriter()
    snap = FakeSnapshotter(fake.store)
    inspector = Inspector(writer, snap)
    inspector.install_log_capture()
    memory = InspectedMemory(fake, inspector)
    yield memory, writer, snap, fake
    inspector.close()


def test_search_then_add_messages_is_one_turn(env):
    memory, writer, _, _ = env
    thread = memory.create_thread(user_id="u1")
    memory.search("how does alice like to be contacted?", user_id="u1")
    thread.add_messages([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    (n, rec, events), = writer.turns
    assert n == 1 and rec.run_id == "t1" and rec.user_message == "hi"
    assert rec.message_ids == ["msg0", "msg1"]
    assert [(r["rank"], r["record_id"], r["record_type"], r["distance"]) for r in rec.retrieved] == [
        (1, "m-a", "preference", 0.27), (2, "msg-x", "message", 0.41)]
    assert rec.attrs["closed_by"] == "thread.add_messages"
    names = [e.name for e in events]
    assert names[0] == "create_thread" and "search" in names and "thread.add_messages" in names
    # Records from the worker thread landed in this turn, nested under their caller.
    store_add = next(e for e in events if e.name == "DB store add")
    assert store_add.source == "log" and store_add.stage == "ingestion"
    parent = next(e for e in events if e.seq == store_add.parent_seq)
    assert parent.name == "Thread message append"


def test_diff_and_write_event_ids(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    thread.add_messages([{"role": "user", "content": "a"}])
    (_, rec, events), = writer.turns
    assert [m["id"] for m in rec.memory_diff["created"]] == ["t1-m1"]
    write = next(e for e in events if e.name == "thread.add_messages")
    assert write.memory_ids == ["t1-m1"] and write.attrs["computed"] == ["memory_ids"]


def test_turn_numbers_continue(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    for i in range(3):
        thread.search(f"q{i}")
        thread.add_messages([{"role": "user", "content": f"u{i}"}])
    assert [n for n, _, _ in writer.turns] == [1, 2, 3]
    assert [rec.user_message for _, rec, _ in writer.turns] == ["u0", "u1", "u2"]


def test_two_searches_share_a_turn(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    memory.search("first", user_id="u1")
    memory.search("second", user_id="u1")
    thread.add_messages([{"role": "user", "content": "x"}])
    (_, rec, _), = writer.turns
    assert [r["search"] for r in rec.retrieved] == [1, 1, 2, 2]
    assert rec.attrs["queries"] == ["first", "second"]


def test_record_prompt_marks_what_was_used(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    memory.search("q", user_id="u1")
    memory.inspector.record_prompt("SYSTEM ...", "reply", usage={"input_tokens": 812, "output_tokens": 40},
                                   memory_ids_used=["m-a"], flat_history_tokens=2400, token_method="count_tokens",
                                   reply_source="model")
    thread.add_messages([{"role": "user", "content": "x"}])
    (_, rec, _), = writer.turns
    assert [r["in_prompt"] for r in rec.retrieved] == [True, False]
    assert rec.prompt_tokens == 812 and rec.flat_history_tokens == 2400 and rec.reply_source == "model"


def test_counted_prompt_tokens_without_usage(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    memory.inspector.record_prompt("p", "scripted reply", prompt_tokens=345, reply_source="scripted")
    thread.add_messages([{"role": "user", "content": "x"}])
    (_, rec, _), = writer.turns
    assert rec.prompt_tokens == 345 and rec.usage is None


def test_in_prompt_is_unknown_without_record_prompt(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    memory.search("q", user_id="u1")
    thread.add_messages([{"role": "user", "content": "x"}])
    (_, rec, _), = writer.turns
    assert [r["in_prompt"] for r in rec.retrieved] == [None, None]


def test_search_without_a_thread_is_unattributed_at_close(env):
    memory, writer, _, _ = env
    memory.search("orphan", user_id="u1")
    memory.close()
    assert writer.turns == []
    wrapper = [e for e in writer.unattributed if e.source == "wrapper"]
    assert [e.name for e in wrapper] == ["search"] and wrapper[0].attrs["no_thread"]


def test_explicit_turn_spans_two_writes(env):
    memory, writer, _, _ = env
    thread = memory.create_thread()
    writer.turns.clear()
    with memory.inspector.turn(thread):
        thread.add_messages([{"role": "user", "content": "one"}])
        thread.add_messages([{"role": "user", "content": "two"}])
    (n, rec, _), = [t for t in writer.turns if t[1].attrs["closed_by"] == "explicit"]
    assert rec.message_ids == ["msg0", "msg0"] and len(rec.memory_diff["created"]) == 2


def test_delete_thread_closes_a_turn_showing_what_went(env):
    memory, writer, _, fake = env
    thread = memory.create_thread()
    thread.add_messages([{"role": "user", "content": "x"}])
    memory.delete_thread("t1")
    last_n, rec, _ = writer.turns[-1]
    assert last_n == 2 and rec.attrs["closed_by"] == "delete_thread"
    assert [m["id"] for m in rec.memory_diff["deleted"]] == ["t1-m1"]


def test_instrumentation_failure_does_not_reach_the_agent(env, caplog):
    memory, writer, snap, _ = env
    snap.fail = True
    thread = memory.create_thread()
    with caplog.at_level(logging.WARNING, logger="memory_inspector"):
        ids = thread.add_messages([{"role": "user", "content": "x"}])
    assert ids == ["msg0"]
    assert "instrumentation error" in caplog.text


def test_package_errors_still_raise_and_are_recorded(env):
    memory, writer, _, fake = env
    thread = memory.create_thread()

    def boom(*a, **k):
        raise ValueError("ORA-12345")
    fake.search = boom
    with pytest.raises(ValueError, match="ORA-12345"):
        memory.search("q")
    thread.add_messages([{"role": "user", "content": "x"}])
    (_, _, events), = writer.turns
    failed = next(e for e in events if e.name == "search")
    assert "ORA-12345" in failed.error


def test_passthrough_and_async_warning(env):
    memory, _, _, _ = env
    thread = memory.create_thread()
    assert thread.get_messages() == ["passthrough"]
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        assert memory.search_async("q") == "async"
    assert any("not instrumented" in str(x.message) for x in w)


def test_close_closes_the_client_and_restores_logging(env):
    memory, _, _, fake = env
    logger = logging.getLogger(PKG)
    assert logger.propagate is False
    memory.close()
    assert fake.closed and logger.propagate is True
    assert not any(type(h).__name__ == "_Capture" for h in logger.handlers)


def test_app_logging_sees_only_what_it_saw_before(env):
    seen = []

    class Collect(logging.Handler):
        def emit(self, record):
            seen.append(record.levelno)
    root = logging.getLogger()
    h = Collect(level=logging.NOTSET)
    root.addHandler(h)
    try:
        plog("core.thread", "debug noise")
        plog("core.thread", "something went wrong", logging.WARNING)
    finally:
        root.removeHandler(h)
    assert seen == [logging.WARNING]


def test_describe_run_overrides_models_for_that_run_only():
    from memory_inspector.runlog import RunLogWriter

    w = RunLogWriter(None, source="live", llm_model="anthropic/claude-sonnet-5", embed_model="ollama/nomic-embed-text")
    w.describe_run("t2", llm_model="ollama_chat/qwen3.5:9b")
    assert w.run_meta("t2")["llm_model"] == "ollama_chat/qwen3.5:9b"
    assert w.run_meta("t2")["embed_model"] == "ollama/nomic-embed-text"
    assert w.run_meta("t1")["llm_model"] == "anthropic/claude-sonnet-5"


def test_describe_run_never_reaches_the_agent_as_an_error(env):
    memory, *_ = env
    memory.inspector.describe_run("t1", llm_model="x")  # the fake writer has no describe_run


def test_a_thread_created_after_an_unused_one_gets_its_own_turn(env):
    # /new twice, or a model switch, before anyone speaks
    memory, writer, _, _ = env
    memory.create_thread(user_id="u1", thread_id="t1")
    thread = memory.create_thread(user_id="u1", thread_id="t2")
    memory.search("anything", user_id="u1")
    thread.add_messages([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    (n, rec, events), = writer.turns
    assert rec.run_id == "t2" and "other_threads" not in rec.attrs
    assert [e.name for e in events].count("create_thread") == 1


def test_a_turn_with_work_in_it_is_not_dropped_by_create_thread(env):
    memory, writer, _, _ = env
    first = memory.create_thread(user_id="u1", thread_id="t1")
    memory.search("anything", user_id="u1")
    memory.create_thread(user_id="u1", thread_id="t2")
    first.add_messages([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}])
    (n, rec, events), = writer.turns
    assert rec.run_id == "t1" and "search" in [e.name for e in events]
