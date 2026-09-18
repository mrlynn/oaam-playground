# memory-inspector

See what an [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/) agent remembers, retrieves and revises, turn by turn.

Status: **milestone 3, step 2**. The run log schema, `init`, and the `inspect()` wrapper that fills it all work against the real package.

## Install the run log

The run log lives in the same schema as your agent's memory store, in its own tables (`AIM_RUNS`, `AIM_TURNS`, `AIM_RUN_EVENTS`) with read-only views (`AIM_V_*`) for a dashboard. It never writes to package tables.

```bash
export MEMORY_INSPECTOR_DB_PASSWORD=...   # or omit it and you'll be prompted
memory-inspector init --user aim_app --dsn localhost:1521/FREEPDB1 --grant-to aim_web
```

Or from Python, on a connection you already have:

```python
from memory_inspector import install
install(conn, grant_to="aim_web")
```

Both are idempotent. The schema user needs `CREATE TABLE` and `CREATE VIEW`, which the memory package already requires.

## Instrument your agent

```python
from memory_inspector import inspect

memory = inspect(OracleAgentMemory(connection=pool, embedder=..., llm=...), pool=pool)
# use memory and its threads exactly as before
memory.close()   # writes anything still buffered
```

A **turn** opens on the first instrumented call and closes when the agent writes the exchange (`thread.add_messages`) or deletes the thread. Each turn records:
- the searches the agent ran, with rank, record type and distance for every result
- the messages written
- the memories created, updated or deleted, with before and after content
- a timed tree of the package's own work: ingestion, extraction, consolidation, retrieval, summarization and revision

Turn numbers continue across restarts.

Optional, if you want prompt and cost data:

```python
memory.inspector.record_prompt(prompt, reply, usage=response.usage,
                               memory_ids_used=[r.id for r in results[:5]])
```

Without it, results are labelled "returned by search". With `memory_ids_used`, they are labelled "in prompt" or not.

To set the boundary yourself: `with memory.inspector.turn(thread): ...`

**It never breaks your agent.** Arguments and results pass through unchanged. Instrumentation errors and failed run log writes are logged to the `memory_inspector` logger and dropped. Your app's logging output doesn't change.

**Limits:**
- Inline extraction only. With `BACKGROUND` extraction, the package's records arrive after the turn closes and are stored as unattributed.
- `*_async` methods pass through unrecorded, with a one-time warning.
- `delete_user`, `delete_agent` and `update_thread` pass through unrecorded.
- One writer process per thread at a time.

Supported: `oracleagentmemory` 26.6.x on Oracle AI Database 26ai.
