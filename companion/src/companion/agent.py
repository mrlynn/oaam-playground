"""One companion turn: retrieve, assemble, reply, count, remember.

The reply is returned before anything is written, so the REPL can show it
while add_messages (which runs extraction inline, several seconds) happens.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import litellm
from oracleagentmemory.core import MemoryExtractionConfig

from .prompt import flat_prompt, render, scoped_prompt

MEMORY_TYPES = ["memory", "fact", "preference", "guideline"]
SEARCH_RESULTS = 10  # ask for more than we use, so "also returned" is visible
IN_PROMPT = 5
TOKEN_METHOD = "litellm.acount_tokens (provider count API), scoped vs flat, see docs/token-method.md"

Chat = Callable[[str, str, list[dict[str, str]]], tuple[str, Any]]  # (model, system, messages) -> (text, usage)
Counter = Callable[[str, str, list[dict[str, str]]], int | None]  # (model, system, messages) -> tokens


def litellm_chat(model: str, system: str, messages: list[dict[str, str]]) -> tuple[str, Any]:
    resp = litellm.completion(model=model, messages=[{"role": "system", "content": system}, *messages], max_tokens=1024)
    return resp.choices[0].message.content or "", getattr(resp, "usage", None)


def litellm_count(model: str, system: str, messages: list[dict[str, str]]) -> int | None:
    try:
        result = asyncio.run(litellm.acount_tokens(model=model, messages=messages, system=system))
    except Exception:
        return None
    return None if getattr(result, "error", False) else result.total_tokens


@dataclass
class Reply:
    user_message: str
    text: str
    source: str  # "model" or "scripted"
    results: list[Any]
    used: list[Any]
    prompt: str
    usage: Any = None
    prompt_tokens: int | None = None


@dataclass
class Remembered:
    seconds: float
    diff: dict[str, list[Any]] = field(default_factory=dict)
    turn: int | None = None


class Companion:
    def __init__(self, memory: Any, *, user_id: str, agent_id: str, model: str,
                 chat: Chat = litellm_chat, count: Counter = litellm_count,
                 extraction_instructions: str | None = None,
                 make_llm: Callable[[str], Any] | None = None) -> None:
        self.memory = memory
        self.user_id = user_id
        self.agent_id = agent_id
        self.model = model
        self._chat = chat
        self._count = count
        self.extraction_instructions = extraction_instructions
        self._make_llm = make_llm  # given: each thread extracts with self.model, not the client's default
        self.thread: Any = None
        self.history: list[dict[str, str]] = []
        self.last: Reply | None = None

    def new_thread(self) -> str:
        kwargs: dict[str, Any] = {}
        if self.extraction_instructions:
            kwargs["memory_extraction_config"] = MemoryExtractionConfig(
                memory_extraction_custom_instructions=self.extraction_instructions)
        if self._make_llm is not None:
            kwargs["llm"] = self._make_llm(self.model)
        self.thread = self.memory.create_thread(user_id=self.user_id, agent_id=self.agent_id, **kwargs)
        if self._make_llm is not None:
            self.memory.inspector.describe_run(self.thread.thread_id, llm_model=self.model)
        self.history = []
        return self.thread.thread_id

    def respond(self, user_message: str, scripted_reply: str | None = None) -> Reply:
        if self.thread is None:
            self.new_thread()
        results = list(self.memory.search(user_message, user_id=self.user_id, record_types=MEMORY_TYPES,
                                          max_results=SEARCH_RESULTS))
        used = results[:IN_PROMPT]
        memories = [(r.record.record_type, r.record.content) for r in used]
        system, messages = scoped_prompt(user_message, memories, self.history)
        if scripted_reply is None:
            text, usage = self._chat(self.model, system, messages)
            reply = Reply(user_message, text, "model", results, used, render(system, messages), usage=usage)
        else:
            reply = Reply(user_message, scripted_reply, "scripted", results, used, render(system, messages),
                          prompt_tokens=self._count(self.model, system, messages))
        self.last = reply
        return reply

    def remember(self, reply: Reply) -> Remembered:
        flat_system, flat_messages = flat_prompt(reply.user_message, self.history)
        self.memory.inspector.record_prompt(
            reply.prompt, reply.text, usage=reply.usage, prompt_tokens=reply.prompt_tokens,
            memory_ids_used=[r.id for r in reply.used],
            flat_history_tokens=self._count(self.model, flat_system, flat_messages),
            token_method=TOKEN_METHOD, reply_source=reply.source)
        exchange = [{"role": "user", "content": reply.user_message}, {"role": "assistant", "content": reply.text}]
        start = time.perf_counter()
        self.thread.add_messages(exchange)
        self.history.extend(exchange)
        turn = self.memory.inspector.last_turn
        return Remembered(time.perf_counter() - start, (turn.memory_diff or {}) if turn else {},
                          turn.number if turn else None)
