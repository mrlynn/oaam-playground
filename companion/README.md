# companion

A small work companion, in the terminal or the browser. You talk through your projects, decisions and plans in short sessions, and it remembers across them using [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It's small on purpose. Its job is to produce honest memory behavior from real use, so the [memory inspector](../inspector/README.md) has something real to show.

It's also the proof that the inspector drops into another project. Everything inspector-specific is in `config.py` (`inspect(...)`), `agent.py` (`record_prompt(...)`, `last_turn`) and `why.py` (a read of the run log).

## Use it

```bash
cd companion && uv sync
uv run companion                 # chat; writes to the aim_live schema
```

Commands in the chat:

| command | what it does |
|---|---|
| `/why` | What the last reply was built from: each search result's rank, type and distance, whether it went into the prompt, and the turn that created it |
| `/new` | Start a new thread. Each session is its own thread, and memories carry across threads. |
| `/quit` | Exit (Ctrl-D works too) |

After each reply it prints what it remembered, for example `remembered in 7.1s: 2 created, 1 updated`. Extraction runs inline, so that's a real pause.

## In the browser

```bash
uv run companion --web           # http://localhost:8765, same schema and settings as the terminal
```

It's the same turn with a page on top. The reply shows as soon as the model returns it. The "remembered" line follows when extraction finishes, with links to that turn in the [dashboard](../docs/reference/dashboard.md): the conversation at that turn, and its lifecycle. **why** (or typing `/why`) opens the same explanation as the terminal, and each origin links to the turn that created the memory. **new thread** (or `/new`) starts a new thread. Each browser tab is its own thread, and a reload starts a fresh one, like restarting the terminal companion.

**The model picker** in the header chooses who writes the replies and extracts the memories: your default (`COMPANION_LLM_MODEL`) or any local chat model Ollama has pulled. The list comes from Ollama when the page loads, without embedding or cloud models. Switching starts a new thread, because a thread extracts with the model it was created with, and the run log records that thread's model. The page remembers your choice. Embeddings don't change: every vector in the store must come from one embedder. Small local models reply fast but extract less cleanly, and the health check shows that. In the terminal, set `COMPANION_LLM_MODEL=ollama_chat/<model>` instead.

The dashboard links only work if the dashboard reads the same schema. For your live data, that means `AIM_SCHEMA=AIM_LIVE` in `web/.env.local`. `COMPANION_DASHBOARD_URL` moves or hides the links.

It listens on `127.0.0.1` only, and refuses requests from other origins. The page writes to your memory store and spends model credits, so to serve it beyond your machine you must set `COMPANION_WEB_TOKEN` and use `--host`. Open the printed `?token=` link once per browser.

Turns run one at a time, even across tabs. The inspector tracks the open turn per thread of execution, so every call runs on one worker thread (`web.py` says why).

## Each turn

1. `search` your memories: types memory, fact, preference and guideline; 10 results.
2. Put the top 5 in the system prompt, plus the last 6 messages of this thread.
3. Call the model through LiteLLM and print the reply.
4. Count the flat-history tokens, the prompt you'd send with no memory at all (see [token method](../docs/token-method.md)), and report the turn with `record_prompt`.
5. `add_messages` writes the exchange, and the package extracts memories from it. In chat, each thread is created with the inspector's tested extraction instructions (`EXTRACTION_INSTRUCTIONS`), which keep conversation state like "asked the user…; awaiting reply" out of memory. Scripted replays leave them off, so the seeds still show the problem the health check finds.

## Scripted conversations

```bash
uv run companion --script conversations/support_01.yaml          # replay into aim_app
uv run companion --script conversations/support_01.yaml --live   # the model writes the replies
```

Replay uses the scripted assistant lines but still searches, assembles, counts tokens and writes, so seeds take the same path as real use. `agent/scripts/seed.py` runs every conversation this way.

## Privacy

Chat writes your real conversations to `aim_live`, and sends them to the model provider for replies and extraction. Keep screenshots and demos on `aim_app`.
