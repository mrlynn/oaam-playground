import json
import threading

from fastapi.testclient import TestClient

from companion.agent import Companion
from companion.web import Info, create_app, is_loopback
from companion.why import Origin

from test_companion import FakeMemory


def make_app(memory=None, fail=None, **kw):
    memory = memory or FakeMemory()
    threads = []

    def chat(model, system, messages):
        threads.append(threading.current_thread().name)
        if fail == "reply":
            raise RuntimeError("provider down")
        return f"reply to {messages[-1]['content']}", {"input_tokens": 42}

    def companion():
        return Companion(memory, user_id="me", agent_id="companion", model="m", chat=chat, count=lambda *a: 10)

    origins = lambda ids: {i: Origin("t0", 3) if i == "m1" else Origin(None, None) for i in ids}
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
    assert evs[0]["text"] == "reply to hello" and evs[0]["retrieved"] == 7 and evs[0]["in_prompt"] == 5
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
        assert "<title>Companion</title>" in client.get("/").text


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
