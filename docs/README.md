# Agent memory inspector

A memory inspector for [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It shows what an agent remembers and why: threads and messages, durable memories with their retrieval distances, and each lifecycle stage as it fires.

Personal work sample, built to learn the package. Apache-2.0.

Status: **milestone 3, step 3**. The `memory-inspector` library records every turn of an agent that uses the package, and a small real agent, the [companion](../companion/README.md), uses it daily. The dashboard's scrubber and "why" panel are next ([plan](plans/m3-run-log.md)).

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
uv run python scripts/seed.py --reset   # replays 3 conversations through the companion (~2 min, LLM calls)
uv run python scripts/apply_sql.py      # read-only views, run log, grants for the dashboard
uv run python scripts/apply_sql.py --user aim_live --create-store   # the schema for real conversations
uv run python scripts/check_web_grants.py

cd ../web && cp .env.example .env.local # AIM_WEB_PASSWORD from infra/.env
npm install && npm run dev              # http://localhost:3000
```

Then talk to it:

```bash
cd companion && uv sync && uv run companion   # /why after any reply you want explained
```

Other scripts:
- `smoke.py`: the minimal proof, with one thread, one memory and one search.
- `dump_schema.py`: regenerates `docs/schema-snapshot.md`. Rerun after any package bump.
- `probe_inspector.py`: the inspector's end-to-end check against the real package. Rerun after any package bump.

`seed.py --reset` recreates the package schema in `aim_app` and clears its run log, which leaves the views invalid. Rerun `apply_sql.py` after it. It refuses to run against any other schema.

The dashboard reads `aim_app` by default. Set `AIM_SCHEMA=AIM_LIVE` in `web/.env.local` to look at real conversations instead.

## Layout

| path | what |
|---|---|
| `infra/` | compose file (pinned `gvenzl/oracle-free:23.26.3-faststart`) and first-boot user setup (`init/`) |
| `infra/sql/` | read-only views over the package schema (`AIM_V_*`) and the dashboard's grants |
| `inspector/` | the `memory-inspector` library: run log schema and `init` today; the `inspect()` wrapper next. See [its README](../inspector/README.md) |
| `companion/` | the small real agent: chat REPL with `/why`, script replay, scripted conversations. See [its README](../companion/README.md) |
| `agent/` | demo config (`aim_demo`), seed/smoke/probe scripts, schema dumper |
| `labs/` | notebooks (milestone 4) |
| `web/` | Next.js dashboard: `/runs` and `/runs/[id]` |
| `docs/` | schema snapshot, phase 0 answers, friction log, [token method](token-method.md), milestone plans |

## Database users

- `aim_app` owns the package-managed schema for the scripted seeds, plus its run log. Grants are explicit (see `infra/init/01_users.sh`) so we know exactly what the package needs.
- `aim_live` is the same shape, for real companion conversations. It is never reset, and nothing from it goes into screenshots without redaction. On a container created before this user existed, create it once with the command at the top of `infra/init/02_live_user.sh`.
- `aim_web` is the dashboard login. It gets SELECT on the `AIM_V_*` views in both schemas and nothing else. `check_web_grants.py` proves that reading base tables, reading run log tables, and writing through views all fail.
