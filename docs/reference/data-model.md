# Data model reference

Everything lives in one Oracle Database, `FREEPDB1` in the `gvenzl/oracle-free:23.26.3-faststart` container. There are three kinds of objects in each schema: the package's tables, our run log and health tables, and read-only views over both. This page lists them, with the JSON shapes the dashboard depends on.

For why it's arranged this way, see [how it works](../explanation/how-it-works.md#three-kinds-of-data-one-database). For the package's full column list with types and constraints, see the generated [schema snapshot](../schema-snapshot.md).

## Database users

| user | owns / can do | created by |
|---|---|---|
| `AIM_APP` | owns the seed and lab schema: package tables, run log, health tables, views | `infra/init/01_users.sh` |
| `AIM_LIVE` | the same shape, for real companion conversations. Never reset. | `infra/init/02_live_user.sh` |
| `AIM_WEB` | the dashboard login: `SELECT` on the `AIM_V_*` views of both schemas, nothing else | `infra/init/01_users.sh`, with grants from `apply_sql.py` and `install()` |

`AIM_APP` and `AIM_LIVE` have `CREATE SESSION, TABLE, VIEW, SEQUENCE, PROCEDURE, TRIGGER, TYPE, JOB`, plus unlimited quota on `USERS`. `CREATE JOB` is there because the package schedules a purge of expired rows, and without it expired rows are hidden but never deleted. `agent/scripts/check_web_grants.py` proves that `AIM_WEB` can read every view and can't read base tables, write through views, read the run log tables, or read the judge cache.

## Package tables

Owned by `oracleagentmemory`. This project reads them and never writes to them.

| table | one row per | key columns |
|---|---|---|
| `THREAD` | conversation | `RECORD_ID`, `USER_ID`, `AGENT_ID`, `METADATA`, `RUNTIME_CONFIG`, `RUNTIME_STATE`, `CREATED_AT` |
| `MESSAGE` | message | `RECORD_ID`, `THREAD_ID` (FK, **cascade**), `MESSAGE_ROLE`, `CONTENT`, `ORDER_SEQ`, `EXPIRES_AT`, `CREATED_AT` |
| `MEMORY` | durable memory | `RECORD_ID`, `THREAD_ID` (FK, **cascade**), `USER_ID`, `AGENT_ID`, `MEMORY_TYPE` (`memory`, `fact`, `preference`, `guideline`), `CONTENT`, `METADATA` (JSON, incl. `$agent_memory.{scope, importance, entities, extraction_id}`), `ORDER_SEQ`, `EXPIRES_AT`, `CREATED_AT` |
| `RECORD_CHUNKS` | embedded chunk | `SOURCE_ID`, `SOURCE_RECORD_TYPE`, `CHUNK_SEQ`, `CHUNK_TEXT`, `EMBEDDING` (VECTOR, FLOAT64, 768 dims with nomic-embed-text), scope columns. **No FK**: the package deletes chunks itself. |
| `ACTOR_PROFILE` | user or agent profile | from `add_user` / `add_agent` |
| `ORACLEAGENTMEMORY_SCHEMA_META` | setting | `schema_version` (12), `vector_dim`, `record_chunks_indexing_mode`, `memory_retention_config` |

There's one HNSW vector index on `RECORD_CHUNKS.EMBEDDING`. Extracted memories always carry a `THREAD_ID`, so deleting the thread deletes them (see the [scope finding](../friction.md#2-user-scoped-memories-die-with-their-thread)). There's no `UPDATED_AT`.

## Demo views over the package

From `infra/sql/10_views.sql`.

These give the dashboard a stable shape whatever the package version. They're installed by `agent/scripts/apply_sql.py`, and they go `INVALID` after `seed.py --reset` until it runs again.

| view | columns |
|---|---|
| `AIM_V_THREADS` | `thread_id, user_id, agent_id, created_at, metadata, message_count, memory_count, last_activity` (counts exclude expired rows) |
| `AIM_V_MESSAGES` | `message_id, thread_id, seq, position` (1-based within the thread), `role, content, user_id, agent_id, created_at, expires_at, is_expired, metadata` |
| `AIM_V_MEMORIES` | `memory_id, memory_type, content, thread_id, user_id, agent_id, seq, created_at, logical_ts, expires_at, is_expired, origin` (`extracted` or `explicit`), `extractor_scope, importance, entities, extraction_id, after_message_position` (derived from timestamps) |
| `AIM_V_STORE_INFO` | `schema_version, vector_dim, indexing_mode, retention_config` |

## Run log

Written by `inspect()`, from `sql/30_runlog.sql`.

### `AIM_RUNS`: one row per instrumented thread

`run_id` (PK = the package's thread id; **no FK**, so the run log outlives a deleted thread), `source` (`instrumented`, `replay` or `live`), `user_id, agent_id, llm_model, embed_model, package_version, first_turn_at, last_turn_at, turn_count, notes`.

### `AIM_TURNS`: one row per turn

PK `(run_id, turn)`. FK to `AIM_RUNS` with cascade.

| column | type | meaning |
|---|---|---|
| `turn` | NUMBER | 1, 2, 3… per thread, continuing across processes |
| `started_at`, `duration_ms` | | wall time of the turn |
| `user_message` | CLOB | the first user message written this turn |
| `retrieved` | JSON | see below |
| `message_ids` | JSON | ids returned by `add_messages` |
| `memory_diff` | JSON | see below |
| `attrs` | JSON | `closed_by` (`thread.add_messages`, `delete_thread`, `explicit`, `close`…), `computed`, `queries`, `other_threads` |
| `assembled_prompt`, `reply` | CLOB | only when the agent calls `record_prompt` |
| `prompt_tokens`, `flat_history_tokens`, `token_method`, `usage` | | only with `record_prompt` |
| `reply_source` | | `scripted` or `model` |

`retrieved`:

```json
[{"search": 1, "rank": 1, "record_id": "7b04…", "record_type": "fact",
  "distance": 0.2071, "thread_id": "8f54…", "in_prompt": true}]
```

`in_prompt` is `true` or `false` when the agent reported its prompt, and `null` when it didn't.

`memory_diff`:

```json
{"created": [{"id": "…", "type": "fact", "content": "…", "thread_id": "…"}],
 "updated": [{"id": "…", "type": "fact", "before": "…", "after": "…"}],
 "deleted": [{"id": "…", "type": "preference", "content": "…", "thread_id": "…"}]}
```

### `AIM_RUN_EVENTS`: one row per timed step

`event_id` (identity), `run_id` (NULL for unattributed), `turn`, `seq`, `parent_seq`, `depth`, `stage` (CHECK: the seven stages), `name`, `source` (`wrapper` or `log`), `started_at` (TIMESTAMP(6) WITH TIME ZONE), `duration_ms`, `input_summary`, `output_summary`, `memory_ids` (JSON), `scope` (JSON), `tokens` (JSON, currently unused because the package reports no usage), `attrs` (JSON: `logger`, `mapped`, `start` and `end` extras, `points`, `unclosed`, `end_inferred`, `computed`), `error`.

`attrs.points` holds the package's one-off log records, folded into their span. For example, `Record-chunk insert completed.` with `inserted_row_count`.

## Health tables

Written by `check`, from `sql/50_health.sql`.

### `AIM_CHECK_RUNS`

`check_run_id` (identity), `started_at`, `finished_at`, `scope_user_id` (NULL means everyone), `params` (JSON: threshold, judge prompt versions, patterns, table names), `counts` (JSON: memories, candidate_pairs, judged_memories, findings per kind, judge_calls, judge_cache_hits, unparsed), `judge_model` (NULL means no judge), `package_version`.

### `AIM_FINDINGS`

`finding_id`, `check_run_id` (FK, cascade), `fingerprint`, `kind` (CHECK: `superseded`, `contradiction`, `duplicate`, `near_duplicate`, `transient`, `crowded_turn`, `scope_mismatch`, `orphan_chunks`), `severity` (`high`, `medium`, `low`), `user_id`, `memory_ids` (JSON), `turns` (JSON `[{run_id, turn}]`), `title` (≤400), `detail`, `suggestion`, `evidence` (JSON), `method`.

`evidence` by kind:

| kind | keys |
|---|---|
| `superseded` | `distance`, `judge` `{relation, current, rationale, model}` or `pattern`, `stale`, `current`, `superseded_by` `[{id, distance, method, rationale}]` |
| `duplicate` | `keep`, `pairs` `[{ids, distance, rationale, model}]` |
| `transient` | `pattern`, `judge` `{kind, rationale, model}` or null |
| `crowded_turn` | `turns` `[{turn, wasted: {memory_id: "stale"\|"duplicate"\|"transient"}, slots}]`, `basis` (`in_prompt` or `returned`) |
| `scope_mismatch` | `labels` `{label: count}`, `count` |
| `contradiction`, `near_duplicate` | `distance`, `judge` |
| `orphan_chunks` | `count` |

### `AIM_JUDGMENTS`: the judge's cache (not granted to the dashboard)

`cache_key` (sha256 of prompt version, model and exact content), `kind` (`pair` or `memory`), `verdict`, `current_side` (`older` or `newer`), `rationale`, `model`, `judge_version`, `created_at`. `seed.py --reset` keeps it, because it's keyed by content and stays valid.

## Library views

From `sql/40_runlog_views.sql` and `60_health_views.sql`.

`AIM_V_RUNS`, `AIM_V_TURNS`, `AIM_V_RUN_EVENTS`, `AIM_V_CHECK_RUNS` and `AIM_V_FINDINGS` select every column of their table. `AIM_V_MEMORY_RETRIEVALS` flattens `AIM_TURNS.retrieved` into one row per result: `run_id, turn, started_at, search_no, rank, record_id, record_type, distance, thread_id, in_prompt` (1, 0 or NULL). All are granted to the `--grant-to` user.

## Useful queries

Run these as the schema owner.

```sql
-- the stale fact and its correction, side by side
select memory_type, dbms_lob.substr(content, 120, 1), thread_id,
       json_value(metadata, '$."$agent_memory".scope') scope
  from memory where user_id = 'u_alice' and content like '%bucket%';

-- which memories earn their keep
select record_id, count(*) retrieved, sum(in_prompt) in_prompt
  from aim_v_memory_retrievals group by record_id order by 2 desc;

-- stage mix across all turns (a mapping health check: "other" should be small)
select stage, count(*) from aim_v_run_events group by stage order by 2 desc;

-- the latest findings
select severity, kind, title from aim_v_findings
 where check_run_id = (select max(check_run_id) from aim_v_check_runs);
```

## Related

- [Schema snapshot](../schema-snapshot.md) (generated by `dump_schema.py`)
- [Library reference](inspector.md) · [Dashboard reference](dashboard.md)
