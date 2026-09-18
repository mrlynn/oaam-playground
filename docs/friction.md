# Friction log

Timestamped as it happens. Each entry: what I tried, what I expected, what happened.
Summary with suggested fixes goes at the bottom once there is enough to say.

## Time to first memory

Clock started 2026-09-18 02:24 EDT (spec in hand, empty machine apart from Docker, uv, Node).

| stage | started | done | minutes | notes |
|---|---|---|---|---|
| discovery | 02:24 | 02:33 | 9 | PyPI + get-started page. Enough to write a client, not enough for scores, grants, retention. |
| setup | 02:33 | 02:36 | 3 | Image pull + faststart container healthy in 9 s. Package install clean on Python 3.12. |
| implementation | 02:36 | 02:43 | 7 | ~4 min of that was waiting on keys. First memory 16 s after script start. |
| integration | 02:43 | 02:50 | 7 | schema dump + phase 0 questions answered |
| production | | | | |

## Entries

**2026-09-18 02:33 · Image tag.** Tried: pick a gvenzl tag. Expected: docs to name a minimum. What happened: the package page says "26ai or later"; the image tags say `23.26.x`. You have to know 23.26 == 26ai. Pinned `gvenzl/oracle-free:23.26.3-faststart`.

**2026-09-18 02:34 · No source in the wheel.** Tried: read the package source to answer phase 0 questions. What happened: `oracleagentmemory-26.6.0` ships only `.pyc` files. Signatures and docstrings survive, so `inspect` works, but nothing below the public API is readable. Docstrings are good, and better than the get-started page.

**2026-09-18 02:35 · Default schema policy.** The get-started snippet constructs `OracleAgentMemory(connection=..., embedder=..., llm=...)`. The constructor docstring says `schema_policy` defaults to `REQUIRE_EXISTING`, which validates and never creates. So on an empty schema the snippet should fail. Passing `SchemaPolicy.CREATE_IF_NECESSARY` explicitly. (Confirm once keys are in: does the snippet really fail, and with what message?)

**2026-09-18 02:35 · Search returns distance, not score.** `OracleSearchResult(distance, record)`, "smaller is better". Good that it is returned at all. The dashboard has to label it as distance or convert, and must say which.

**2026-09-18 02:35 · Retention defaults.** `MemoryRetentionConfig(default_ttl_days=None, max_ttl_days=None)`: no expiry by default, as the spec warned. Purge is a scheduler job; without `CREATE JOB` the package warns and continues, and expired rows are hidden but never physically deleted. Granted `CREATE JOB` explicitly.

**2026-09-18 02:36 · Constructor calls the embedding provider.** Tried: build the client with no API keys to see the schema get created. What happened: the constructor makes a live embedding request (presumably to learn the vector dimension) before creating anything. With no `OPENAI_API_KEY`, LiteLLM raises `InternalServerError: Missing credentials`. The package treats it as retryable and tries 3 times. The DEBUG log only says "Embedding provider call failed with a retryable error", with no reason. Suggested fix: treat auth errors as non-retryable and include the provider's message in the log line.

**2026-09-18 02:40 · Embedder choice.** No OpenAI key to hand, so I switched to `ollama/nomic-embed-text` (768-dim) through LiteLLM. It worked first try. The embedder is truly pluggable, but the vector dimension is fixed into the schema at creation (`schema_meta.vector_dim`), so changing embedders later means a new store or a recreate.

**2026-09-18 02:43 · First memory.** The smoke test ran end to end: client build 2–3 s (including schema creation), `add_messages` with inline extraction 10–12 s, search 50–65 ms. Extraction kept the durable preference, applied the mid-conversation region correction, and dropped the one-off `us-east-1`. That is the behavior you'd want.

**2026-09-18 02:45 · Extracted memories are thread-scoped.** The extractor labels scope in metadata (`user`, `environment`), but every row is written with `THREAD_ID`, and the thread FK cascades. Deleting a support thread deletes the user's "email only" preference. Either the label or the storage is wrong. Suggested fix: honor the extractor's scope when writing (NULL `THREAD_ID` for user-scope), or document that extracted memories live and die with their thread. Repro: run `agent/scripts/smoke.py`, then `select thread_id, json_value(metadata,'$."$agent_memory".scope') from memory`.

**2026-09-18 02:45 · Extractor scope labels are unstable.** The same conversation, run twice: the export facts were tagged `user` on run 1 and `environment` on run 2. That is fine for an LLM, but it means anything keyed off the label is nondeterministic.

**2026-09-18 02:46 · No updated_at on MEMORY.** There is `CREATED_AT` plus an app-supplied `TIMESTAMP` string. Nothing records when `update_memory` rewrote a row, and the old content is gone. The inspector has to compute this in its wrapper. Suggested fix: add `UPDATED_AT`, and ideally keep a revision history, since revision is a named lifecycle stage.

**2026-09-18 02:46 · Logs have no ids.** The structured `extra` fields are a nice touch (counts, flags), but no record, thread or run ids appear in any log record, and no durations. You can see *that* a search happened, not *what* it returned. Suggested fix: add `thread_id`, `record_ids` and `elapsed_ms` to the `extra` of the completed events.

**2026-09-18 02:47 · Search mixes messages and memories by default.** With no `record_types`, raw message chunks compete with durable memories. "How does Alice like to be contacted?" ranked an unrelated account fact first. The docs mention `record_types`, but the quickstart never uses it.

**2026-09-18 02:49 · Get-started snippet fails on a fresh schema (confirmed).** From an empty database, `OracleAgentMemory(connection=, embedder=, llm=)` raises `ValueError: Managed DB schema is missing required objects. Ask a DBA to create/update the schema, or use schema_policy='create_if_necessary'...`. The error is good: it tells you exactly what to do. The quickstart should just show `schema_policy` on first run.

**2026-09-18 02:49 · Clean-room rerun.** `docker compose down -v`, then up (healthy in about 10 s), then smoke. It passed with the same 6 tables and the same row counts.
