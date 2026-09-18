# Milestone 2 plan: the thread view on real rows

2026-09-18. Builds on `docs/schema-snapshot.md` (package 26.6.0, schema version 12) and `docs/phase0-answers.md`.

## Goal

A read-only dashboard showing real rows: a list of conversations, and one conversation with its messages on the left and the memories it produced on the right. There is no scrubber, run log or retrieval data yet (milestone 3). Per the spec, this is the first thing worth sending to Richmond, so it should look deliberate, not like scaffolding.

Done means someone can clone the repo, start the container, seed, run `npm run dev`, and click from `/runs` into a conversation that shows extracted memories with their type, scope, importance and entities.

## Decisions

| decision | choice | why |
|---|---|---|
| What is a "run" before the run log exists? | **run = thread**, 1:1. `/runs/[id]` takes a thread id. | M3's run log gets a `thread_id` column, and one scripted conversation is one thread. No route changes later. |
| Dashboard DB access | Log in as `aim_web` with SELECT on four views only, and qualify every query with `AIM_APP.` | Makes "observer" something the database enforces, not a code convention. `aim_web` has no CREATE SYNONYM, and qualified names stay explicit. |
| Expired rows | Views include them with an `is_expired` flag. The UI hides them by default. | The package hides expired rows. Lab 4 needs to show them aging out. |
| Memories shown for a thread | Memories with that `THREAD_ID`, plus that user's memories with `THREAD_ID IS NULL`, each marked "thread" or "user" | Phase 0 showed extraction always sets `THREAD_ID`, but `memory.add_memory(user_id=...)` can create user-level ones. Showing both makes the scoping finding visible. |
| Where memories sit in the conversation | Derived position: "after message N", where N is the last message with `CREATED_AT <=` the memory's `CREATED_AT` | Inline extraction writes memories after the batch's messages. It's cheap, it isn't the M3 scrubber, and it hints at it. Labelled "derived". |
| Distance / score | Not shown | Not persisted (phase 0 Q5). It arrives with the M3 wrapper. |
| Web stack | Next.js 16 App Router, React 19, MUI 9 with `@mui/material-nextjs`, `oracledb` 7 in thin mode, TypeScript | As the spec says. Thin mode means no Instant Client install. |

## Steps

### 1. Views (`infra/sql/`)
- `10_views.sql`, run as `aim_app`, all `CREATE OR REPLACE`:
  - `AIM_V_THREADS`: `thread_id, user_id, agent_id, created_at, message_count, memory_count, last_activity` (latest `CREATED_AT` across the thread's messages and memories), `metadata`.
  - `AIM_V_MESSAGES`: `message_id, thread_id, seq` (`ORDER_SEQ`), `role, content, created_at, expires_at, is_expired, metadata`.
  - `AIM_V_MEMORIES`: `memory_id, memory_type, content, thread_id, user_id, agent_id, created_at, logical_ts` (the string `TIMESTAMP`), `expires_at, is_expired, origin` (`extracted` when `METADATA` has `$agent_memory`, otherwise `explicit`), `extractor_scope, importance, entities` (JSON array), `extraction_id`.
  - `AIM_V_STORE_INFO`: one row pivoting `ORACLEAGENTMEMORY_SCHEMA_META` into `schema_version, vector_dim, indexing_mode, retention_config`. `aim_web` can't read the meta table directly.
- `20_web_grants.sql`: `GRANT SELECT` on the four views to `aim_web`. Nothing on base tables.
- `agent/scripts/apply_sql.py`: runs `infra/sql/*.sql` in order as `aim_app` and splits on `/` lines. It must run after the package has created its schema (smoke or seed does that), and it fails with a clear message if `MEMORY` doesn't exist yet.
- Rerun `dump_schema.py` so the snapshot lists the views.

### 2. Seed data (`agent/scripts/seed.py`, `agent/conversations/`)
- Add `support_02.yaml` (user `u_bob`, same agent, a different preference: phone only) and `onboarding_01.yaml` (Alice again, a second thread, about 10 turns, restates one earlier preference). That gives two users, a user with two threads, and a restated fact, which M4's scope lab needs anyway.
- `seed.py` loads every conversation YAML, one thread each, with `--reset` (`SchemaPolicy.RECREATE`, destructive and explicit). It prints the thread ids. `smoke.py` stays as the minimal proof.

### 3. Web app (`web/`)
- Scaffold with `create-next-app` (TypeScript, App Router, no Tailwind, `src/` dir), then add `@mui/material @mui/material-nextjs @emotion/react @emotion/styled oracledb`.
- `next.config.ts`: `serverExternalPackages: ["oracledb"]`.
- `web/.env.example`: `AIM_WEB_USER`, `AIM_WEB_PASSWORD`, `AIM_DB_DSN`, `AIM_SCHEMA=AIM_APP`. The real `web/.env.local` is already covered by `.env.*` in `.gitignore`.
- `src/lib/db.ts`: the single pool module. It caches `oracledb.createPool` on `globalThis` so dev hot reload doesn't leak pools, sets `fetchTypeHandler` to return CLOBs as strings, and uses `outFormat: OUT_FORMAT_OBJECT`. It exposes `query<T>(sql, binds)`. `import "server-only"`.
- `src/lib/queries.ts`: typed functions `listThreads()`, `getThread(id)`, `getMessages(id)`, `getThreadMemories(id, userId)`. Uses bind variables only, lowercase column aliases, and never names a base table.
- `src/app/layout.tsx`: `AppRouterCacheProvider` plus a `ThemeProvider` with light/dark `colorSchemes` and `CssBaseline`. The app bar reads "Agent memory inspector" and shows schema version and vector dimension from `AIM_V_STORE_INFO`.
- Pages (all server components, `export const dynamic = "force-dynamic"`; no API routes because nothing polls yet):
  - `/`: redirects to `/runs`.
  - `/runs`: an MUI table with columns thread (short id plus copy), user, agent, messages, memories, created, last activity. Newest first. Empty state tells you to run `seed.py`.
  - `/runs/[id]`: a header (user, agent, created, counts, store info). The left pane shows messages as role-styled bubbles with sequence numbers. The right pane shows memory cards: a type chip, scope chips (thread/user/agent ids, and "thread-scoped" vs "user-scoped"), an importance dot scale, entity chips, "extracted" or "explicit", created time, and "after message N (derived)". It also has a toggle for expired rows. `notFound()` handles a bad id.
- `src/app/runs/[id]/loading.tsx` and `error.tsx`. The error page names the likely cause: "DB unreachable? Is the container up? Did apply_sql run?"

### 4. Docs
- README: add the seed, apply_sql and `web` steps, and a screenshot of `/runs/[id]`.
- Friction log: anything the views had to work around (for example JSON path quoting for the `$agent_memory` key).

## Verification
1. `docker compose -f infra/docker-compose.yml up -d`, then `uv run python scripts/seed.py --reset`, then `uv run python scripts/apply_sql.py`. Expect three threads, two users, and memories in `AIM_V_MEMORIES` with `origin`, `importance` and `entities` populated.
2. Read-only is enforced: as `aim_web`, `select count(*) from aim_app.aim_v_memories` works, while `select * from aim_app.memory` fails with ORA-00942 and `delete from aim_app.aim_v_memories` fails with ORA-01031. Script this as `agent/scripts/check_web_grants.py`.
3. `cd web && npm run build` must be clean with no type errors, then `npm run dev`.
4. Browse `/runs` and each `/runs/[id]` with `/browse` (per global CLAUDE.md), checking desktop and mobile widths and both themes. Counts must match the SQL from step 1, the derived positions must make sense, and a bogus id must return a 404.
5. Schema drift guard: `apply_sql.py` fails loudly if a view compiles invalid (`USER_OBJECTS.STATUS = 'INVALID'`).

## Out of scope for milestone 2
Scrubber, run log, lifecycle strip, `/memories`, cost chart, triggering turns from the UI, hosting and short URL.

## Risks
- **CLOB/JSON handling in thin mode.** Expected to be fine with a fetch type handler. Verify in step 3 before building the UI.
- **MUI 9 with Next 16.** This is a recent pairing. If `@mui/material-nextjs` lags, pin to the last compatible pair and log it.
- **Nondeterministic seed.** The extracted memories vary between runs, so the UI must not assume particular content. Screenshots in the README are illustrative only.

## As built (deviations)
- **No `loading.tsx` on `/runs/[id]`.** Its Suspense boundary streamed a 200 before `notFound()` ran, so bogus ids returned 200. Reads take about 50 ms, so the skeleton wasn't worth losing the real 404.
- **Tooltips on chips live in a client `HintChip` component.** Passing a server-rendered `Chip` into MUI `Tooltip` (which clones its child) caused a hydration mismatch on `/runs`. Other hints use native `title`.
- **`seed.py` adds one exchange per `add_messages` call,** not the whole conversation. With one batch, every message and memory shared a timestamp and the derived positions were meaningless. Per-turn writes also exposed the stale-correction finding (see friction log, 03:05).
- **Denied DML is `ORA-41900` on 26ai,** not `ORA-01031`. `check_web_grants.py` accepts any `DatabaseError`.
- **`await connection()` in `query()`** instead of `dynamic = "force-dynamic"` (the Next 16 docs' recommendation). `next build` never touches the database.
