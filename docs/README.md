# Agent memory inspector

A memory inspector for [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/). It shows what an agent remembers and why: threads and messages, durable memories with their retrieval distances, and each lifecycle stage as it fires.

Personal work sample, built to learn the package. Apache-2.0.

Status: **milestone 1**, the walking skeleton plus the phase 0 schema inspection. There is no dashboard yet.

## Prerequisites

- Docker (the image is arm64 and amd64)
- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you)
- An Anthropic API key for extraction and an OpenAI API key for embeddings

## Run it

```bash
cp infra/.env.example infra/.env        # then set three passwords
cp agent/.env.example agent/.env        # then add API keys
docker compose -f infra/docker-compose.yml up -d
cd agent && uv sync
uv run python scripts/smoke.py          # thread, messages, memory, search
uv run python scripts/dump_schema.py    # writes docs/schema-snapshot.md
```

## Layout

| path | what |
|---|---|
| `infra/` | compose file (pinned `gvenzl/oracle-free:23.26.3-faststart`) and first-boot user setup |
| `agent/` | client factory, smoke test, schema dumper, scripted conversations |
| `labs/` | notebooks (milestone 4) |
| `web/` | Next.js dashboard (milestone 2) |
| `docs/` | schema snapshot, phase 0 answers, friction log |

## Database users

- `aim_app` owns the package-managed schema and, later, the run log. Grants are explicit (see `infra/init/01_users.sh`) so we know exactly what the package needs.
- `aim_web` is the dashboard login. It gets SELECT on views only, so the dashboard can't write.
