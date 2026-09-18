"""Drop-in wrappers around OracleAgentMemory and OracleThread.

    memory = inspect(OracleAgentMemory(connection=pool, ...), pool=pool)

Every method the agent already calls still works. The ones listed below are
recorded; everything else passes straight through. The wrappers only observe:
arguments go to the package unchanged, results come back unchanged.
"""

from __future__ import annotations

import warnings
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from .diff import Scope, Snapshotter
from .inspector import Inspector, Turn
from .runlog import RunLogWriter

_QUERY_CHARS = 500
_NOT_INSTRUMENTED_WARNED: set[str] = set()


def inspect(memory: Any, pool: Any, *, source: str = "instrumented", llm_model: str | None = None,
            embed_model: str | None = None, memory_table: str | None = None,
            thread_table: str | None = None, capture_logs: bool = True) -> "InspectedMemory":
    """Wrap an OracleAgentMemory client so every turn lands in the run log.

    `pool` is an oracledb connection pool for the same schema (the one you
    built the client with is fine); the inspector borrows connections from it
    to read the memory table and write the run log. Run `memory-inspector init`
    on that schema first. Table names are read from the client; pass them only
    if you use a table_name_prefix the inspector can't see.
    """
    if isinstance(memory, InspectedMemory):
        return memory
    if not hasattr(pool, "acquire"):
        raise TypeError("pool must be an oracledb connection pool (the inspector must not share your connection's transaction)")
    store = getattr(memory, "_store", None)  # private; see docs/friction.md
    snapshotter = Snapshotter(pool, memory_table or getattr(store, "_memory_table", None) or "MEMORY",
                              thread_table or getattr(store, "_thread_table", None) or "THREAD")
    try:
        package_version = version("oracleagentmemory")
    except PackageNotFoundError:
        package_version = None
    writer = RunLogWriter(pool, source=source, llm_model=llm_model, embed_model=embed_model,
                          package_version=package_version)
    inspector = Inspector(writer, snapshotter)
    if capture_logs:
        inspector.install_log_capture()
    return InspectedMemory(memory, inspector)


def _short(text: Any, limit: int = _QUERY_CHARS) -> str | None:
    if text is None:
        return None
    s = str(text)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _kw_scope(kwargs: dict[str, Any]) -> Scope:
    def get(k: str) -> str | None:
        v = kwargs.get(k)
        return v if isinstance(v, str) else None
    return Scope(get("user_id"), get("agent_id"), get("thread_id"))


def _search_result(turn: Turn, query: str, results: Any) -> dict[str, Any]:
    turn.queries.append(_short(query) or "")
    search_no = len(turn.queries)
    rows, ids = [], []
    for rank, r in enumerate(results or [], start=1):
        record = getattr(r, "record", None)
        rid = getattr(r, "id", None)
        ids.append(rid)
        rows.append({
            "search": search_no, "rank": rank, "record_id": rid,
            "record_type": getattr(record, "record_type", None),
            "distance": getattr(r, "distance", None), "thread_id": getattr(record, "thread_id", None),
            "in_prompt": None,
        })
    turn.retrieved.extend(rows)
    return {"output_summary": f"{len(rows)} results", "memory_ids": ids}


def _message_field(message: Any, name: str) -> Any:
    return message.get(name) if isinstance(message, dict) else getattr(message, name, None)


def _warn_async(owner: str, name: str) -> None:
    key = f"{owner}.{name}"
    if key not in _NOT_INSTRUMENTED_WARNED:
        _NOT_INSTRUMENTED_WARNED.add(key)
        warnings.warn(f"memory-inspector: {key} is not instrumented yet; calls pass through unrecorded",
                      stacklevel=3)


class _Passthrough:
    _INSTRUMENTED: frozenset[str] = frozenset()
    _target: Any

    def __getattr__(self, name: str) -> Any:
        if name.endswith("_async") and name[: -len("_async")] in self._INSTRUMENTED:
            _warn_async(type(self._target).__name__, name)
        return getattr(self._target, name)

    def __repr__(self) -> str:
        return f"<inspected {self._target!r}>"


class InspectedThread(_Passthrough):
    _INSTRUMENTED = frozenset({"add_messages", "search", "add_memory", "update_memory", "delete_memory",
                               "get_context_card", "update_message", "delete_message"})

    def __init__(self, thread: Any, inspector: Inspector) -> None:
        self._target = thread
        self.inspector = inspector

    @property
    def _scope(self) -> Scope:
        t = self._target
        return Scope(getattr(t, "user_id", None), getattr(t, "agent_id", None), getattr(t, "thread_id", None))

    def add_messages(self, messages: list[Any], *args: Any, **kwargs: Any) -> list[str]:
        def on_result(turn: Turn, ids: Any) -> dict[str, Any]:
            turn.message_ids.extend(list(ids or []))
            if turn.user_message is None:
                turn.user_message = next((str(_message_field(m, "content")) for m in messages
                                          if _message_field(m, "role") == "user"), None)
            return {"output_summary": f"{len(ids or [])} messages written", "attrs": {"message_ids": list(ids or [])}}
        return self.inspector.call(
            "thread.add_messages", "ingestion", lambda: self._target.add_messages(messages, *args, **kwargs),
            scope=self._scope, input_summary=f"{len(messages)} messages", mutates=True, on_result=on_result,
            closes_turn=True)

    def search(self, query: str, **kwargs: Any) -> Any:
        return self.inspector.call(
            "thread.search", "retrieval", lambda: self._target.search(query, **kwargs),
            scope=self._scope, input_summary=_short(query),
            on_result=lambda turn, results: _search_result(turn, query, results))

    def add_memory(self, content: str, **kwargs: Any) -> str:
        return self.inspector.call(
            "thread.add_memory", "ingestion", lambda: self._target.add_memory(content, **kwargs),
            scope=self._scope, input_summary=_short(content), mutates=True,
            on_result=lambda turn, mid: {"memory_ids": [mid], "output_summary": kwargs.get("memory_type")})

    def update_memory(self, memory_id: str, *args: Any, **kwargs: Any) -> str:
        return self.inspector.call(
            "thread.update_memory", "revision", lambda: self._target.update_memory(memory_id, *args, **kwargs),
            scope=self._scope, input_summary=memory_id, mutates=True,
            on_result=lambda turn, mid: {"memory_ids": [memory_id]})

    def delete_memory(self, memory_id: str) -> int:
        return self.inspector.call(
            "thread.delete_memory", "revision", lambda: self._target.delete_memory(memory_id),
            scope=self._scope, input_summary=memory_id, mutates=True,
            on_result=lambda turn, n: {"memory_ids": [memory_id], "output_summary": f"{n} deleted"})

    def get_context_card(self, *args: Any, **kwargs: Any) -> Any:
        return self.inspector.call(
            "thread.get_context_card", "retrieval", lambda: self._target.get_context_card(*args, **kwargs),
            scope=self._scope, on_result=lambda turn, card: {"output_summary": type(card).__name__})

    def update_message(self, message_id: str, *args: Any, **kwargs: Any) -> str:
        return self.inspector.call(
            "thread.update_message", "revision", lambda: self._target.update_message(message_id, *args, **kwargs),
            scope=self._scope, input_summary=message_id)

    def delete_message(self, message_id: str) -> int:
        return self.inspector.call(
            "thread.delete_message", "revision", lambda: self._target.delete_message(message_id),
            scope=self._scope, input_summary=message_id)


class InspectedMemory(_Passthrough):
    _INSTRUMENTED = frozenset({"create_thread", "search", "add_memory", "update_memory", "delete_memory",
                               "delete_thread"})

    def __init__(self, memory: Any, inspector: Inspector) -> None:
        self._target = memory
        self.inspector = inspector

    def create_thread(self, **kwargs: Any) -> InspectedThread:
        def on_result(turn: Turn, thread: Any) -> dict[str, Any]:
            turn.bind(Scope(getattr(thread, "user_id", None), getattr(thread, "agent_id", None),
                            getattr(thread, "thread_id", None)))
            return {"output_summary": getattr(thread, "thread_id", None)}
        thread = self.inspector.call("create_thread", "other", lambda: self._target.create_thread(**kwargs),
                                     scope=_kw_scope(kwargs), on_result=on_result)
        return InspectedThread(thread, self.inspector)

    def get_thread(self, thread_id: str, **kwargs: Any) -> InspectedThread:
        return InspectedThread(self._target.get_thread(thread_id, **kwargs), self.inspector)

    def search(self, query: str, **kwargs: Any) -> Any:
        return self.inspector.call(
            "search", "retrieval", lambda: self._target.search(query, **kwargs),
            scope=_kw_scope(kwargs), input_summary=_short(query),
            on_result=lambda turn, results: _search_result(turn, query, results))

    def add_memory(self, content: str, **kwargs: Any) -> str:
        scope = _kw_scope(kwargs)
        if scope.thread_id and not scope.user_id:
            scope = self.inspector._safe(lambda: self.inspector.snapshotter.thread_owner(scope.thread_id)) or scope
        return self.inspector.call(
            "add_memory", "ingestion", lambda: self._target.add_memory(content, **kwargs),
            scope=scope, input_summary=_short(content), mutates=True,
            on_result=lambda turn, mid: {"memory_ids": [mid], "output_summary": kwargs.get("memory_type")})

    def update_memory(self, memory_id: str, *args: Any, **kwargs: Any) -> str:
        scope = self.inspector._safe(lambda: self.inspector.snapshotter.memory_owner(memory_id)) or Scope()
        return self.inspector.call(
            "update_memory", "revision", lambda: self._target.update_memory(memory_id, *args, **kwargs),
            scope=scope, input_summary=memory_id, mutates=True,
            on_result=lambda turn, mid: {"memory_ids": [memory_id]})

    def delete_memory(self, memory_id: str) -> int:
        scope = self.inspector._safe(lambda: self.inspector.snapshotter.memory_owner(memory_id)) or Scope()
        return self.inspector.call(
            "delete_memory", "revision", lambda: self._target.delete_memory(memory_id),
            scope=scope, input_summary=memory_id, mutates=True,
            on_result=lambda turn, n: {"memory_ids": [memory_id], "output_summary": f"{n} deleted"})

    def delete_thread(self, thread_id: str) -> int:
        # Look the owner up before the rows are gone, so the diff can show
        # everything the delete took with it.
        scope = self.inspector._safe(lambda: self.inspector.snapshotter.thread_owner(thread_id)) or Scope(thread_id=thread_id)
        return self.inspector.call(
            "delete_thread", "revision", lambda: self._target.delete_thread(thread_id),
            scope=scope, input_summary=thread_id, mutates=True,
            on_result=lambda turn, n: {"output_summary": f"{n} deleted"}, closes_turn=True)

    def close(self, *args: Any, **kwargs: Any) -> None:
        # Let pending extraction finish first so its records land in the turn log.
        try:
            self._target.close(*args, **kwargs)
        finally:
            self.inspector.close()
