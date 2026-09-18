import json
import threading

from fastapi.testclient import TestClient

from companion.agent import Companion
from companion.models import Model, is_chat_model
from companion.web import Info, create_app, is_loopback
from companion.why import Origin

from test_companion import FakeMemory


LOCAL = Model("ollama_chat/qwen3.5:9b", "qwen3.5:9b · 9.7B", True)


def make_app(memory=None, fail=None, **kw):
    memory = memory or FakeMemory()
    threads = []

    def chat(model, system, messages):
        threads.append(threading.current_thread().name)
        if fail == "reply":
            raise RuntimeError("provider down")
        return f"{model} reply to {messages[-1]['content']}", {"input_tokens": 42}

    def companion(model):
        return Companion(memory, user_id="me", agent_id="companion", model=model, chat=chat, count=lambda *a: 10,
                         make_llm=lambda m: f"llm:{m}")

    origins = lambda ids: {i: Origin("t0", 3) if i == "m1" else Origin(None, None) for i in ids}
    kw.setdefault("list_models", lambda: ([Model("m", "m (default)", False), LOCAL], None))
    app = create_app(Info("aim_live", "me", "companion", "m", "http://dash"), companion, origins, **kw)
    return TestClient(app, base_url="http://localhost:8765"), memory, threads


def events(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line]


def test_a_turn_streams_the_reply_then_what_it_remembered():
    client, memory, threads = make_app()
    with client:
        sid = client.post("/api/sessions").json()["session_id"]
        evs = events(client.post(f"/api/sessions/{sid}/turns", json={"message": "hello"}))
    assert [e["type"] for e in evs] == ["reply", "remembered"]
    assert evs[0]["text"] == "m reply to hello" and evs[0]["retrieved"] == 7 and evs[0]["in_prompt"] == 5
    assert evs[1]["turn"] == 1 and evs[1]["created"] == 1
    assert memory.inspector.prompts and threads == ["companion_0"]  # the single worker


def test_why_explains_the_last_reply_with_origins():
    client, *_ = make_app()
    with client:
        sid = client.post("/api/sessions").json()["session_id"]
        assert client.get(f"/api/sessions/{sid}/why").json()["rows"] == []
        client.post(f"/api/sessions/{sid}/turns", json={"message": "hello"})
        why = client.get(f"/api/sessions/{sid}/why").json()
    assert why["message"] == "hello" and len(why["rows"]) == 7
    assert [r["in_prompt"] for r in why["rows"]] == [True] * 5 + [False] * 2
    assert why["rows"][0]["origin_run"] == "t0" and "earlier conversation" in why["rows"][0]["origin"]


def test_a_failed_reply_is_an_error_event_and_writes_nothing():
    client, memory, _ = make_app(fail="reply")
    with client:
        sid = client.post("/api/sessions").json()["session_id"]
        evs = events(client.post(f"/api/sessions/{sid}/turns", json={"message": "hello"}))
    assert evs == [{"type": "error", "stage": "reply", "message": "RuntimeError: provider down"}]
    assert memory.inspector.prompts == []


def test_unknown_session_is_404_so_the_page_can_start_over():
    client, *_ = make_app()
    with client:
        assert client.post("/api/sessions/nope/turns", json={"message": "x"}).status_code == 404


def test_cross_origin_and_foreign_hosts_are_refused():
    client, *_ = make_app()
    with client:
        assert client.post("/api/sessions", headers={"Origin": "http://evil.example"}).status_code == 403
        assert client.post("/api/sessions", headers={"Origin": "http://localhost:8765"}).status_code == 200
        assert client.get("/api/info", headers={"Host": "evil.example"}).status_code == 403


def test_token_mode_needs_the_cookie():
    client, *_ = make_app(token="s3cret")
    with client:
        assert client.get("/api/info").status_code == 401
        assert client.get("/?token=wrong", follow_redirects=False).status_code == 401
        assert client.get("/?token=s3cret", follow_redirects=False).status_code == 303
        assert client.get("/api/info").json()["db_user"] == "aim_live"
        assert "<title>Chat · Agent Memory Playground</title>" in client.get("/").text


def test_loopback():
    assert is_loopback("127.0.0.1") and is_loopback("::1") and is_loopback("localhost")
    assert not is_loopback("0.0.0.0") and not is_loopback("example.com")


def test_a_failed_remember_still_shows_the_reply():
    memory = FakeMemory()
    client, *_ = make_app(memory)
    with client:
        sid = client.post("/api/sessions").json()["session_id"]

        def broken(messages):
            raise RuntimeError("extraction timed out")

        memory.create_thread = lambda **kw: type("T", (), {"thread_id": "t9", "add_messages": staticmethod(broken)})()
        client.post(f"/api/sessions/{sid}/new")
        evs = events(client.post(f"/api/sessions/{sid}/turns", json={"message": "hello"}))
    assert [e["type"] for e in evs] == ["reply", "error"]
    assert evs[1] == {"type": "error", "stage": "remember", "message": "RuntimeError: extraction timed out"}


def test_models_lists_the_default_and_local_ones():
    client, *_ = make_app()
    with client:
        body = client.get("/api/models").json()
    assert body["default"] == "m" and [m["id"] for m in body["models"]] == ["m", LOCAL.id] and body["error"] is None


def test_a_session_can_start_on_a_local_model():
    client, memory, _ = make_app()
    with client:
        s = client.post("/api/sessions", json={"model": LOCAL.id}).json()
        evs = events(client.post(f"/api/sessions/{s['session_id']}/turns", json={"message": "hi"}))
    assert s["model"] == LOCAL.id and evs[0]["model"] == LOCAL.id and evs[0]["text"].startswith(LOCAL.id)
    assert memory.thread_kwargs["llm"] == f"llm:{LOCAL.id}"  # extraction uses it too
    assert memory.inspector.described == [("t1", LOCAL.id)]  # and the run log says so


def test_switching_model_starts_a_new_thread():
    client, memory, _ = make_app()
    with client:
        sid = client.post("/api/sessions").json()["session_id"]
        switched = client.post(f"/api/sessions/{sid}/model", json={"model": LOCAL.id}).json()
        back = client.post(f"/api/sessions/{sid}/model", json={"model": None}).json()
    assert switched == {"thread_id": "t1", "model": LOCAL.id} and back["model"] == "m"
    assert [m for _, m in memory.inspector.described] == ["m", LOCAL.id, "m"]


def test_only_offered_models_are_accepted():
    client, *_ = make_app()
    with client:
        assert client.post("/api/sessions", json={"model": "openai/gpt-x"}).status_code == 400
        sid = client.post("/api/sessions").json()["session_id"]
        assert client.post(f"/api/sessions/{sid}/model", json={"model": "ollama_chat/nope"}).status_code == 400


def test_ollama_down_still_offers_the_default():
    client, *_ = make_app(list_models=lambda: ([Model("m", "m (default)", False)], "Ollama not reachable"))
    with client:
        body = client.get("/api/models").json()
    assert [m["id"] for m in body["models"]] == ["m"] and "not reachable" in body["error"]


def test_embedding_and_cloud_models_are_not_chat_models():
    assert is_chat_model({"name": "qwen3.5:9b", "details": {"family": "qwen35"}})
    assert not is_chat_model({"name": "nomic-embed-text:latest", "details": {"family": "nomic-bert"}})
    assert not is_chat_model({"name": "kimi-k2.5:cloud", "details": {}})


def test_a_session_can_be_resumed_by_a_reloaded_page():
    client, *_ = make_app()
    with client:
        s = client.post("/api/sessions", json={"model": LOCAL.id}).json()
        sid = s["session_id"]
        assert client.get(f"/api/sessions/{sid}").json() == {"thread_id": "t1", "model": LOCAL.id, "last": None}
        client.post(f"/api/sessions/{sid}/turns", json={"message": "hi"})
        assert client.get(f"/api/sessions/{sid}").json()["last"] == {"user_message": "hi", "text": f"{LOCAL.id} reply to hi"}
        assert client.get("/api/sessions/gone").status_code == 404


def test_the_inspector_proxy_is_a_trusted_origin():
    # ./demo.sh serves the page at localhost:3000/chat; the proxy forwards to :8765.
    client, *_ = make_app()
    with client:
        via_proxy = {"Origin": "http://localhost:3000", "X-Forwarded-Host": "localhost:3000"}
        assert client.post("/api/sessions", headers=via_proxy).status_code == 200
        assert client.post("/api/sessions", headers={"Origin": "http://localhost:3000"}).status_code == 403
        forged = {"Origin": "http://evil.example", "X-Forwarded-Host": "localhost:3000"}
        assert client.post("/api/sessions", headers=forged).status_code == 403


def test_the_floating_chat_script_is_served():
    # The inspector and the docs load it from /chat/widget.js (./demo.sh).
    client, *_ = make_app()
    with client:
        resp = client.get("/widget.js")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/javascript")
        assert "companion:remembered" in resp.text
