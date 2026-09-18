"""Turn a stream of wrapper calls and package log records into timed events.

Wrapper calls open depth-0 spans. Package log records pair up by logger and
operation name ("X started." / "X completed.") and nest under whatever span was
open when they started. Point records (no start/end) are folded into the
enclosing span's attrs rather than stored as rows of their own. One builder
serves one turn and is fed from the caller's thread and the package's worker
thread, so every method takes the lock.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .stages import CLOSES_WITH, classify, parse_message

MAX_POINTS = 50  # per span; the rest are counted, not kept


@dataclass
class Event:
    seq: int
    parent_seq: int | None
    depth: int
    stage: str
    name: str
    source: str  # "wrapper" or "log"
    started: float  # epoch seconds
    ended: float | None = None
    input_summary: str | None = None
    output_summary: str | None = None
    memory_ids: list[str] | None = None
    scope: dict[str, Any] | None = None
    attrs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    _key: tuple[str, str] | None = None  # (logger, operation) for log spans

    @property
    def started_at(self) -> datetime:
        return datetime.fromtimestamp(self.started, tz=timezone.utc)

    @property
    def duration_ms(self) -> float | None:
        return None if self.ended is None else round((self.ended - self.started) * 1000, 3)


@dataclass(frozen=True)
class LogRecordView:
    """The parts of a logging.LogRecord the builder needs. Tests build these from the fixture."""

    name: str
    message: str
    created: float
    levelno: int
    extras: dict[str, Any]


def _truncate(text: str | None, limit: int = 4000) -> str | None:
    if text is None or len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


class SpanBuilder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seq = 0
        self._open: list[Event] = []  # in start order; the last one is the innermost
        self._done: list[Event] = []

    # wrapper side ---------------------------------------------------------

    def open_wrapper(self, name: str, stage: str, *, input_summary: str | None = None,
                     scope: dict[str, Any] | None = None, now: float) -> Event:
        with self._lock:
            return self._open_span(name, stage, "wrapper", now, input_summary=input_summary, scope=scope)

    def close_wrapper(self, event: Event, *, now: float, output_summary: str | None = None,
                      memory_ids: list[str] | None = None, attrs: dict[str, Any] | None = None,
                      error: str | None = None) -> None:
        with self._lock:
            event.output_summary = _truncate(output_summary)
            event.memory_ids = memory_ids
            if attrs:
                event.attrs.update(attrs)
            if error:
                event.error = _truncate(error)
            self._close(event, now)

    def wrapper_names(self) -> list[str]:
        """The instrumented calls in this turn so far, in start order."""
        with self._lock:
            return [e.name for e in sorted(self._done + self._open, key=lambda e: e.seq) if e.source == "wrapper"]

    # log side ---------------------------------------------------------------

    def feed(self, rec: LogRecordView) -> None:
        parsed = parse_message(rec.message)
        with self._lock:
            if parsed.phase == "start":
                parent = self._open[-1] if self._open else None
                c = classify(rec.name, parsed.key)
                stage = parent.stage if (c.inherit and parent is not None) else c.stage
                ev = self._open_span(parsed.key, stage, "log", rec.created)
                ev._key = (rec.name, parsed.key)
                ev.attrs.update({"logger": rec.name, "mapped": c.mapped, "start": rec.extras})
                return
            if parsed.phase == "end":
                ev = self._find_open(rec.name, parsed.key)
                if ev is not None:
                    if rec.extras:
                        ev.attrs["end"] = rec.extras
                    if parsed.failed or rec.levelno >= 30:
                        ev.error = _truncate(rec.message)
                    self._close(ev, rec.created)
                    outer_key = CLOSES_WITH.get(parsed.key)
                    outer = self._find_open(rec.name, outer_key) if outer_key else None
                    if outer is not None:
                        outer.attrs["end_inferred"] = True
                        self._close(outer, rec.created)
                    return
            # A point, or an end with no matching start ("Record-chunk insert completed.").
            self._point(rec, failed=parsed.failed)

    # lifecycle ------------------------------------------------------------

    def close_all(self, *, now: float) -> None:
        """Close spans still open at turn end, marked unclosed."""
        with self._lock:
            for ev in reversed(list(self._open)):
                if ev in self._open:
                    ev.attrs["unclosed"] = True
                    self._close(ev, now)

    def drain(self) -> list[Event]:
        """Completed events in start order, and forget them."""
        with self._lock:
            out = sorted(self._done, key=lambda e: e.seq)
            self._done = []
            return out

    @property
    def open_count(self) -> int:
        with self._lock:
            return len(self._open)

    # internals (lock held) --------------------------------------------------

    def _open_span(self, name: str, stage: str, source: str, now: float, **kw: Any) -> Event:
        parent = self._open[-1] if self._open else None
        self._seq += 1
        ev = Event(seq=self._seq, parent_seq=parent.seq if parent else None,
                   depth=parent.depth + 1 if parent else 0, stage=stage, name=name, source=source,
                   started=now, **kw)
        self._open.append(ev)
        return ev

    def _find_open(self, logger: str, key: str) -> Event | None:
        for ev in reversed(self._open):
            if ev._key == (logger, key):
                return ev
        return None

    def _close(self, ev: Event, now: float) -> None:
        # Anything opened inside ev and still open never logged its end; close
        # it here so one missing record can't re-parent everything after it.
        for inner in [o for o in self._open if o.seq > ev.seq]:
            inner.attrs["unclosed"] = True
            inner.ended = now
            self._open.remove(inner)
            self._done.append(inner)
        ev.ended = now
        if ev in self._open:
            self._open.remove(ev)
        self._done.append(ev)

    def _point(self, rec: LogRecordView, *, failed: bool) -> None:
        point = {"t": rec.created, "logger": rec.name, "msg": rec.message}
        if rec.extras:
            point["extras"] = rec.extras
        parent = self._open[-1] if self._open else None
        if parent is not None:
            points = parent.attrs.setdefault("points", [])
            if len(points) < MAX_POINTS:
                points.append(point)
            else:
                parent.attrs["points_dropped"] = parent.attrs.get("points_dropped", 0) + 1
            if failed or rec.levelno >= 30:
                parent.attrs.setdefault("warnings", []).append(rec.message)
            return
        # Nothing open: the point becomes its own zero-length event.
        c = classify(rec.name, rec.message)
        self._seq += 1
        ev = Event(seq=self._seq, parent_seq=None, depth=0, stage=c.stage, name=rec.message.rstrip("."),
                   source="log", started=rec.created, ended=rec.created,
                   attrs={"logger": rec.name, "mapped": c.mapped, "point": True, **({"extras": rec.extras} if rec.extras else {})},
                   error=_truncate(rec.message) if (failed or rec.levelno >= 30) else None)
        self._done.append(ev)
