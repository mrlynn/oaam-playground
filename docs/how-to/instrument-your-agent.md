# How to instrument your own agent

Add the memory inspector to an agent that already uses `oracleagentmemory`, so its turns show up in the dashboard and its store can be health-checked. The companion (`companion/`) does exactly this, and is the working example.

## Prerequisites

- An agent that uses `oracleagentmemory` 26.6.x with **inline** extraction (the default) and synchronous calls.
- Its client is built on an **`oracledb` connection pool**, not a single connection.
- The schema user can create tables and views (the package already needs `CREATE TABLE` and `CREATE VIEW`).
- To use the dashboard: a read-only user to grant views to (`aim_web` in this repo), and the dashboard's `AIM_SCHEMA` pointed at your schema.

## Steps

1. **Install the library** into your agent's environment.

   ```bash
   uv add --editable ../path/to/oracle/inspector     # or: pip install -e ../path/to/oracle/inspector
   ```

   Add the `[judge]` extra if you'll run the health check with an LLM judge from this environment.

2. **Create the run log and health tables** in your agent's schema, once. It's safe to rerun.

   ```bash
   export MEMORY_INSPECTOR_DB_PASSWORD=...
   memory-inspector init --user <your_schema_user> --dsn localhost:1521/FREEPDB1 --grant-to aim_web
   ```

   Or from Python, at startup: `from memory_inspector import install; install(conn, grant_to="aim_web")`.

3. **Wrap the client.** This is the one required change.

   ```python
   from memory_inspector import inspect

   client = OracleAgentMemory(connection=pool, embedder=..., llm=..., schema_policy=...)
   memory = inspect(client, pool=pool)          # use `memory` exactly as you used `client`
   ```

   Threads you get from `memory.create_thread()` or `memory.get_thread()` are wrapped too. Keep calling `memory.close()` at shutdown. It also writes anything the inspector has buffered.

4. **Optional: report the prompt.** Without this, results are labelled "returned by search". With it, the dashboard can say which ones actually went into the prompt, and the health check can find crowded prompts precisely. Call it after you build the prompt and before `add_messages`:

   ```python
   results = memory.search(question, user_id=user, record_types=["memory", "fact", "preference", "guideline"])
   used = results[:5]
   # ... build the prompt from `used`, call your model ...
   memory.inspector.record_prompt(prompt_text, reply_text, usage=response.usage,
                                  memory_ids_used=[r.id for r in used])
   thread.add_messages([{"role": "user", "content": question}, {"role": "assistant", "content": reply_text}])
   ```

5. **Run your agent as usual.** Each `search` then `add_messages` pair becomes one turn. If your agent writes the exchange in pieces, or does unusual things between writes, mark the boundary yourself:

   ```python
   with memory.inspector.turn(thread):
       ...   # everything in here is one turn
   ```

6. **Look at it.** Point the dashboard at your schema (`AIM_SCHEMA=<YOUR_SCHEMA>` in `web/.env.local`), and install the demo views over the package tables in that schema. In this repo that's `agent/scripts/apply_sql.py --user …`, which runs `infra/sql/10_views.sql` and `20_web_grants.sql`. Then open `/runs`.

7. **Check its health.**

   ```bash
   memory-inspector check --user <your_schema_user> --dsn localhost:1521/FREEPDB1 --judge-model anthropic/claude-sonnet-5
   ```

## Verification

- `select count(*) from aim_turns` grows by one per exchange.
- `/runs` shows a **Turns** number for your threads, and the thread page has a scrubber.
- Nothing about the agent's replies or timing changed noticeably. The inspector reads the memory table twice per write turn and writes once afterwards.
- `select stage, count(*) from aim_run_events group by stage` has only a small share of `other`, and `select count(*) from aim_run_events where json_value(attrs, '$.mapped') = 'false'` is 0 or close to it.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `TypeError: pool must be an oracledb connection pool` | you passed a connection | build the client on `oracledb.create_pool(...)`, and pass the same pool |
| `memory-inspector: dropped turn for run …: ORA-00942` in the logs | the run log tables don't exist in this schema | run `memory-inspector init` (step 2) |
| Searches show up, but no turns | the agent searches without a thread and never calls `add_messages` in the same flow | use `with memory.inspector.turn(thread):`, or search through the thread (`thread.search`) |
| Many events with no run (`run_id` is NULL) | `BACKGROUND` extraction: the package works after the turn closes | switch to inline extraction, or accept unattributed spans |
| "`… is not instrumented yet`" warning | you call `*_async` methods | recording covers sync calls only. The calls still work. |
| Memory diffs are empty | your tables have a prefix | pass `memory_table=` and `thread_table=` to `inspect()` |
| `ValueError: grant_to is not a valid Oracle identifier` | a typo in `--grant-to` | use a plain user name |
| `source` rejected (`ORA-02290`) | `inspect(source=…)` isn't `instrumented`, `replay` or `live` | use one of those |
| `reply_source` rejected (`ORA-02290`) | `record_prompt(reply_source=…)` isn't `model` or `scripted` | use one of those |
| Stage mix is mostly `other` after upgrading the package | the log messages changed | see [operate: after a package upgrade](operate.md#after-a-package-upgrade) |

## Related

- [Library reference](../reference/inspector.md) · [How it works](../explanation/how-it-works.md)
- `companion/src/companion/config.py` (the `inspect` call) and `agent.py` (`record_prompt`, `last_turn`)
