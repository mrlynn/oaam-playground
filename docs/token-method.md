# Token method: scoped vs flat

How the companion fills `prompt_tokens` and `flat_history_tokens` in `AIM_TURNS`, and so what the cost view (M5) compares. These are our numbers. The report's figures, about 1,300 against 13,900 input tokens at turn 80, are cited separately and not reproduced here.

## Two prompts per turn

**Scoped** is what the companion actually sends:
- the system prompt, plus a numbered list of the top 5 memories from `search`, scoped to the user and to the types memory, fact, preference and guideline
- the last 6 messages of the current thread
- the new user message

**Flat** is what you'd send with no memory system:
- the same system prompt, without the memories block
- every message of the current thread
- the new user message

Flat covers **the current thread only**. The companion starts a thread per session, so flat history resets at `/new` while memories carry over. That's the honest comparison for one conversation. It isn't the right model for "everything the user ever said", which grows without bound.

## Counting

- **Scoped, live:** `usage.prompt_tokens` from the model's response, which is exactly what was billed.
- **Scoped, replay:** `litellm.acount_tokens` on the assembled prompt. There's no model call in replay.
- **Flat, always:** `litellm.acount_tokens`. For Anthropic models this calls the provider's count-tokens API (`tokenizer_type = anthropic_api`), the same tokenizer as the real call. If counting fails the value is NULL, never an estimate.

Replies aren't counted. Output tokens are the same either way.

## What this leaves out

- **Tokens the memory package spends on its own work.** That's two or three LLM calls per turn for the context summary and extraction. The package patches LiteLLM so callbacks can't see these calls, and `Llm.generate` doesn't return usage (friction log 03:20 and 03:50). A fair total-cost comparison needs these, and today it can't have them. The cost view must say so.
- **Latency.** Reported separately (retrieval spans in the run log, extraction time per turn).

## Early turns cost more with memory

In the first seeds, scoped prompts were larger than flat ones: 352 against 163 tokens at turn 1 of `support_01`. Five memories from the user's earlier threads cost more than a short conversation does. Memory only pays off once the thread is long enough that 6 recent messages plus 5 memories are smaller than the whole history. The cost view should show where that crossover falls, not only turn 80.
