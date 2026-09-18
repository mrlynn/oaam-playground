# memory-inspector

See what an [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/) agent remembers, retrieves and revises, turn by turn.

Status: **milestone 4, step 1**. The run log, the `inspect()` wrapper, and `memory-inspector check` (memory health) all work against the real package.

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

## Check memory health

```bash
pip install "memory-inspector[judge]"      # the judge is optional; see below
memory-inspector check --user aim_app --dsn localhost:1521/FREEPDB1 --judge-model anthropic/claude-sonnet-5
```

How it works:
1. `VECTOR_DISTANCE(..., COSINE)` runs inside the database and finds pairs of memories that sit close together. This is the same metric `search` reports.
2. An LLM judge classifies each pair: duplicate, supersedes, contradicts, complementary or unrelated. It also judges likely conversation-state memories as durable or transient.
3. Pure checks turn those results into findings, which are written to `AIM_FINDINGS` with evidence and a suggested fix.

| finding | severity | means |
|---|---|---|
| `superseded` | high | A memory was corrected or answered later, but the old one is still stored and retrievable. Extraction appends; it never revises. |
| `contradiction` | high | Two memories disagree, and nothing says which is current. |
| `crowded_turn` | high | A recorded turn put stale, duplicate or transient memories in the prompt. Reported once per conversation. |
| `orphan_chunks` | high | Embedded chunks whose record no longer exists. |
| `duplicate` | medium | The same thing is stored more than once. Reported once per cluster, keeping the most complete copy. |
| `transient` | medium | Conversation state ("assistant asked…; awaiting reply") stored as durable memory. The fix includes a tested `memory_extraction_custom_instructions` string. |
| `scope_mismatch` | low | Memories the extractor labelled user-scoped are stored on a thread, so they die with it. |
| `near_duplicate` | low | A close pair nobody classified: there was no judge, or its reply couldn't be read. |

How the judge behaves:
- **Verdicts are cached** in `AIM_JUDGMENTS`, keyed by model, prompt version and the exact content judged. A rerun gives the same answer at no cost, and an edited memory is judged again.
- **Accuracy:** on 11 hand-labelled seed pairs, `claude-sonnet-5` agrees 9–10 of 11. Haiku 4.5 also scores 9, but it calls a cause/fix pair a duplicate, so it isn't recommended. `agent/spikes/judge_agreement.py` re-measures this.
- **Without a judge** (`--no-judge`), a pair is only called superseded when the newer memory says it corrects the older one. Everything else is reported as `near_duplicate`, and transient memories are found by pattern only. Each finding's `method` says how it was decided.

Each run is compared with the previous run of the same scope and judge, and reports what's new and what's resolved. Fix a finding in code (for example `memory.delete_memory(...)`) and check again to watch it resolve.

Supported: `oracleagentmemory` 26.6.x on Oracle AI Database 26ai.
