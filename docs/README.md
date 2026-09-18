# Agent memory inspector

A memory inspector for [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It shows what an agent remembers and why: threads and messages, durable memories with their retrieval distances, and each lifecycle stage as it fires.

Personal work sample, built to learn the package. Apache-2.0.

Status: **milestone 2**. There is a read-only thread view on real rows. The run log, scrubber and lifecycle view come in milestone 3.

![Thread view: conversation on the left, the durable memories it produced on the right](img/thread-view.png)

## Prerequisites

- Docker (the image is arm64 and amd64)
- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you)
- Node 20+ for the dashboard
- An Anthropic API key for extraction
- Embeddings: local [Ollama](https://ollama.com) with `nomic-embed-text` (the default), or an OpenAI key with `AIM_EMBED_MODEL=openai/text-embedding-3-small`

## Run it

```bash
cp infra/.env.example infra/.env        # then set three passwords
cp agent/.env.example agent/.env        # then add API keys
docker compose -f infra/docker-compose.yml up -d

cd agent && uv sync
uv run python scripts/seed.py --reset   # 3 scripted conversations, turn by turn (~2 min, LLM calls)
uv run python scripts/apply_sql.py      # read-only views + grants for the dashboard
uv run python scripts/check_web_grants.py

cd ../web && cp .env.example .env.local # AIM_WEB_PASSWORD from infra/.env
npm install && npm run dev              # http://localhost:3000
```

Other scripts: `smoke.py` (the minimal proof: one thread, one memory, one search) and `dump_schema.py` (regenerates `docs/schema-snapshot.md`; rerun after any package bump).

`seed.py --reset` recreates the package schema, which leaves the views invalid. Rerun `apply_sql.py` after it.

## Layout

| path | what |
|---|---|
| `infra/` | compose file (pinned `gvenzl/oracle-free:23.26.3-faststart`) and first-boot user setup |
| `infra/sql/` | read-only views over the package schema (`AIM_V_*`) and the dashboard's grants |
| `agent/` | client factory, seed/smoke scripts, schema dumper, scripted conversations |
| `labs/` | notebooks (milestone 4) |
| `web/` | Next.js dashboard: `/runs` and `/runs/[id]` |
| `docs/` | schema snapshot, phase 0 answers, friction log, milestone plans |

## Database users

- `aim_app` owns the package-managed schema and, later, the run log. Grants are explicit (see `infra/init/01_users.sh`) so we know exactly what the package needs.
- `aim_web` is the dashboard login. It gets SELECT on the four `AIM_V_*` views and nothing else. `check_web_grants.py` proves that reading base tables and writing through views both fail.
