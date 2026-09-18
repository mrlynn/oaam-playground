"""companion --web: the same companion in a browser.

One page, same turn as the terminal: retrieve, assemble, reply, count,
remember. The reply streams back as soon as it exists; the "remembered" line
follows when add_messages returns. Each browser tab gets its own session and
thread; memories carry across them, as they do across terminal sessions.

Every call into the companion runs on a single worker thread. That's not
only about thread safety: the inspector keeps the open turn in a ContextVar,
so search (in respond), record_prompt and add_messages (in remember) must
share one context. loop.run_in_executor, unlike asyncio.to_thread, doesn't
copy the caller's context, so the worker thread's own context carries the
turn. It also serializes turns, so two tabs can't interleave one turn's
search with another's add_messages.
"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from importlib.resources import files
from typing import Any, AsyncIterator, Callable
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from .agent import Companion, Remembered, Reply
from .why import Origin, why_rows

COOKIE = "companion_token"
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}


def is_loopback(host: str) -> bool:
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def diff_counts(rem: Remembered) -> dict[str, int]:
    return {k: len(rem.diff.get(k, [])) for k in ("created", "updated", "deleted")}


@dataclass
class Info:
    db_user: str
    user_id: str
    agent_id: str
    model: str
    dashboard_url: str | None  # the inspector dashboard, for "open in inspector" links


class TurnIn(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)


def create_app(info: Info, make_companion: Callable[[], Companion],
               find_origins: Callable[[list[str]], dict[str, Origin]], *,
               token: str | None = None, on_shutdown: Callable[[], None] | None = None) -> FastAPI:
    worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="companion")
    sessions: dict[str, Companion] = {}

    async def run(fn: Callable[..., Any], *args: Any) -> Any:
        return await asyncio.get_running_loop().run_in_executor(worker, fn, *args)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        worker.shutdown(wait=True)
        if on_shutdown:
            on_shutdown()

    app = FastAPI(title="companion", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # Only this page may drive the companion: it writes memory and spends model credits.
        host = request.headers.get("host", "")
        origin = request.headers.get("origin")
        if token is None and not is_loopback(urlsplit(f"//{host}").hostname or ""):
            return JSONResponse({"detail": "bad host"}, status_code=403)  # DNS rebinding
        if origin is not None and urlsplit(origin).netloc != host:
            return JSONResponse({"detail": "cross-origin request"}, status_code=403)
        if token is not None and request.url.path != "/":
            if not hmac.compare_digest(request.cookies.get(COOKIE, ""), token):
                return JSONResponse({"detail": "open the link with ?token= first"}, status_code=401)
        return await call_next(request)

    def session(sid: str) -> Companion:
        comp = sessions.get(sid)
        if comp is None:
            raise HTTPException(404, "no such session (the server may have restarted)")
        return comp

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        given = request.query_params.get("token")
        if token is not None and given is not None:
            if not hmac.compare_digest(given, token):
                raise HTTPException(401, "wrong token")
            resp = RedirectResponse("/", status_code=303)
            resp.set_cookie(COOKIE, token, httponly=True, samesite="strict")
            return resp
        if token is not None and not hmac.compare_digest(request.cookies.get(COOKIE, ""), token):
            raise HTTPException(401, "open the link with ?token=")
        return HTMLResponse(files("companion").joinpath("static/index.html").read_text())

    @app.get("/api/info")
    async def get_info():
        return info.__dict__

    @app.post("/api/sessions")
    async def new_session():
        comp = make_companion()
        thread_id = await run(comp.new_thread)
        sid = uuid.uuid4().hex
        sessions[sid] = comp
        return {"session_id": sid, "thread_id": thread_id}

    @app.post("/api/sessions/{sid}/new")
    async def new_thread(sid: str):
        return {"thread_id": await run(session(sid).new_thread)}

    @app.post("/api/sessions/{sid}/turns")
    async def turn(sid: str, body: TurnIn):
        comp = session(sid)
        loop = asyncio.get_running_loop()
        events: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        def emit(event: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(events.put_nowait, event)

        def whole_turn() -> None:
            # One job, so a closed tab can't leave a turn half done.
            try:
                reply: Reply = comp.respond(body.message)
                emit({"type": "reply", "text": reply.text, "retrieved": len(reply.results),
                      "in_prompt": len(reply.used), "thread_id": comp.thread.thread_id})
            except Exception as e:  # noqa: BLE001 - shown to the user, like a traceback in the terminal
                emit({"type": "error", "stage": "reply", "message": f"{type(e).__name__}: {e}"})
                return
            try:
                rem = comp.remember(reply)
                emit({"type": "remembered", "seconds": rem.seconds, "turn": rem.turn, **diff_counts(rem)})
            except Exception as e:  # noqa: BLE001
                emit({"type": "error", "stage": "remember", "message": f"{type(e).__name__}: {e}"})

        async def stream() -> AsyncIterator[bytes]:
            job = loop.run_in_executor(worker, whole_turn)
            # Runs after every emit above: both reach the loop through call_soon_threadsafe, in order.
            job.add_done_callback(lambda _: events.put_nowait(None))
            while (event := await events.get()) is not None:
                yield (json.dumps(event) + "\n").encode()

        return StreamingResponse(stream(), media_type="application/x-ndjson")

    @app.get("/api/sessions/{sid}/why")
    async def why(sid: str):
        comp = session(sid)

        def build() -> dict[str, Any]:
            reply = comp.last
            if reply is None:
                return {"message": None, "rows": []}
            thread_id = comp.thread.thread_id if comp.thread else None
            origins = find_origins([r.id for r in reply.results])
            return {"message": reply.user_message, "thread_id": thread_id,
                    "rows": [{"rank": r.rank, "id": r.id, "type": r.record_type, "distance": r.distance,
                              "in_prompt": r.in_prompt, "origin": r.origin_text, "origin_run": r.origin.run_id,
                              "origin_turn": r.origin.turn, "content": r.content}
                             for r in why_rows(reply, origins, thread_id)]}

        return await run(build)

    return app


def serve(cfg: Any, *, host: str, port: int) -> None:
    import os

    import uvicorn

    from .config import LIVE_EXTRACTION_INSTRUCTIONS, open_memory
    from .why import find_origins

    token = os.getenv("COMPANION_WEB_TOKEN") or None
    if token is None and not is_loopback(host):
        raise SystemExit(f"Refusing to listen on {host} without COMPANION_WEB_TOKEN: "
                         "the page writes memory and spends model credits.")
    pool, memory = open_memory(cfg, source="live")

    def close() -> None:
        memory.close()
        pool.close()

    dashboard = os.getenv("COMPANION_DASHBOARD_URL", "http://localhost:3000").rstrip("/") or None
    app = create_app(
        Info(cfg.db_user, cfg.user_id, cfg.agent_id, cfg.llm_model, dashboard),
        lambda: Companion(memory, user_id=cfg.user_id, agent_id=cfg.agent_id, model=cfg.llm_model,
                          extraction_instructions=LIVE_EXTRACTION_INSTRUCTIONS),
        lambda ids: find_origins(pool, ids),
        token=token, on_shutdown=close)
    shown = "localhost" if is_loopback(host) else host
    print(f"companion · {cfg.db_user} · user {cfg.user_id} · http://{shown}:{port}/"
          + (f"?token={token}" if token else ""))
    uvicorn.run(app, host=host, port=port, log_level="warning")
