# Scripts and configuration reference

Every command-line entry point in the repo, and every setting it reads. Paths are relative to the repo root. Python projects use [uv](https://docs.astral.sh/uv/), so run scripts with `uv run` from inside the project's directory.

## Where settings come from

| file | read by | holds |
|---|---|---|
| `infra/.env` | docker compose, then every Python project as a fallback | `ORACLE_PASSWORD`, `AIM_APP_PASSWORD`, `AIM_WEB_PASSWORD`, `AIM_LIVE_PASSWORD` |
| `agent/.env` | `agent/`, and as a fallback `companion/` and `labs/` | `ANTHROPIC_API_KEY`, `AIM_LLM_MODEL`, `AIM_EMBED_MODEL`, optional `OPENAI_API_KEY` and `AIM_MEMORY_STORE_ID` |
| `companion/.env` | `companion/` (optional) | `COMPANION_*` overrides |
| `labs/.env` | `labs/` (optional) | `LAB_*` overrides |
| `web/.env.local` | the dashboard | `AIM_WEB_USER`, `AIM_WEB_PASSWORD`, `AIM_DB_DSN`, `AIM_SCHEMA` |

Every `.env` is gitignored. `infra/`, `agent/`, `companion/` and `web/` each have a committed `.env.example`. The labs need none of their own, because they fall back to `agent/.env` and `infra/.env`.

| variable | default | meaning |
|---|---|---|
| `AIM_LLM_MODEL` | `anthropic/claude-sonnet-5` | LiteLLM id used for extraction, the companion's replies, and the health check's judge |
| `AIM_EMBED_MODEL` | `ollama/nomic-embed-text` | embeddings. Needs local Ollama (`ollama pull nomic-embed-text`). The vector dimension is fixed when a schema is first created. |
| `AIM_DB_DSN` | `localhost:1521/FREEPDB1` | |
| `AIM_DB_USER` | `aim_app` | the schema `agent/` scripts use unless `--user` says otherwise |
| `AIM_MEMORY_STORE_ID` | unset | namespaces the package's tables (rarely needed) |

## Infrastructure (`infra/`)

```bash
docker compose -f infra/docker-compose.yml up -d     # healthy in ~10 s with the faststart image
docker compose -f infra/docker-compose.yml down      # stop; keeps data
docker compose -f infra/docker-compose.yml down -v   # DESTROYS both schemas, including aim_live
```

The container is `aim-oracle`, on port 1521. `infra/init/*.sh` run once, on a fresh volume. To add `aim_live` to an existing container:

```bash
docker exec -e AIM_LIVE_PASSWORD="$AIM_LIVE_PASSWORD" aim-oracle bash /container-entrypoint-initdb.d/02_live_user.sh
```

## Demo scripts (`agent/scripts/`)

Run from `agent/` with `uv run python scripts/<name>.py`.

| script | what it does | flags |
|---|---|---|
| `seed.py` | Installs the run log and health tables, then replays every `companion/conversations/*.yaml` through the companion in file-name order, into `aim_app`. Ends with a health check. About 4 minutes of LLM calls. | `--reset` drops and recreates the package schema and clears the run log and check runs (**`aim_app` only**; it refuses anything else). `--no-check` skips the check. |
| `apply_sql.py` | Installs the demo views (`infra/sql/`) and the library's tables, views and grants into one schema, then fails loudly if anything is `INVALID`. **Run after every `seed.py --reset`.** | `--user aim_app\|aim_live`. `--create-store` creates the package schema first if it's missing (one embedding call). |
| `check.py` | The health check with this repo's settings (judge = `AIM_LLM_MODEL`) | `--user`, `--user-id`, `--no-judge`, `--threshold` |
| `demo_links.py` | Prints today's demo URLs for the seeded data, and says whether each demo moment reproduced | `--base` (dashboard URL) |
| `check_web_grants.py` | Proves `aim_web` can read every view and nothing else, in both schemas. Exit 1 on any failure. | `--schema` (repeatable) |
| `probe_inspector.py` | The inspector's end-to-end check against the live package: two turns, a correction, a delete. Asserts turn numbering, no unmapped stages, and the delete diff. **Rerun after any package upgrade.** | Env `MEMORY_INSPECTOR_FAIL_WRITES=1` checks that the agent survives failed writes. |
| `smoke.py` | The minimal proof from milestone 1: one thread, one memory, one search, printing every field. It **bypasses the inspector**, so its thread shows the plain layout. | |
| `dump_schema.py` | Regenerates `docs/schema-snapshot.md` from the live schema. Rerun after upgrades and diff it. | |

## Spikes (`agent/spikes/`)

Experiments whose results the design depends on. Rerun them when the thing they measured changes.

| spike | measures | rerun when |
|---|---|---|
| `search_metric.py` | which metric `search`'s distance uses (COSINE, exactly) | the package or embedder changes |
| `custom_instructions.py` | whether `memory_extraction_custom_instructions` stops transient and stale memories (transient mostly, stale no). `--compare` tests the first wording against the shipped one, with a probe that repeats an unanswered question. Uses throwaway users and deletes them. | the package or the instruction wording changes |
| `judge_agreement.py` | the health check's judge against 11 hand-labelled pairs (`inspector/tests/fixtures/judge_pairs.json`) | `PAIR_VERSION` or the judge model changes. Pass model ids as arguments. |

## Companion (`companion/`)

```bash
cd companion && uv sync
uv run companion                                          # chat, schema aim_live
uv run companion --script conversations/support_01.yaml   # replay into aim_app
uv run companion --script conversations/support_01.yaml --live   # the model writes the replies
uv run companion --web                                    # the same chat in a browser, http://localhost:8765
```

| flag | meaning |
|---|---|
| `--script FILE` | replay a YAML conversation (`user_id`, `agent_id`, `messages`, optional `explicit_memory`) |
| `--live` | with `--script`, the model writes the replies instead of the scripted lines |

Chat, in the terminal or with `--web`, creates each thread with the inspector's tested `memory_extraction_custom_instructions` (`EXTRACTION_INSTRUCTIONS`), so conversation state like "the assistant asked…; awaiting reply" isn't stored. `--script` replays don't use them, so the seeds still produce the transient memories the demo and labs find.
| `--web` | serve the chat as a web page instead of the terminal |
| `--host`, `--port` | with `--web`. Default `127.0.0.1` and `8765`. Any address that isn't loopback needs `COMPANION_WEB_TOKEN`. |
| `--db-user` | schema. Default `aim_live` for chat, `aim_app` for scripts. |
| `--user-id` | memory user. Default `COMPANION_USER_ID` or `me` for chat, the YAML's for scripts. |

Chat commands: `/why` (what the last reply was built from), `/new` (a new thread), `/quit` (or Ctrl-D). The web page has the same `/why` and `/new`, as buttons and as commands.

| variable | default |
|---|---|
| `COMPANION_DB_USER` | `aim_live` |
| `COMPANION_DB_PASSWORD` | `<DB_USER>_PASSWORD`, e.g. `AIM_LIVE_PASSWORD` |
| `COMPANION_DB_DSN` | `AIM_DB_DSN`, then `localhost:1521/FREEPDB1` |
| `COMPANION_LLM_MODEL` | `AIM_LLM_MODEL`. Any LiteLLM id: `ollama_chat/qwen3.5:9b` runs the terminal companion on a local model. |
| `OLLAMA_API_BASE` | `http://localhost:11434`. Where the web page looks for local models, and where LiteLLM sends `ollama_chat/` calls. |
| `COMPANION_EMBED_MODEL` | `AIM_EMBED_MODEL` |
| `COMPANION_USER_ID` | `me` |
| `COMPANION_AGENT_ID` | `companion` |
| `COMPANION_DASHBOARD_URL` | `http://localhost:3000`. The web page links each turn to it. Set it empty to hide the links. |
| `COMPANION_WEB_TOKEN` | unset. When set, the web page needs `?token=` once per browser and accepts any host. |

Scripted conversations live in `companion/conversations/`:
- `onboarding_01`: Alice onboards two analysts, with 90-day access, email only.
- `support_01`: Alice's export fails, and she corrects the bucket region.
- `support_02`: Bob's Postgres sync. He prefers phone.
- `support_03`: Alice's two-topic question, which reproduces the crowded-prompt miss.

## Labs (`labs/`)

```bash
cd labs && uv sync && uv run jupyter lab
uv run jupyter nbconvert --to notebook --execute lab3_retrieval_quality.ipynb --output-dir /tmp/labs
```

| variable | default | meaning |
|---|---|---|
| `LAB_DB_USER` | `aim_app` | schema |
| `LAB_DB_PASSWORD` | `<LAB_DB_USER>_PASSWORD` | |
| `LAB_SUFFIX` | empty | appended to the lab users (`lab1`, `lab2`, `lab3`) to keep several people apart on one database |
| `LAB_DASHBOARD` | `http://localhost:3000` | used in printed links |

`labkit.py` provides `connect()`, `lab_user()`, `reset_user()`, `replay()`, `memories()`, `show_memories()`, `show_results()`, `check()`, `run_url()` and `CONTACT_PREFERENCE`. It also filters the package's "asynchronous method … can lead to deadlocks" warning in Jupyter (friction log).

## Tests

```bash
cd inspector && uv run pytest -q      # 80: stages and spans (captured fixture), turns, diff, health checks, judge
cd companion && uv run pytest -q      # 28: prompt assembly, token counting, extraction instructions, /why, the web server, model choice
cd web && npm test                    # 25: memory state, "why" rows, findings, lifecycle
cd web && npm run lint && npm run build
cd site && npm test                   # 5: the committed export through the shared logic
cd site && npm run typecheck && npm run build   # the build fails on any broken link or anchor
```

## Docs site (`site/`)

A Docusaurus site over `docs/`, read in place, plus a replay of the seeded demo that runs in the browser with no database.

```bash
cd site && npm install
npm start                             # http://localhost:3100/oaam-playground/, live reload (3000 is the dashboard's)
npm run build && npm run serve        # the production build
```

| command | what it does |
|---|---|
| `cd web && npm run export-demo` | Exports the seeded demo from `AIM_APP` (as `aim_web`, through the views) to `site/src/data/demo.json`. Refuses any other schema. Writes nothing if a demo moment didn't reproduce. |
| `cd site && npm test` | Runs the committed export through the dashboard's pure logic. |

`.github/workflows/site.yml` builds and tests the site on every push that touches `docs/`, `site/` or `web/src/lib/`. It deploys to GitHub Pages only when the repo variable `PAGES_ENABLED` is `true`.

## The one-URL demo (`demo.sh`)

```bash
./demo.sh                      # aim_live: your own conversations
./demo.sh --schema aim_app     # the seeded demo data
./demo.sh --schema aim_app --user-id u_alice   # and chat as a seeded user
./demo.sh --port 3005          # the front door on another port
```

It starts the companion's web server (`:8765`), the docs site built with `SITE_MODE=demo` (`:3101`, rebuilt into `site/build-demo` when `docs/` or the site changed), and the dashboard (`:3000`), which proxies `/chat` and `/docs` to the other two. The chat writes to the schema you pick and the dashboard reads the same one, because the script sets `AIM_SCHEMA` (which wins over `web/.env.local`). The chat talks as `--user-id` (default `COMPANION_USER_ID`, then `me`). On `aim_app`, `me` is a new user with no memories, so use a seed user (`u_alice`, `u_bob`) to chat against the seeded memories. It reuses a chat server already on `:8765` only if that server uses the same schema and user and started after `companion/` last changed (an older one serves old code, so it stops and asks you to restart it), and stops with a message if the dashboard is already running from `web/`. Ctrl-C stops all three.

| variable | default | meaning |
|---|---|---|
| `PORT` | `3000` | the front door, same as `--port` |
| `COMPANION_PORT` | `8765` | the chat server |
| `DOCS_PORT` | `3101` | the demo build of the docs site |

`SITE_MODE=demo` changes only the docs site's paths and navbar: it's served under `/docs/`, its guide is at `/docs/guide/…` instead of `/docs/docs/…`, and the navbar links to Chat, Runs and Memory. The default build is still the GitHub Pages site.

## Dev server in this repo

`.claude/launch.json` defines `demo` (`./demo.sh`, `autoPort: true`), `web` (`npm --prefix web run dev`, `autoPort: true`), `companion` (the chat alone, on 8765) and `site` (the built docs site on port 3100). Next 16 refuses a second `next dev` in the same directory, so stop any other session's server first.

## Related

- [Operate and troubleshoot](../how-to/operate.md) · [Library reference](inspector.md) · [Dashboard reference](dashboard.md)
