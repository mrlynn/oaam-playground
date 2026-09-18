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

**2026-09-18 02:56 · RECREATE hides its own errors.** `seed.py --reset` (`SchemaPolicy.RECREATE`) printed `[warn ignored] DatabaseError while executing managed schema DDL; details suppressed` on every run, then carried on. The schema came out complete, but there is no way to tell which DDL failed or whether it matters. Suggested fix: log the statement and the ORA code at WARNING, even if the error is expected (for example dropping something that isn't there).

**2026-09-18 03:00 · Messages are stored after extraction, not before.** With the default inline extraction, a thread created at 02:55:39 had its first message written at 02:55:52. `add_messages` holds the raw messages until both extraction LLM calls return, then writes messages and memories together. Two consequences. `MESSAGE.CREATED_AT` is not arrival time, and a batch shares one timestamp, so the order of events inside a turn can't be reconstructed from the DB. Open question: if extraction fails, are the raw messages lost? That's worth a repro in lab 4. Suggested fix: persist raw messages first, then extract, or at least document the ordering.

**2026-09-18 03:05 · Corrections pile up instead of revising.** Adding the support conversation one exchange at a time (the way an agent actually writes) produced "bucket in us-east-1" at turn 4, then a separate "us-west-2 (corrected from an earlier statement)" at turn 6. The stale fact was never updated or deleted. The extractor clearly knew it was a correction, since it said so, yet it wrote a new row. A search for the bucket region can return the wrong one. Batch mode hides this entirely: one call over all 6 messages wrote only the corrected fact. Suggested fix: when extraction produces a correction of a past memory it already looked up, update or expire that memory. Repro: `agent/scripts/seed.py --reset`, then filter `aim_v_memories` on `extraction_id like 's3_export_bucket_region%'`.

**2026-09-18 03:05 · Per-turn extraction keeps transient state.** Turn-by-turn seeding stored memories like "Assistant asked the user to share the IAM role ARN…; awaiting user's reply" as durable memories with importance 3. Those are conversation state, not facts worth keeping, and they would crowd retrieval over a long thread. Suggested fix: document or tune the extraction prompt for per-turn use; `memory_extraction_custom_instructions` may be the lever. Lab 2 material.

**2026-09-18 03:06 · Extractor scope vocabulary is open-ended.** Labels seen so far: `user`, `environment`, `multi_agent`. None of them change storage (every row gets `THREAD_ID`). The dashboard flags every mismatch in orange.

**2026-09-18 03:08 · 26ai error code for missing DML privilege.** A DELETE through a SELECT-only grant raises `ORA-41900: missing DELETE privilege`, not the classic `ORA-01031`. Not a package issue, but any test that matches on 01031 will break on 26ai.

**2026-09-18 03:20 · No way to list memories.** Planning the milestone 3 wrapper: to diff what a turn created or changed, you need the set of memories for a user or thread. The public API has `search` (ranked and capped, so not a listing) and nothing else. There is a private `_list_owned_thread_ids_for_actor`. The inspector will read its own view over `MEMORY` instead. Suggested fix: add `list_memories(user_id=, thread_id=, record_types=)`, which any memory admin UI needs.

**2026-09-18 03:20 · LLM usage is not surfaced.** The package's `Llm.generate` returns `LlmResponse(text)` only. Extraction and summarization token spend, which is the real per-turn cost of memory, isn't visible to the caller. Suggested fix: include `usage` on `LlmResponse` and in the "LLM generation completed" log extras.

**2026-09-18 03:20 · contextvars propagate into the worker thread (good).** Part of the package's work inside `add_messages` runs on an AnyIO worker thread, and a `ContextVar` set by the caller is visible there. That makes per-turn attribution of log records possible without patching anything. Worth documenting as the supported way to correlate.

**2026-09-18 03:40 · A span with no end.** The package logs `Extractor context-summary update started.` but never a matching completion; the last thing it logs is its LLM request completing. Anything pairing start and end records (an OpenTelemetry bridge, say) sees that span stay open and wraps the rest of extraction inside summarization. The inspector closes it when its LLM request completes and marks `attrs.end_inferred`. Minor, but related: `Memory extraction prompt flow parsed records.` is logged *after* `…prompt flow completed.`, so the extracted-memory count arrives outside the span it describes. Suggested fix: log `…update completed.` and emit counts before the completion record.

**2026-09-18 03:45 · Table names are only reachable through private attributes.** `memory_store_id` and `table_name_prefix` rename the managed tables, and with no list-memories API the diff has to read `MEMORY` directly. The only way to learn the real name is `client._store._memory_table`. The inspector reads that with a fallback to `MEMORY` and an explicit override. Suggested fix: a public `list_memories(user_id=..., thread_id=...)`, which would also remove the need to read the table at all, or at least public accessors for the resolved table names.

**2026-09-18 03:50 · Extraction token spend can't be recovered.** Time-boxed spike: a LiteLLM `CustomLogger` registered after building the client saw none of the package's LLM calls. `oracleagentmemory.core.llms.llm` includes `_patch_litellm_logging_disabled` ("Disable LiteLLM logging callbacks and background logging work"), and `litellm.turn_off_message_logging` is already `True` when the client is built. Whether this also silences a host application's own LiteLLM callbacks is **unverified**: my control run without the package also saw no callbacks, so that test was inconclusive. Worth a proper repro, because if it is process-wide, any team using LiteLLM with Langfuse or similar loses its tracing by importing this package. Suggested fix: return usage on `LlmResponse` (see 03:20), and scope the logging patch to the package's own calls.

**2026-09-18 03:55 · Stale correction reproduced through the inspector.** `agent/scripts/probe_inspector.py` turn 2: the agent's search for the correction returned the stale "us-east-1" fact at rank 1 (distance 0.21), then extraction created 2 new memories and updated 0. The same finding as 03:05, now visible in the run log with no one looking for it, which is the point of the inspector.
