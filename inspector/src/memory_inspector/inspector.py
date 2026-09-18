"""Turns: what groups calls and log records, and when they are written.

A turn opens on the first instrumented call and closes when the agent writes
the exchange (add_messages) or deletes the thread. Everything in between
(searches, explicit memory writes, the package's own log records, including
those from its worker thread) belongs to it. `with inspector.turn():` makes
the boundary explicit instead. Turns with no thread to attach to are written
as unattributed events rather than dropped.

Instrumentation must never break the agent: every piece of bookkeeping runs
through _safe(), and the real package call always runs exactly once.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from .diff import Scope, Snapshot, Snapshotter, diff_memories
from .runlog import RunLogWriter, TurnRecord
from .spans import Event, LogRecordView, SpanBuilder
from .stages import LOGGER_ROOT

log = logging.getLogger("memory_inspector")

_STD_RECORD_ATTRS = set(logging.LogRecord("x", 0, "x", 0, "x", None, None).__dict__) | {"message", "asctime"}


@dataclass
class Turn:
    started: float
    spans: SpanBuilder = field(default_factory=SpanBuilder)
    explicit: bool = False
    thread_id: str | None = None
    user_id: str | None = None
    agent_id: str | None = None
    user_message: str | None = None
    retrieved: list[dict[str, Any]] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    message_ids: list[str] = field(default_factory=list)
    before: Snapshot | None = None
    before_scope: Scope | None = None
    prompt: dict[str, Any] = field(default_factory=dict)
    attrs: dict[str, Any] = field(default_factory=dict)
    write_event: Event | None = None  # the add_messages call, which gets the diff's ids
    closed: bool = False
    number: int | None = None  # set once written
    memory_diff: dict[str, Any] | None = None

    def bind(self, scope: Scope) -> None:
        if scope.thread_id:
            if self.thread_id is None:
                self.thread_id = scope.thread_id
            elif scope.thread_id != self.thread_id:
                self.attrs.setdefault("other_threads", []).append(scope.thread_id)
        self.user_id = self.user_id or scope.user_id
        self.agent_id = self.agent_id or scope.agent_id


class Inspector:
    def __init__(self, writer: RunLogWriter, snapshotter: Snapshotter, *, clock: Callable[[], float] = time.time) -> None:
        self.writer = writer
        self.snapshotter = snapshotter
        self._clock = clock
        self._current: ContextVar[Turn | None] = ContextVar(f"memory_inspector_turn_{id(self)}", default=None)
        self._unattributed = SpanBuilder()
        self._last_turn: Turn | None = None
        self._closed = False

    # turns ------------------------------------------------------------------

    def current_turn(self) -> Turn | None:
        turn = self._current.get()
        return turn if turn is not None and not turn.closed else None

    @property
    def last_turn(self) -> Turn | None:
        """The most recently closed turn in this process (for /why-style tools)."""
        return self._last_turn

    def _ensure_turn(self) -> Turn:
        turn = self.current_turn()
        if turn is None:
            turn = Turn(started=self._clock())
            self._current.set(turn)
        return turn

    @contextmanager
    def turn(self, thread: Any = None) -> Iterator[Turn]:
        """Make the turn boundary explicit: everything inside is one turn,
        closed on exit even if add_messages ran more than once (or never)."""
        open_turn = self.current_turn()
        if open_turn is not None:
            self._safe(lambda: self.close_turn(open_turn, "explicit_turn_started"))
        turn = Turn(started=self._clock(), explicit=True)
        if thread is not None:
            turn.bind(Scope(getattr(thread, "user_id", None), getattr(thread, "agent_id", None),
                            getattr(thread, "thread_id", None)))
        token = self._current.set(turn)
        try:
            yield turn
        finally:
            self._safe(lambda: self.close_turn(turn, "explicit"))
            self._current.reset(token)

    def record_prompt(self, prompt: str | None = None, reply: str | None = None, *, usage: Any = None,
                      memory_ids_used: list[str] | None = None, prompt_tokens: int | None = None,
                      flat_history_tokens: int | None = None, token_method: str | None = None,
                      reply_source: str | None = None) -> None:
        """Optional: tell the inspector what the agent sent and got back this turn.
        memory_ids_used marks which search results made it into the prompt.
        prompt_tokens defaults to the input tokens in `usage`; pass it when
        there was no model call (a scripted reply) and you counted instead."""
        def apply() -> None:
            turn = self._ensure_turn()
            u = _usage_dict(usage)
            turn.prompt.update(
                assembled_prompt=prompt, reply=reply, usage=u, flat_history_tokens=flat_history_tokens,
                token_method=token_method, reply_source=reply_source,
                prompt_tokens=prompt_tokens if prompt_tokens is not None
                else (u or {}).get("input_tokens") or (u or {}).get("prompt_tokens"),
            )
            if memory_ids_used is not None:
                turn.prompt["memory_ids_used"] = list(memory_ids_used)
        self._safe(apply)

    # instrumented calls -----------------------------------------------------------

    def call(self, name: str, stage: str, fn: Callable[[], Any], *, scope: Scope = Scope(),
             input_summary: str | None = None, mutates: bool = False,
             on_result: Callable[[Turn, Any], dict[str, Any] | None] | None = None,
             closes_turn: bool = False) -> Any:
        turn = self._safe(lambda: self._prepare(scope, mutates))
        ev = None
        if turn is not None:
            ev = self._safe(lambda: turn.spans.open_wrapper(
                name, stage, input_summary=input_summary, now=self._clock(),
                scope={k: v for k, v in vars(scope).items() if v is not None} or None))
        try:
            result = fn()
        except BaseException as exc:
            if ev is not None:
                self._safe(lambda: turn.spans.close_wrapper(ev, now=self._clock(), error=f"{type(exc).__name__}: {exc}"))
            raise
        if ev is not None:
            def finish() -> None:
                extra = (on_result(turn, result) if on_result else None) or {}
                if name.endswith("add_messages"):
                    turn.write_event = ev
                turn.spans.close_wrapper(ev, now=self._clock(), **extra)
            self._safe(finish)
            if closes_turn and not turn.explicit:
                self._safe(lambda: self.close_turn(turn, name))
        return result

    def _prepare(self, scope: Scope, mutates: bool) -> Turn:
        turn = self._ensure_turn()
        turn.bind(scope)
        if mutates and turn.before is None:
            snap_scope = Scope(turn.user_id, turn.agent_id, turn.thread_id)
            if snap_scope.usable():
                turn.before = self.snapshotter.take(snap_scope)
                turn.before_scope = snap_scope
        return turn

    def close_turn(self, turn: Turn, closed_by: str) -> None:
        if turn.closed:
            return
        turn.closed = True
        now = self._clock()
        turn.spans.close_all(now=now)
        turn.attrs["closed_by"] = closed_by
        if turn.before is not None and turn.before_scope is not None:
            after = self._safe(lambda: self.snapshotter.take(turn.before_scope))
            if after is not None:
                turn.memory_diff = diff_memories(turn.before, after)
                turn.attrs["computed"] = ["memory_diff"]
                if turn.write_event is not None:
                    touched = [m["id"] for m in turn.memory_diff["created"] + turn.memory_diff["updated"]]
                    turn.write_event.memory_ids = touched
                    turn.write_event.attrs["computed"] = ["memory_ids"]
        used = turn.prompt.pop("memory_ids_used", None)
        if used is not None:
            used_set = set(used)
            for r in turn.retrieved:
                r["in_prompt"] = r["record_id"] in used_set
        if turn.queries:
            turn.attrs["queries"] = turn.queries
        events = turn.spans.drain()
        if turn.thread_id is None:
            for ev in events:
                ev.attrs["no_thread"] = True
            self.writer.flush_unattributed(events)
        else:
            turn.number = self.writer.flush_turn(TurnRecord(
                run_id=turn.thread_id, started=turn.started, duration_ms=round((now - turn.started) * 1000, 3),
                user_id=turn.user_id, agent_id=turn.agent_id, user_message=turn.user_message,
                retrieved=turn.retrieved, message_ids=turn.message_ids, memory_diff=turn.memory_diff,
                attrs=turn.attrs, **turn.prompt,
            ), events)
        self._last_turn = turn
        self.writer.flush_unattributed(self._unattributed.drain())

    def close(self) -> None:
        """Close any open turn, write what is buffered, stop capturing logs."""
        if self._closed:
            return
        self._closed = True
        turn = self.current_turn()
        if turn is not None:
            self._safe(lambda: self.close_turn(turn, "close"))
        self._unattributed.close_all(now=self._clock())
        self._safe(lambda: self.writer.flush_unattributed(self._unattributed.drain()))
        _capture.remove(self)

    # log capture ------------------------------------------------------------

    def install_log_capture(self) -> None:
        _capture.add(self)

    def _on_record(self, record: logging.LogRecord) -> bool:
        """Route one package log record. True if it belonged to an open turn here."""
        view = _view(record)
        turn = self._current.get()
        if turn is not None and not turn.closed:
            turn.spans.feed(view)
            return True
        return False

    def _on_unclaimed(self, record: logging.LogRecord) -> None:
        view = _view(record)
        turn = self._current.get()
        if turn is not None and turn.closed and turn.number is not None:
            # Arrived after its turn was written: background extraction, most likely.
            view.extras["late_for"] = {"run_id": turn.thread_id, "turn": turn.number}
        self._unattributed.feed(view)

    # helpers ----------------------------------------------------------------

    def _safe(self, fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except Exception as exc:
            log.warning("memory-inspector: instrumentation error (agent unaffected): %s: %s", type(exc).__name__, exc)
            return None


def _view(record: logging.LogRecord) -> LogRecordView:
    extras = {}
    for k, v in record.__dict__.items():
        if k in _STD_RECORD_ATTRS or k == "taskName":
            continue
        extras[k] = v if isinstance(v, (str, int, float, bool, type(None), list, dict)) else repr(v)
    return LogRecordView(record.name, record.getMessage(), record.created, record.levelno, extras)


def _usage_dict(usage: Any) -> dict[str, Any] | None:
    if usage is None or isinstance(usage, dict):
        return usage
    for attr in ("model_dump", "dict", "to_dict"):
        if hasattr(usage, attr):
            try:
                return getattr(usage, attr)()
            except Exception:
                pass
    return {k: v for k, v in vars(usage).items() if not k.startswith("_")} if hasattr(usage, "__dict__") else {"value": str(usage)}


class _Capture(logging.Handler):
    """One handler on the `oracleagentmemory` logger, shared by every inspector
    in the process. It turns the package logger up to DEBUG to see everything,
    stops those records from propagating, and re-dispatches the ones the
    application would have seen anyway (at or above the level in force before)
    to the root logger, so the app's own logging output does not change."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self._inspectors: list[Inspector] = []
        self._lock_list = threading.Lock()
        self._saved: tuple[int, bool] | None = None
        self._passthrough_level = logging.WARNING

    def add(self, inspector: Inspector) -> None:
        with self._lock_list:
            if inspector in self._inspectors:
                return
            self._inspectors.append(inspector)
            if len(self._inspectors) == 1:
                logger = logging.getLogger(LOGGER_ROOT)
                self._saved = (logger.level, logger.propagate)
                self._passthrough_level = logger.getEffectiveLevel() if logger.propagate else logging.CRITICAL + 1
                logger.setLevel(logging.DEBUG)
                logger.propagate = False
                logger.addHandler(self)

    def remove(self, inspector: Inspector) -> None:
        with self._lock_list:
            if inspector not in self._inspectors:
                return
            self._inspectors.remove(inspector)
            if not self._inspectors and self._saved is not None:
                logger = logging.getLogger(LOGGER_ROOT)
                logger.removeHandler(self)
                logger.setLevel(self._saved[0])
                logger.propagate = self._saved[1]
                self._saved = None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            inspectors = list(self._inspectors)
            if inspectors and not any(i._on_record(record) for i in inspectors):
                inspectors[0]._on_unclaimed(record)
        except Exception:
            pass
        if record.levelno >= self._passthrough_level:
            logging.getLogger().handle(record)


_capture = _Capture()
