# memory-inspector

See what an [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/) agent remembers, retrieves and revises, turn by turn.

Status: **milestone 3, step 1**. The run log schema and `init` exist. The `inspect()` wrapper that fills them comes in step 2.

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

Supported: `oracleagentmemory` 26.6.x on Oracle AI Database 26ai.
