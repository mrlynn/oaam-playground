# Agent memory inspector

A memory inspector for [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It shows what an agent remembers and why, finds what's wrong with that memory, and teaches how to fix it.

Personal work sample, built to learn the package. Apache-2.0.

**What's here**
- **`memory-inspector`** is a library: one `inspect()` call records every turn of an agent (searches with their cosine distances, memory changes, a timed trace of the package's own work). `memory-inspector check` runs a health check on the whole store: stale corrections, duplicates, conversation state stored as memory, and the turns where they crowded a prompt.
- **A dashboard** that steps through a conversation turn by turn. It answers "why did it say that?" for every reply, draws each turn's lifecycle, and lists health findings with evidence and fixes.
- **The companion**, a small real agent that uses the library daily, with `/why` in the terminal.
- **Three labs** built on one loop: look, find, fix, check again.
- **[What we learned](friction.md#summary-five-fixes):** five suggested fixes for the package, each with a reproduction script.

Status: **milestone 4.** Every step is built except validating the health check on real companion data ([plan](plans/m4-health.md)).

## Documentation

| I want to… | read |
|---|---|
| see it work, from a clean machine | [Tutorial: first run](tutorial/first-run.md) |
| show it to someone (5 min, 15 min, workshop) | [Demo guide](how-to/demo.md), with `agent/scripts/demo_links.py` for today's URLs |
| understand how it works and why | [How it works](explanation/how-it-works.md) · [How the health check works](explanation/health-checks.md) |
| add it to another agent | [Instrument your own agent](how-to/instrument-your-agent.md) |
| reseed, upgrade, fix something | [Operate and troubleshoot](how-to/operate.md) |
| look up an API, table, page or flag | [Library and CLI](reference/inspector.md) · [Data model](reference/data-model.md) · [Dashboard](reference/dashboard.md) · [Scripts and configuration](reference/scripts-and-config.md) |
| know what we learned about the package | [Friction log and five fixes](friction.md) · [Token method](token-method.md) · [Phase 0 answers](phase0-answers.md) · [Schema snapshot](schema-snapshot.md) |
| see how it was planned and built | [M2](plans/m2-thread-view.md) · [M3](plans/m3-run-log.md) · [M4](plans/m4-health.md) |

![Thread view: conversation on the left, the durable memories it produced on the right](img/thread-view.png)

## Prerequisites

- Docker (the image is arm64 and amd64)
- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you)
- Node 20+ for the dashboard
- An Anthropic API key for extraction
- Embeddings: local [Ollama](https://ollama.com) with `nomic-embed-text` (the default), or an OpenAI key with `AIM_EMBED_MODEL=openai/text-embedding-3-small`

## Run it

```bash
cp infra/.env.example infra/.env        # then set four passwords
cp agent/.env.example agent/.env        # then add API keys
docker compose -f infra/docker-compose.yml up -d

cd agent && uv sync
uv run python scripts/seed.py --reset   # replays 4 conversations through the companion, then a health check (~4 min, LLM calls)
uv run python scripts/apply_sql.py      # read-only views, run log, grants for the dashboard
uv run python scripts/apply_sql.py --user aim_live --create-store   # the schema for real conversations
uv run python scripts/check_web_grants.py

cd ../web && cp .env.example .env.local # AIM_WEB_PASSWORD from infra/.env
npm install && npm run dev              # http://localhost:3000
```

Then talk to it, check it, or learn with it:

```bash
cd companion && uv sync && uv run companion   # /why after any reply you want explained
cd agent && uv run python scripts/check.py    # health check (add --user aim_live for your real data)
cd labs && uv sync && uv run jupyter lab      # labs 1-3
```

Dashboard pages:
- `/runs`: every conversation.
- `/runs/[id]`: the turn scrubber, with "memory at turn n" and "why" for each reply.
- `/runs/[id]/turn/[n]`: the lifecycle of one turn.
- `/memories`: health findings, and every memory with its retrieval count.

Other scripts:
- `smoke.py`: the minimal proof, with one thread, one memory and one search.
- `dump_schema.py`: regenerates `docs/schema-snapshot.md`. Rerun after any package bump.
- `probe_inspector.py`: the inspector's end-to-end check against the real package. Rerun after any package bump.
- `demo_links.py`: prints today's demo URLs and says whether each demo moment reproduced in this seed.
- `check.py`: the health check with this repo's settings (the same as `memory-inspector check`).
- `spikes/`: the M4 spikes (search metric, custom instructions, judge agreement). Rerun `judge_agreement.py` whenever the judge prompt changes.

`seed.py --reset` recreates the package schema in `aim_app` and clears its run log, which leaves the views invalid. Rerun `apply_sql.py` after it. It refuses to run against any other schema.

The dashboard reads `aim_app` by default. Set `AIM_SCHEMA=AIM_LIVE` in `web/.env.local` to look at real conversations instead.

## Layout

| path | what |
|---|---|
| `infra/` | compose file (pinned `gvenzl/oracle-free:23.26.3-faststart`) and first-boot user setup (`init/`) |
| `infra/sql/` | read-only views over the package schema (`AIM_V_*`) and the dashboard's grants |
| `inspector/` | the `memory-inspector` library: `inspect()`, the run log, `check` (memory health), and its SQL. See [its README](../inspector/README.md) |
| `companion/` | the small real agent: chat REPL with `/why`, script replay, scripted conversations. See [its README](../companion/README.md) |
| `agent/` | demo config (`aim_demo`), seed/smoke/probe/check scripts, schema dumper, spikes |
| `labs/` | labs 1–3 as Jupyter notebooks, and `labkit.py`. See [its README](../labs/README.md) |
| `web/` | Next.js dashboard: runs, turn scrubber and "why", lifecycle, memory health |
| `docs/` | schema snapshot, phase 0 answers, [friction log and five fixes](friction.md), [token method](token-method.md), milestone plans |

## Database users

- `aim_app` owns the package-managed schema for the scripted seeds, plus its run log. Grants are explicit (see `infra/init/01_users.sh`) so we know exactly what the package needs.
- `aim_live` is the same shape, for real companion conversations. It is never reset, and nothing from it goes into screenshots without redaction. On a container created before this user existed, create it once with the command at the top of `infra/init/02_live_user.sh`.
- `aim_web` is the dashboard login. It gets SELECT on the `AIM_V_*` views in both schemas and nothing else. `check_web_grants.py` proves that reading base tables, reading run log tables, and writing through views all fail.
