# How to operate and troubleshoot

The day-to-day tasks: reseed, look at your real data, upgrade the package, run the tests, and fix the things that usually go wrong. Commands are run from the directory named in each step.

## Reseed the demo data

```bash
cd agent
uv run python scripts/seed.py --reset       # ~4-5 min: 4 conversations through the companion, then a health check
uv run python scripts/apply_sql.py          # REQUIRED after --reset: the package views go INVALID
uv run python scripts/check_web_grants.py   # optional: prove the dashboard is still read-only
uv run python scripts/demo_links.py         # today's demo URLs
```

What `--reset` does, in order:
1. Installs the library tables, if missing.
2. Recreates the package schema in `aim_app`. It refuses any other schema.
3. Clears the run log and check runs. The judge cache stays, because it's keyed by content.
4. Replays each conversation in `companion/conversations/` in file-name order.
5. Runs a judged health check.

Extraction is an LLM, so the memories differ each time. Nothing downstream depends on exact content.

To add conversations without resetting, run `seed.py` without `--reset`. It appends threads and runs a new check.

## Use your real data

The companion writes to `aim_live` by default.

```bash
cd companion && uv run companion                  # talk to it for a few days
cd agent && uv run python scripts/check.py --user aim_live
```

To see it in the dashboard, set `AIM_SCHEMA=AIM_LIVE` in `web/.env.local` and restart `npm run dev`. Set it back to `AIM_APP` before any demo or screenshot.

If `aim_live` is missing on an older container:

```bash
set -a; . infra/.env; set +a
docker exec -e AIM_LIVE_PASSWORD="$AIM_LIVE_PASSWORD" aim-oracle bash /container-entrypoint-initdb.d/02_live_user.sh
cd agent && uv run python scripts/apply_sql.py --user aim_live --create-store
```

**Never** `docker compose down -v`. It deletes both schemas, including `aim_live`.

## After a package upgrade

The inspector reads `oracleagentmemory`'s log messages and table names, so a new version needs checking before you trust the dashboard again. The library pins `>=26.6.0,<26.7`, so bump that pin deliberately.

1. **Regenerate the schema snapshot and diff it.**

   ```bash
   cd agent && uv run python scripts/dump_schema.py && git diff ../docs/schema-snapshot.md
   ```

2. **Run the end-to-end probe.** It fails if turns misnumber, if any span is unmapped, or if the delete diff is empty.

   ```bash
   uv run python scripts/probe_inspector.py
   ```

   If it reports unmapped spans, capture a new fixture (see `inspector/tests/fixtures/turn_log.jsonl` for the format) and extend `RULES` in `inspector/src/memory_inspector/stages.py`.

3. **Recheck the facts the design depends on.**

   ```bash
   uv run python spikes/search_metric.py            # is search distance still COSINE?
   uv run python spikes/custom_instructions.py      # does extraction still append corrections?
   ```

4. **Reapply views** (`apply_sql.py`) for both schemas, and run all the tests.

## Change the health check's judge

After editing a prompt in `inspector/src/memory_inspector/health/judge.py`, or changing the judge model:
1. **If a prompt changed, bump its version** (`PAIR_VERSION` or `MEMORY_VERSION`), so cached verdicts are discarded.
2. **Measure agreement:** `cd agent && uv run python spikes/judge_agreement.py anthropic/<model>`. Keep the contradiction and the complementary pair right, and at least 9 of 11 overall.
3. **Run the check twice:** `uv run python scripts/check.py`. The second run should make 0 judge calls and report nothing new or resolved.

## Run the tests

```bash
cd inspector && uv run pytest -q          # 76
cd companion && uv run pytest -q          # 11
cd web && npm test && npm run lint && npm run build     # 23 tests
```

Only the probe and the spikes touch the database and models. Every unit test runs offline.

## Troubleshooting

| symptom | likely cause | fix |
|---|---|---|
| The dashboard shows "database unreachable" | the container is stopped, or `AIM_WEB_PASSWORD` is wrong in `web/.env.local` | `docker compose -f infra/docker-compose.yml up -d`, and check the password against `infra/.env` |
| Pages error with `ORA-04063` or `ORA-00942` right after a reset | the package views are INVALID | `uv run python scripts/apply_sql.py` |
| `/runs` shows threads with a blank Turns column | they were written without the inspector (for example `smoke.py`) | expected: those threads get the plain layout |
| The "why" view has no badges | no judged check has run since the data changed | `uv run python scripts/check.py` |
| `/memories` says "No health check yet" | none for this schema | as above, with `--user` for `aim_live` |
| Every call hangs, then fails on embeddings | Ollama isn't running, or the model isn't pulled | `ollama serve`, then `ollama pull nomic-embed-text` |
| `InternalServerError: Missing credentials`, retried 3 times | no API key for the embedder or LLM | set it in `agent/.env` (the package retries auth errors: friction log) |
| `ORA-51812 … dimension formats (FLOAT64, FLOAT32)` in your own SQL | you bound a float32 vector | bind `array.array("d", …)`, because the store uses FLOAT64 |
| `refusing --reset on aim_live` | it's working as designed | only `aim_app` can be reset |
| `AIM_LIVE_PASSWORD is not set` | the `.env` predates `aim_live` | add it to `infra/.env` (see `infra/.env.example`) |
| `next dev`: "Another next dev server is already running" | another session's dev server owns `web/` | stop it, or use that server |
| `UnsupportedParamsError … temperature=0` | the newer model rejects it | don't pass `temperature` (the judge already doesn't) |
| The judge reports `unparsed` verdicts | a reply was cut off or had no JSON | rerun. Unparsed verdicts aren't cached. If they persist, check `MAX_TOKENS` in `judge.py`. |
| Jupyter prints "asynchronous method … can lead to deadlocks" | the package's sync API inside Jupyter's event loop | harmless, and `labkit` filters it. Import `labkit` first. |
| `seed.py` prints `[warn ignored] DatabaseError … details suppressed` | the package's `RECREATE` hides its own DDL errors | expected and harmless: the schema comes out complete (friction log) |

## Related

- [Scripts and configuration](../reference/scripts-and-config.md) · [Data model](../reference/data-model.md)
- [Instrument your own agent](instrument-your-agent.md) · [Demo guide](demo.md)
