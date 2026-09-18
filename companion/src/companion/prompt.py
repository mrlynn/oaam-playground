"""Prompt assembly, for the real call and for the flat-history comparison.

Scoped: system prompt + top memories from search + the last few messages of
this thread + the new user message. Flat: the same system prompt without
memories + every message of this thread + the new user message, i.e. what
you would send with no memory system at all. docs/token-method.md has the
reasoning.
"""

from __future__ import annotations

from typing import Any, Sequence

SYSTEM = """You are a work companion. The user talks to you about their projects, decisions, people and plans, \
usually in short sessions spread over days. Be direct and brief. Ask a question when something is unclear.

Earlier conversations are not in this chat. What you know about them is in the memories below, which were \
extracted automatically and may be incomplete or out of date. Use them when they help; say so when you rely on one, \
and ask if two of them disagree."""

NO_MEMORIES = "(no memories retrieved)"
RECENT_MESSAGES = 6


def format_memories(memories: Sequence[tuple[str, str]]) -> str:
    """[(record_type, content)] as a numbered list."""
    if not memories:
        return NO_MEMORIES
    return "\n".join(f"{i}. [{kind}] {content}" for i, (kind, content) in enumerate(memories, start=1))


def scoped_prompt(user_message: str, memories: Sequence[tuple[str, str]], history: Sequence[dict[str, str]],
                  *, recent: int = RECENT_MESSAGES) -> tuple[str, list[dict[str, str]]]:
    system = f"{SYSTEM}\n\nMemories:\n{format_memories(memories)}"
    tail = list(history[-recent:]) if recent else []
    return system, tail + [{"role": "user", "content": user_message}]


def flat_prompt(user_message: str, history: Sequence[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    return SYSTEM, list(history) + [{"role": "user", "content": user_message}]


def render(system: str, messages: Sequence[dict[str, Any]]) -> str:
    """The prompt as one readable string, for the run log."""
    parts = [f"<system>\n{system}\n</system>"]
    parts += [f"<{m['role']}>\n{m['content']}\n</{m['role']}>" for m in messages]
    return "\n\n".join(parts)
