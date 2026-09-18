from dataclasses import dataclass, field

from companion.agent import IN_PROMPT, MEMORY_TYPES, Companion
from companion.prompt import NO_MEMORIES, flat_prompt, scoped_prompt
from companion.why import Origin, describe_origin, render_why


@dataclass
class Rec:
    record_type: str
    content: str


@dataclass
class Result:
    id: str
    distance: float
    record: Rec


@dataclass
class FakeTurn:
    number: int
    memory_diff: dict


class FakeInspector:
    def __init__(self):
        self.prompts = []
        self.last_turn = None

    def record_prompt(self, *args, **kwargs):
        self.prompts.append((args, kwargs))


@dataclass
class FakeThread:
    thread_id: str
    written: list = field(default_factory=list)
    inspector: FakeInspector = None

    def add_messages(self, messages):
        self.written.append(messages)
        self.inspector.last_turn = FakeTurn(len(self.written), {"created": [{"id": "new"}]})


class FakeMemory:
    def __init__(self, n_results=7):
        self.inspector = FakeInspector()
        self.searches = []
        self.n = n_results

    def create_thread(self, **kw):
        self.thread_kwargs = kw
        return FakeThread("t1", inspector=self.inspector)

    def search(self, query, **kw):
        self.searches.append((query, kw))
        return [Result(f"m{i}", 0.1 * i, Rec("fact", f"memory {i}")) for i in range(1, self.n + 1)]


def make(**kw):
    counted = []

    def count(model, system, messages):
        counted.append((system, messages))
        return 100 + len(messages)

    comp = Companion(FakeMemory(**kw), user_id="me", agent_id="companion", model="m",
                     chat=lambda model, system, messages: (f"reply to {messages[-1]['content']}", {"input_tokens": 42}),
                     count=count)
    return comp, counted


def test_scoped_prompt_keeps_the_last_six_messages():
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": str(i)} for i in range(10)]
    system, messages = scoped_prompt("new", [("fact", "a"), ("preference", "b")], history)
    assert "1. [fact] a\n2. [preference] b" in system
    assert [m["content"] for m in messages] == ["4", "5", "6", "7", "8", "9", "new"]


def test_scoped_prompt_says_when_there_are_no_memories():
    system, _ = scoped_prompt("hi", [], [])
    assert NO_MEMORIES in system


def test_flat_prompt_has_everything_and_no_memories():
    history = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
    system, messages = flat_prompt("c", history)
    assert "Memories:" not in system and [m["content"] for m in messages] == ["a", "b", "c"]


def test_search_is_scoped_to_the_user_and_memory_types():
    comp, _ = make()
    comp.respond("hello")
    (query, kw), = comp.memory.searches
    assert query == "hello" and kw["user_id"] == "me" and kw["record_types"] == MEMORY_TYPES


def test_only_the_top_results_go_in_the_prompt_and_are_reported():
    comp, _ = make()
    reply = comp.respond("hello")
    comp.remember(reply)
    assert len(reply.used) == IN_PROMPT and len(reply.results) == 7
    assert "memory 5" in reply.prompt and "memory 6" not in reply.prompt
    (_, kwargs), = comp.memory.inspector.prompts
    assert kwargs["memory_ids_used"] == ["m1", "m2", "m3", "m4", "m5"]
    assert kwargs["reply_source"] == "model" and kwargs["usage"] == {"input_tokens": 42}


def test_flat_history_grows_by_exactly_one_exchange_per_turn():
    comp, counted = make()
    for i in range(4):
        comp.remember(comp.respond(f"u{i}"))
    flat_lengths = [len(messages) for system, messages in counted if "Memories:" not in system]
    assert flat_lengths == [1, 3, 5, 7]
    assert [kw["flat_history_tokens"] for _, kw in comp.memory.inspector.prompts] == [101, 103, 105, 107]


def test_scripted_replies_are_counted_not_generated():
    comp, counted = make()
    reply = comp.respond("hi", scripted_reply="scripted answer")
    comp.remember(reply)
    (_, kwargs), = comp.memory.inspector.prompts
    assert reply.text == "scripted answer" and kwargs["reply_source"] == "scripted"
    assert kwargs["prompt_tokens"] == 101 and kwargs["usage"] is None


def test_remember_writes_the_exchange_and_reports_the_diff():
    comp, _ = make()
    rem = comp.remember(comp.respond("hi"))
    assert comp.thread.written == [[{"role": "user", "content": "hi"}, {"role": "assistant", "content": "reply to hi"}]]
    assert rem.turn == 1 and rem.diff["created"] == [{"id": "new"}]


def test_new_thread_resets_history():
    comp, _ = make()
    comp.remember(comp.respond("hi"))
    comp.new_thread()
    assert comp.history == []


def test_why_labels_prompt_membership_and_origin():
    comp, _ = make()
    reply = comp.respond("where is the bucket?")
    origins = {"m1": Origin("t1", 2), "m6": Origin("t0-older-thread", 4)}
    text = render_why(reply, origins, "t1")
    lines = text.splitlines()
    assert "in prompt" in lines[2] and "created at turn 2 of this conversation" in lines[2]
    m6 = next(line for line in lines if line.startswith("  #6"))
    assert "also returned" in m6 and "earlier conversation (t0-older…, turn 4)" in m6
    assert "before the inspector was running" in next(line for line in lines if line.startswith("  #3"))


def test_why_before_anything_was_said():
    assert "Nothing to explain" in render_why(None, {}, None)
    assert describe_origin(Origin(None, None), "t") == "created before the inspector was running"


def test_extraction_instructions_reach_the_thread_only_when_set():
    memory = FakeMemory()
    Companion(memory, user_id="me", agent_id="companion", model="m").new_thread()
    assert "memory_extraction_custom_instructions" not in memory.thread_kwargs  # scripted replays
    Companion(memory, user_id="me", agent_id="companion", model="m", extraction_instructions="keep it durable").new_thread()
    assert memory.thread_kwargs["memory_extraction_custom_instructions"] == "keep it durable"
