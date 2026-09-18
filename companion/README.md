# companion

A small terminal work companion. You talk through your projects, decisions and plans in short sessions, and it remembers across them using [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It's small on purpose. Its job is to produce honest memory behavior from real use, so the [memory inspector](../inspector/README.md) has something real to show.

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

## Each turn

1. `search` your memories: types memory, fact, preference and guideline; 10 results.
2. Put the top 5 in the system prompt, plus the last 6 messages of this thread.
3. Call the model through LiteLLM and print the reply.
4. Count the flat-history tokens, the prompt you'd send with no memory at all (see [token method](../docs/token-method.md)), and report the turn with `record_prompt`.
5. `add_messages` writes the exchange, and the package extracts memories from it.

## Scripted conversations

```bash
uv run companion --script conversations/support_01.yaml          # replay into aim_app
uv run companion --script conversations/support_01.yaml --live   # the model writes the replies
```

Replay uses the scripted assistant lines but still searches, assembles, counts tokens and writes, so seeds take the same path as real use. `agent/scripts/seed.py` runs every conversation this way.

## Privacy

Chat writes your real conversations to `aim_live`, and sends them to the model provider for replies and extraction. Keep screenshots and demos on `aim_app`.
