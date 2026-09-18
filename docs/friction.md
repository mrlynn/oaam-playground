# Friction log

Timestamped as it happens. Each entry: what I tried, what I expected, what happened.
The [summary](#summary-five-fixes) at the bottom turns them into five suggested fixes with reproductions.

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

**2026-09-18 04:25 · First real question, explained by `/why`.** Asked the companion, as u_alice, "Which region is my export bucket in, and how should you contact me?" It replied that it had nothing on file about contact preferences. The "email only, never phone" preference exists. `/why` showed the reason: all 5 prompt slots went to 2 stale us-east-1 facts, 2 corrected us-west-2 facts, and 1 transient "awaiting user's reply" memory. The preference wasn't in the top 10. Three earlier findings compound here: corrections pile up (03:05), per-turn extraction keeps transient state (03:05), and the store grows duplicates when the same conversation is written twice, since nothing dedups across threads. One mixed question was enough to push a durable preference out. The fixes suggested above (revise on correction, filter transient state) would each have freed slots. The model did notice the region conflict and asked which was right.

**2026-09-18 04:30 · Explicit add_memory has its own log name.** `thread.add_memory` logs `Thread memory creation started.` / `Thread memory created.`. The stage mapping now covers it. Not a package problem: noted because it was the first record the rule table hadn't seen, and the inspector flagged it as unmapped instead of dropping it, which is how that's meant to work.

**2026-09-18 · Search distance is cosine (confirmed), and the vectors are FLOAT64.** `agent/spikes/search_metric.py` re-embeds two queries with `is_query=True` and recomputes each result's distance in SQL: `VECTOR_DISTANCE(..., COSINE)` matches `search`'s `distance` exactly (max difference 0.0 over 12 results); EUCLIDEAN and DOT do not. Embeddings are normalized (DOT = COSINE − 1). Binding a FLOAT32 query vector fails with ORA-51812 because `RECORD_CHUNKS.EMBEDDING` stores FLOAT64. Neither is documented; both matter to anyone writing SQL over the store. Both queries also returned the same memory twice in their top two results, the duplicate problem showing up directly in search.

**2026-09-18 · Custom instructions stop transient memories; nothing stops stale ones.** `agent/spikes/custom_instructions.py` replays `support_01` and `onboarding_01` per turn into throwaway users, with and without `memory_extraction_custom_instructions`. Without them, 4 of about 21 memories were conversation state ("Assistant asked…; awaiting reply"), in both trials. With them, 0 in all three trials, and about a third fewer memories overall. But the stale "us-east-1" fact survived in **3 of 3** trials with instructions: extraction appends, it never revises or deletes an earlier memory, so no wording can fix a correction. Worse, the first instruction wording ("store only the corrected fact… without mentioning the earlier value") stripped the "(corrected from…)" note, leaving two equal-looking facts with nothing to say which is current. The wording that works asks the extractor to "say what it corrects". Suggested fix (the headline one): when extraction's past-memory lookup finds the memory being corrected, update or expire it instead of appending. Repro: the spike script.

**2026-09-18 · Newer Claude models reject `temperature=0`.** `claude-sonnet-5` through LiteLLM raises `UnsupportedParamsError: … Only temperature=1 is supported`. Not a package issue, but it means an LLM judge can't be made deterministic by temperature; the health check caches verdicts instead. The same model also returned an empty reply (`finish_reason=length`) at `max_tokens=300`, so the judge needs headroom (1000) and must treat a reply with no JSON as its own "unparsed" verdict.

**2026-09-18 · The synchronous API warns about deadlocks in Jupyter.** In a notebook, every `add_messages` and `search` prints `UserWarning: You are calling an asynchronous method in a synchronous method from an asynchronous context. This is highly discouraged because it can lead to deadlocks.` Jupyter already runs an event loop, and the package's sync methods detect it. The calls work, but notebooks are where most people first meet this package (including the DeepLearning.AI course), and a deadlock warning on the first cell teaches them to ignore warnings. The labs filter this one message. Suggested fix: detect a running loop and run the coroutine on a worker thread without warning, or document the `*_async` methods for notebooks.

**2026-09-18 · Mixed questions: cleanup helps, splitting helps more.** Lab 3, run cold twice. "Which region is my export bucket in, and how should you contact me?" never had the email-only preference in its top 10. After deleting everything the health check named (8–10 memories), it rose to rank 8–10. Asked on its own, "How should you contact me?" put it at rank 1. A two-topic question gets one embedding that lands between the topics. That isn't a package bug, but a memory quickstart that shows one search per user turn will lead people into it. Worth a line in the docs: split multi-part questions before searching.


## Summary: five fixes

`oracleagentmemory` 26.6.0 on Oracle AI Database Free 26ai, 2026-09-18. These are observations from one day of building on the package with a scripted agent, a small real one (`companion/`), three labs and an inspector. Each fix below has a script that reproduces the behaviour on a fresh `aim_app` seed.

What works well is worth saying first:
- **Time to first memory was 26 minutes from an empty machine:** 9 minutes of discovery, 3 of setup, 7 of implementation and 7 of integration.
- **The embedder is truly pluggable.** Ollama worked on the first try.
- **Errors mostly say what to do.** The schema-policy error names its own fix.
- **Search is exactly cosine,** which makes SQL over the store straightforward.
- **Everything is ordinary rows.** Keeping memory in Oracle made it inspectable: a read-only dashboard login, `VECTOR_DISTANCE` health checks, a cascade you can verify. That's a strong argument for memory in the database.

The five below are ordered by how much they cost an agent's answers.

### 1. Corrections are appended, never applied

**Observed.** When a user corrects themselves mid-conversation ("actually, the bucket is in us-west-2"), per-turn extraction writes the corrected fact as a **new** memory. The one it corrects is never updated or expired. Extraction appears to only ever add rows.
- It happened in every per-turn run: the seeds, the probe, labs 2 and 3, and 3 of 3 trials with custom instructions.
- The two facts sit about 0.04 apart (cosine), so a search for one returns both. In the seeded "why" view, the stale fact is ranked #1 and goes into the prompt.
- **Batch mode hides it.** One `add_messages` call over the whole conversation writes only the corrected fact.
- Extraction's own past-memory lookup finds the earlier memory before writing. The information needed to revise it is already there.

**Suggested fix.** When extraction produces a correction of a memory its lookup returned, update that memory (or expire it and link the new one to it) instead of appending. At minimum, record `supersedes: <id>` in the new memory's metadata so agents and tools can clean up reliably.

**Reproduce.**
- `agent/spikes/custom_instructions.py`: the stale fact survives with and without instructions.
- `agent/scripts/probe_inspector.py`: turn 2 retrieves the stale fact, then creates 2 memories and updates 0.
- `memory-inspector check`: reports it as `superseded`.

### 2. "User-scoped" memories die with their thread

**Observed.** Every extracted memory is written with `THREAD_ID` set, including the ones the extractor itself labels `"scope": "user"` or `"environment"` in its metadata. `MEMORY.THREAD_ID` cascades on delete, so cleaning up an old support thread deletes the user's durable preferences.
- Lab 2 deletes one thread and goes from 9 memories to 0, taking "email only, never by phone" with it.
- On the seeds, 32 of 37 memories are labelled broader than their thread.
- The scope labels are also unstable between runs (`user` on one run, `environment` on the next for the same fact) and open-ended (`multi_agent` has appeared too).

**Suggested fix.** Honour the extractor's scope when writing: store user-scoped memories with a NULL `THREAD_ID`. Or document clearly that extracted memories live and die with their thread, and give `delete_thread` a `keep_user_memories=True` option.

**Reproduce.**
- Lab 2, part 5.
- `select thread_id, json_value(metadata, '$."$agent_memory".scope') from memory`.
- `memory-inspector check`: reports it as `scope_mismatch`.

### 3. Per-turn extraction keeps conversation state, and the fix is one prompt away

**Observed.** Written one exchange at a time, the way agents write, extraction stores the conversation's state as durable memory: "Assistant asked the user which region…; awaiting reply".
- That's about 4 in 20 memories per support conversation.
- These are then retrieved in later sessions. On the seeds, **3 of the 4 most-retrieved memories carried a finding: one stale, one transient, one duplicated.** The memories that reach the model most often are frequently the ones that shouldn't exist.
- In the reproduced miss (seed `support_03`), transient and duplicate memories took 3 of 5 prompt slots, and the user's contact preference wasn't in the top 10.

**Suggested fix.** Make "store only what matters in a later conversation" the **default** extraction behaviour. The package already has the lever: `memory_extraction_custom_instructions`, with the tested wording in `memory_inspector/health/checks.py` (`EXTRACTION_INSTRUCTIONS`), took transient memories from 4 to 0 in every trial and total memories down by about a third. One warning: the wording must keep corrections saying what they correct. Telling extraction to drop the earlier value removed the only signal of which fact is current.

**Reproduce.**
- `agent/spikes/custom_instructions.py`
- Lab 2, parts 1–3
- Seed `support_03` plus the crowded-turn finding on `/memories`

### 4. Make memory inspectable from the outside

**Observed.** Building the inspector needed seven workarounds, and each points at a small API addition that would help any team debugging an agent.

| gap | workaround the inspector uses | suggested addition |
|---|---|---|
| No way to list memories | read the `MEMORY` table before and after each turn | `list_memories(user_id=, thread_id=)` |
| Table names only via `client._store._memory_table` | read a private attribute | public accessors for the resolved table names |
| No `UPDATED_AT`, and `update_memory` overwrites | before/after diffs in our own run log | `UPDATED_AT`, ideally a revision history |
| Log records carry flags and counts, but no ids and no durations | pair start/end records; a wrapper records ids and distances | `thread_id`, `record_ids` and `elapsed_ms` in the log `extra` |
| `Extractor context-summary update started.` has no completion record | infer its end from its LLM call | log the completion |
| `Llm.generate` returns text only, and LiteLLM callbacks are disabled on import | none: extraction token spend is invisible | return usage on `LlmResponse` |
| Messages are written after extraction returns | — (arrival order inside a turn is lost) | persist messages first, or document the ordering |

**Reproduce.** `agent/scripts/probe_inspector.py` exercises every workaround. The entries at 02:46, 03:00, 03:20, 03:40, 03:45 and 03:50 above give detail.

### 5. Smooth the first hour

**Observed.** Four small things cost more time than they should:
- **The get-started snippet fails on a fresh schema.** The default `schema_policy` is `REQUIRE_EXISTING`.
- **With a missing API key, the constructor retries the embedding call three times,** logging only "retryable error".
- **`SchemaPolicy.RECREATE` prints `DatabaseError… details suppressed`** on every run.
- **In Jupyter, every call warns that it "can lead to deadlocks".** That's the environment of the DeepLearning.AI course and of these labs.

Two more are documentation, not bugs:
- **Search without `record_types` ranks raw messages alongside memories.** The quickstart never passes it.
- **A two-topic question gets one embedding.** Splitting it put the answer at rank 1, where cleanup only reached rank 8 (lab 3, parts 5–6).

**Suggested fix.**
- Show `schema_policy="create_if_necessary"` and `record_types` in the quickstart.
- Treat auth errors as non-retryable, with the provider's message.
- Log the failing DDL statement and ORA code in `RECREATE`.
- In a running event loop, run the coroutine on a worker thread without warning, or point notebooks at the `*_async` methods.

**Reproduce.** `agent/scripts/smoke.py` on an empty schema without `schema_policy`; any lab notebook without `labkit`'s warning filter; lab 3.
