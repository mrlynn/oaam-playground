# memory-inspector: library and CLI reference

`memory-inspector` is the Python package in `inspector/`. It does three things: installs its tables into a schema (`install`, `memory-inspector init`), records every turn of an agent that uses `oracleagentmemory` (`inspect`), and checks the health of the whole memory store (`run_check`, `memory-inspector check`).

It supports `oracleagentmemory` 26.6.x on Oracle AI Database 26ai (the pin is `>=26.6.0,<26.7`, because stage mapping reads that version's log messages). It needs Python 3.10–3.13.

For why it works this way, see [how it works](../explanation/how-it-works.md). To use it in another project, see [how to instrument your own agent](../how-to/instrument-your-agent.md).

## Install

```bash
pip install -e ./inspector              # or: uv add --editable ../inspector
pip install -e "./inspector[judge]"     # adds LiteLLM for the health check's judge
```

Inside this repo, `agent/`, `companion/` and `labs/` already depend on it by path.

## `install(conn, grant_to=None) -> InstallReport`

Creates the run log and health tables and their views in the connection's current schema. It's idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`) and safe to call on every start. It doesn't touch package tables and doesn't need them to exist.

| parameter | type | meaning |
|---|---|---|
| `conn` | `oracledb.Connection` | connected as the schema owner |
| `grant_to` | `str \| None` | a user to receive `SELECT` on every `AIM_V_*` view the library creates. Must be a valid Oracle identifier (`^[A-Za-z][A-Za-z0-9_$#]{0,127}$`), otherwise `ValueError`. |

It runs the bundled scripts in order: `30_runlog.sql`, `40_runlog_views.sql`, `50_health.sql`, `60_health_views.sql`. It raises `RuntimeError` if any object is left `INVALID`. `InstallReport` has `schema`, `statements` (a statement count per script) and `granted_to`.

```python
from memory_inspector import install
install(conn, grant_to="aim_web")
```

## `inspect(memory, pool, ...) -> InspectedMemory`

Wraps an `OracleAgentMemory` client. The result behaves like the client, and its threads behave like threads. Every call passes through with the same arguments and returns the same result. The instrumented ones are also recorded.

```python
from memory_inspector import inspect
memory = inspect(OracleAgentMemory(connection=pool, embedder=..., llm=...), pool=pool)
```

| parameter | default | meaning |
|---|---|---|
| `memory` | required | an `OracleAgentMemory`. Passing an `InspectedMemory` returns it unchanged. |
| `pool` | required | an `oracledb` **pool** for the same schema. It's used to read the memory table and write the run log. A plain connection is rejected with `TypeError`, so the inspector never shares your transaction. |
| `source` | `"instrumented"` | recorded on the run: `"instrumented"`, `"replay"` or `"live"`. The database rejects anything else. |
| `llm_model`, `embed_model` | `None` | recorded on the run, for display |
| `memory_table`, `thread_table` | read from the client | only needed if you use a `table_name_prefix` the inspector can't see. It reads `client._store._memory_table`, a private attribute (friction log 03:45). |
| `capture_logs` | `True` | install the log handler that turns package log records into timed spans |

### What gets recorded

| call | stage | notes |
|---|---|---|
| `memory.create_thread(...)` | other | returns an `InspectedThread` |
| `memory.get_thread(id)` | not recorded | returns an `InspectedThread` |
| `memory.search(query, ...)` / `thread.search(query, ...)` | retrieval | every result: search number, rank, record id, record type, cosine distance, thread id |
| `thread.add_messages(messages)` | ingestion | records message ids and the first user message. **Closes the turn.** |
| `memory.add_memory(...)` / `thread.add_memory(...)` | ingestion | |
| `memory.update_memory(...)` / `thread.update_memory(...)` | revision | |
| `memory.delete_memory(id)` / `thread.delete_memory(id)` | revision | |
| `memory.delete_thread(id)` | revision | looks up the thread's owner first, so the diff shows everything the delete removed. **Closes the turn.** |
| `thread.get_context_card(...)` | retrieval | no ids (the card doesn't expose them) |
| `thread.update_message(...)`, `thread.delete_message(...)` | revision | |
| `memory.close()` | not recorded | closes the client, then the inspector: closes any open turn and writes what's buffered |
| `*_async` variants | not recorded | pass through, with a one-time warning |
| `delete_user`, `delete_agent`, `update_thread` | not recorded | pass through silently |

Anything that changes memory takes a snapshot of the user's memories before the first change in a turn, and again when the turn closes. The difference is the turn's `memory_diff`.

### Turns

A turn opens on the first recorded call and closes on `add_messages`, `delete_thread`, the end of an explicit `turn()` block, or `close()`. Its number is the thread's highest turn plus one, taken under a row lock on `AIM_RUNS`. A turn with no thread (for example, a search followed by `close()`) is written as unattributed events rather than dropped.

### `memory.inspector.record_prompt(prompt=None, reply=None, *, ...)`

Optional. Tells the inspector what the agent sent and got back on the current turn. Without it, search results are labelled "returned by search". With `memory_ids_used`, they're labelled "in prompt" or "also returned". Call it before `add_messages`.

| parameter | meaning |
|---|---|
| `prompt` | the assembled prompt text (stored in `AIM_TURNS.assembled_prompt`) |
| `reply` | the model's reply |
| `usage` | the model's usage object or dict. `input_tokens` or `prompt_tokens` becomes the turn's `prompt_tokens`. |
| `memory_ids_used` | the ids of the search results that went into the prompt |
| `prompt_tokens` | overrides `usage`: for scripted replies where you counted instead |
| `flat_history_tokens` | what the whole thread's history would have cost (see [token method](../token-method.md)) |
| `token_method` | free text describing how you counted |
| `reply_source` | `"model"` or `"scripted"`. The database rejects anything else. |

### `with memory.inspector.turn(thread=None):`

Makes the turn boundary explicit. Everything inside is one turn, even if `add_messages` runs twice or never. An open inferred turn is closed first, as `explicit_turn_started`.

### `memory.inspector.last_turn -> Turn | None`

The most recently closed turn in this process. The companion uses it for its "remembered in 7.1s: 2 created" line and for `/why`.

| field | meaning |
|---|---|
| `number` | the turn number written, or `None` if the write failed |
| `thread_id`, `user_id`, `agent_id` | what the turn was bound to |
| `retrieved` | list of `{search, rank, record_id, record_type, distance, thread_id, in_prompt}` |
| `queries` | the search query texts, in order |
| `message_ids` | ids returned by `add_messages` |
| `memory_diff` | `{created: [...], updated: [...], deleted: [...]}` |
| `prompt` | what `record_prompt` supplied |
| `attrs` | `closed_by`, `computed`, `queries`, `other_threads` |

### Logging behaviour

The inspector adds one handler to the `oracleagentmemory` logger, sets that logger to DEBUG, and stops it propagating. Records at or above the level that was in force before are re-sent to the root logger, so your application's log output doesn't change. `close()` restores the logger.

Its own problems are logged to the `memory_inspector` logger at WARNING, for example "dropped turn for run …" or "instrumentation error (agent unaffected)". Nothing it does raises into the agent.

## `memory-inspector init`

```bash
export MEMORY_INSPECTOR_DB_PASSWORD=...
memory-inspector init --user aim_app --dsn localhost:1521/FREEPDB1 --grant-to aim_web
```

| flag | meaning |
|---|---|
| `--user` | the schema owner (the user your memory client connects as) |
| `--dsn` | e.g. `localhost:1521/FREEPDB1` |
| `--grant-to` | a read-only dashboard user to receive `SELECT` on the views |

The password is read from `$MEMORY_INSPECTOR_DB_PASSWORD`, or you're prompted for it. It's never taken as an argument, so it stays out of shell history. Exit code 1 on a database error, with the message on stderr.

## `memory-inspector check`

```bash
memory-inspector check --user aim_app --dsn localhost:1521/FREEPDB1 --judge-model anthropic/claude-sonnet-5
```

| flag | default | meaning |
|---|---|---|
| `--user`, `--dsn` | required | as for `init` |
| `--user-id` | everyone | check one memory user only |
| `--judge-model` | `$MEMORY_INSPECTOR_JUDGE_MODEL` | a LiteLLM model id for the judge. With neither set, the check runs without a judge and says so. |
| `--no-judge` | off | deterministic checks only, with no model calls |
| `--threshold` | `0.15` | cosine distance for candidate pairs |
| `--memory-table`, `--chunk-table`, `--message-table` | `MEMORY`, `RECORD_CHUNKS`, `MESSAGE` | for prefixed table names |

It prints one line per finding, marking new ones, then the resolved ones, and exits 0 whatever it finds. Findings are data, not failures. The judge needs the provider's API key in the environment (for example `ANTHROPIC_API_KEY`).

Output shape:

```
check run 10 on aim_app: 37 memories, 16 candidate pairs, 0 judge calls, 24 cached, 0 unparsed
      high   crowded_turn    Conversation 0c190da6: 1 turn spent prompt slots on memories that shouldn't be there (worst: turn 1, 3 of 5)
  new high   superseded      Stale memory still stored: “User's failing S3 export job targets a bucket in the us-east-1 region.”
  ...
  resolved superseded      Stale memory still stored: “…”
```

## `run_check(pool, *, ...) -> CheckReport`

The same thing from Python:

```python
from memory_inspector.health import run_check
report = run_check(pool, user_id="u_alice", judge_model="anthropic/claude-sonnet-5")
for f in report.findings:
    print(f.severity, f.kind, f.title, f.suggestion)
```

| parameter | default | meaning |
|---|---|---|
| `pool` | required | an `oracledb` pool connected as the schema owner |
| `user_id` | `None` (everyone) | the scope |
| `threshold` | `0.15` | candidate distance |
| `judge_model` | `None` (no judge) | a LiteLLM model id |
| `tables` | `Tables()` | `Tables(memory="MEMORY", chunks="RECORD_CHUNKS", message="MESSAGE")` |
| `complete` | LiteLLM | `(model, prompt) -> str`, replaceable in tests |

`CheckReport` has `check_run_id`, `findings` (a list of `Finding`), `counts` (memories, candidate pairs, judged memories, findings per kind, judge calls, cache hits, unparsed), `new` (findings absent from the previous comparable run) and `resolved` (`{fingerprint, kind, title}` from the previous run that are gone now).

A `Finding` has `kind`, `severity`, `title`, `detail`, `suggestion`, `method` (`sql`, `pattern`, `llm`, or a combination such as `sql+llm`), `user_id`, `memory_ids`, `turns`, `evidence`, an optional `subject`, and a `fingerprint`. The finding kinds and their rules are in [the health checks explanation](../explanation/health-checks.md#3-checks-are-plain-functions).

Constants you can reuse:
- `memory_inspector.health.checks.EXTRACTION_INSTRUCTIONS`: the tested `memory_extraction_custom_instructions` wording that stops transient memories.
- `TRANSIENT_PATTERN` and `CORRECTION_PATTERN`: the regular expressions used without a judge.
- `memory_inspector.health.judge.PAIR_VERSION` and `MEMORY_VERSION`: the current prompt versions (`pair-v3`, `memory-v2`).

## Environment variables

| variable | used by | meaning |
|---|---|---|
| `MEMORY_INSPECTOR_DB_PASSWORD` | CLI | password for `--user` |
| `MEMORY_INSPECTOR_JUDGE_MODEL` | `check` | the default judge model |
| `MEMORY_INSPECTOR_FAIL_WRITES` | run log writer | `1` makes every run log write fail, to test that the agent is unaffected |

## Lifecycle stages

Package log records are mapped to one of `ingestion`, `extraction`, `consolidation`, `retrieval`, `summarization`, `revision` and `other` by the rule table in `stages.py`. Generic operations (searches, embedding calls, LLM calls) take the stage of the span they run inside, so the search inside extraction's past-memory lookup counts as consolidation. Unknown records follow their parent and are flagged `attrs.mapped = false`. `CLOSES_WITH` handles the context-summary step, which logs a start and never an end.

## Limits

- **Inline extraction only.** With `BACKGROUND` extraction, the package's records arrive after the turn closes and are stored as unattributed.
- **One writer process per thread at a time.** Numbering is locked, but concurrent turns on one thread would interleave.
- **Async methods aren't recorded.**
- **The memory diff reads the package's table directly.** That's read-only, but it depends on the table name.

## Related

- [How it works](../explanation/how-it-works.md) · [Health checks](../explanation/health-checks.md)
- [Data model](../reference/data-model.md) (what the library writes)
- [Instrument your own agent](../how-to/instrument-your-agent.md)
