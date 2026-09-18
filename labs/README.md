# Labs: agent memory you can see, diagnose and fix

Three Jupyter notebooks on [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/), built around the [memory inspector](../inspector/README.md). They teach one loop: **look at what the agent remembered, find what's wrong, fix it, check again.** They're not an API tour.

| lab | time | you will |
|---|---|---|
| [1 · Your first memory](lab1_first_memory.ipynb) | 15 min | connect, wrap the client with `inspect()`, and see a memory as table rows, as a search result with its cosine distance, and in the dashboard. Then run your first health check. |
| [2 · Extraction and scope](lab2_extraction_and_scope.ipynb) | 25 min | replay a support conversation one exchange at a time. Watch extraction keep conversation state and a stale fact, then fix the first with custom instructions and see why the second can't be fixed that way. Check the user boundary, and lose a preference by deleting its thread. |
| [3 · Retrieval quality](lab3_retrieval_quality.ipynb) | 25 min | ask a clean question, a near miss, and a two-topic question whose answer isn't in the top 10. Record the turn, find the crowded prompt, delete what the check names, ask again, then split the question. |

**Every lab starts cold.** Each one uses its own memory user (`lab1`, `lab2`, `lab3`) and resets it first, so you can start at lab 3, rerun any lab, or skip one. Set `LAB_SUFFIX` to keep several people apart on one database.

## Setup

From the repo root, with the database running and the schema prepared (see the [main README](../docs/README.md)):

```bash
cd labs && uv sync
uv run jupyter lab
```

Settings come from `labs/.env` if it exists, otherwise from the repo's `agent/.env` and `infra/.env`: `AIM_APP_PASSWORD`, `ANTHROPIC_API_KEY`, `AIM_LLM_MODEL`, `AIM_EMBED_MODEL`. The labs write to the `aim_app` schema, which the dashboard shows by default, so run it alongside (`cd web && npm run dev`).

**Cost:** every exchange runs extraction (two or three LLM calls), and the health check uses an LLM judge whose verdicts are cached. A full pass through all three labs is roughly 30 extraction calls and 40 judge calls.

**Your results will differ from anyone else's.** Extraction is an LLM, so the memories, and therefore the findings, change from run to run. Each lab is written to make its point whichever way a particular run goes, and says where you might see something different.

## For maintainers

- `labkit.py` holds the shared plumbing (connection, lab users, replay, printing, checks), so each notebook shows only what it teaches.
- The notebooks are committed **without outputs**. Before sharing, run each one top to bottom against a fresh seed:

  ```bash
  uv run jupyter nbconvert --to notebook --execute lab3_retrieval_quality.ipynb --output-dir /tmp/labs
  ```
