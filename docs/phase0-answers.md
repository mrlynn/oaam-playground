# Phase 0 answers

Package `oracleagentmemory` 26.6.0 on Oracle AI Database Free 23.26.3 (26ai), 2026-09-18.
Evidence comes from `docs/schema-snapshot.md`, `agent/scripts/smoke.py` output, and the package's public signatures and docstrings. The wheel ships only `.pyc`, so there was no source to read below the public API. Nothing here is from the blog post.

## The five questions

**1. Where do raw messages live, and where do durable memories live?**
In separate tables. Raw messages are in `MESSAGE` (`MESSAGE_ROLE`, `CONTENT`). Durable memories are in `MEMORY`. All four memory types live in one table, told apart by `MEMORY_TYPE` ∈ `memory | fact | preference | guideline`. The Python side models them as separate record classes (`FactRecord`, `PreferenceRecord` and so on). `THREAD` holds one row per conversation plus `RUNTIME_CONFIG` and `RUNTIME_STATE` JSON (extraction counters). `ACTOR_PROFILE` holds unscoped user and agent profiles from `add_user` and `add_agent`.

**2. How are user, agent, and thread scope stored?**
As columns, not a scope table. `THREAD_ID`, `USER_ID`, `AGENT_ID` and `SPACE_ID` appear on `MESSAGE`, `MEMORY` and `RECORD_CHUNKS`. `MEMORY.THREAD_ID` and `MESSAGE.THREAD_ID` are foreign keys to `THREAD` with `ON DELETE CASCADE`. `SPACE_ID` is undocumented in the public API.
- **Surprise:** every extracted memory is written with `THREAD_ID` set, including ones the extractor itself labels `"scope": "user"` or `"scope": "environment"` in `METADATA.$agent_memory.scope`. Deleting the thread therefore cascades away the user's durable preferences. Lab 4 should demonstrate this, and it goes in the friction log.
- The extractor's scope label is not stable. Run 1 tagged the export facts `user`; run 2 tagged the same facts `environment`.

**3. Where are the embeddings, inline or in a chunk table?**
In a chunk table. `RECORD_CHUNKS` has one or more chunks per source record (`SOURCE_ID`, `SOURCE_RECORD_TYPE`, `CHUNK_SEQ`, `CHUNK_TEXT`, `EMBEDDING VECTOR`), with its own copy of the scope columns. There is one HNSW vector index (`RECORD_CHUNKS_EMBEDDING_VEC_I`, `INMEMORY_NEIGHBOR_GRAPH_HNSW`). Dimension is 768 (`ORACLEAGENTMEMORY_SCHEMA_META.vector_dim`, nomic-embed-text). Messages and memories are both embedded: 6 message chunks and 6 memory chunks after the smoke test.
- `RECORD_CHUNKS.SOURCE_ID` has **no foreign key** to `MEMORY` or `MESSAGE`. The package deletes chunks itself, both in `delete_thread` and in the purge job's PL/SQL. Lab 4 must verify there are no orphan chunks after a thread delete (0 orphans today).

**4. What timestamps exist on a memory?**
- `CREATED_AT TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP`, set by the database.
- `TIMESTAMP VARCHAR2(64)` is an application-supplied logical time (the `timestamp=` argument). It is a string, not a date, and was NULL for extracted memories.
- `EXPIRES_AT` is set from TTL and is NULL by default.
- **There is no `UPDATED_AT`.** `update_memory` rewrites in place, so "last touched" and the content history must come from our run log. This confirms spec-review issue #1: the per-turn snapshot needs before and after content.

**5. Does a retrieval score come back from the API?**
Yes, as a **distance**: `OracleSearchResult.distance`, where smaller is better. Smoke values ran 0.27 to 0.58. It is not persisted anywhere. The dashboard must label it "distance" (or show `1 - distance` and say so), and the wrapper must record it per retrieval, because the database never sees it.

## Other things we now know

| question | answer |
|---|---|
| Pinned version | `oracleagentmemory==26.6.0`, schema version `12` (`ORACLEAGENTMEMORY_SCHEMA_META.schema_version`) |
| Extraction sync or async? | `MemoryExtractionMode.INLINE` by default: `add_messages` returns after extraction finishes (about 10 to 12 s for 6 messages with Claude Sonnet 5). `BACKGROUND` is opt-in and best effort ("may never be written"). The wrapper can attribute extraction to the turn that called `add_messages`. |
| What does one `add_messages` do? | Two LLM calls (a context-summary update, then extraction, which includes a past-memory vector lookup), then chunk, embed and insert for messages and memories. The context card is a third LLM call (about 4 to 6 s). |
| Consolidation | No separate stage is exposed. Extraction receives past memories via a search before it writes (the "past-memory lookup" log line), so dedup and merge happen inside the extraction prompt. Metadata carries `extraction_id`, `importance` (1–5) and `entities`. Stage mapping for the run log: consolidation → `other` until we see an update or delete come out of extraction. |
| Delete thread | `delete_thread(thread_id)` returns 0 or 1, waits for pending background extraction, and cascades to messages, thread-scoped memories and chunks. `OracleThread.delete_message` does **not** cascade to memories derived from that message. `delete_user(cascade=True)` and `delete_agent` also exist. |
| Retention | `MemoryRetentionConfig(default_ttl_days=None, max_ttl_days=None)` by default, so nothing expires. It is stored in schema meta. Per-record `ttl_days` and `ttl_anchor` (`created_at` or `timestamp`) apply on every write API. Expired rows are hidden from reads immediately and purged by `PURGE_EXPIRED_RECORDS_J` (daily). |
| Required grants | `CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE, CREATE JOB` plus a quota on `USERS` was enough for VECTOR search. Not yet minimized: `VIEW`, `PROCEDURE`, `TRIGGER` and `TYPE` may be unnecessary. `KEYWORD`/`HYBRID` search (Oracle Text) are untested and likely need `CTXAPP`. |
| Schema policy | Default `REQUIRE_EXISTING` fails on an empty schema with `ValueError: Managed DB schema is missing required objects...`. The get-started snippet as written does not work on a fresh user. We use `CREATE_IF_NECESSARY`. |
| Search defaults | `max_results=10`. With no `record_types`, raw messages and memories are ranked together: for "How does Alice like to be contacted?", the explicit Team-plan fact ranked #1 (0.33) above the email preference (0.38). Filtering to memory types put the preference first (0.27). That is good lab 3 material. |
| Observability | Log records under `oracleagentmemory.*` carry structured `extra` fields (flags and counts such as `result_count`, `text_count`), but **no record ids, thread ids or durations**. Stages can be inferred from logger name plus message ("…started" / "…completed"). IDs, order and distances must come from the wrapper. |

## Implications for milestone 2 and later

- Views: `aim_v_threads` over `THREAD` plus aggregates from `MESSAGE`. `aim_v_messages` over `MESSAGE`. `aim_v_memories` over `MEMORY` with `METADATA.$agent_memory.{scope,importance,entities}` flattened. No `updated_at` or score columns, because they don't exist.
- Build views from this snapshot's names. `ORDER_SEQ` gives a stable ordering within each table.
- "Last touched" and "retrieval count" come from the run log (milestone 3), labelled as covering instrumented runs only.
