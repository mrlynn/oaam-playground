# Milestone 3 plan: run log, wrapper library, companion agent, scrubber, "why" panel

2026-09-18, revised the same day. Builds on milestone 2 (`e4ce3e0`), `docs/phase0-answers.md` and `docs/friction.md`.

## Why this changed

The first version of this plan instrumented a scripted harness and showed the result to people who teach and sell memory. The revision aims at a different moment: a developer points the inspector at **their own agent** and it explains something they couldn't see, such as why the agent said the wrong thing or that it believes two contradictory facts. The friction log already shows these failures happen on day one (stale corrections, thread-scoped preferences, transient junk). Three things follow:

1. The instrumentation ships as an **installable library** with a one-line integration. The demo code is its first consumer and uses only its public API.
2. A **real, small agent** (the companion, below) replaces the scripted harness and gets used daily. Scripted conversations become input to that same agent.
3. The dashboard ships the **scrubber plus a "why" panel**. The lifecycle strip moves to M4. Its stage events are still captured here, so M4 builds it on real data.

## Goal

Done means:
- The stale fact reproduces through the companion's scripted replay. On the `support_01` run, the scrubber shows "us-east-1" created, surviving the correction, and retrieved later (or `correction_01.yaml` forces it).
- Several days of real companion sessions show up in `/runs`, attributed turn by turn.
- The "why" panel has been used at least once to explain a real miss. That becomes the first screenshot (redacted, see Privacy).
- The companion's inspector integration is 10 lines or fewer.

## Facts this plan rests on (checked 2026-09-18)

| fact | consequence |
|---|---|
| Package log records carry flags and counts but no ids or durations (phase 0) | Durations come from pairing `…started` / `…completed` records. Ids, order and distances come from the wrapper. |
| A `contextvars` value set before `add_messages` is visible in records emitted from the package's AnyIO worker thread (probe: 27 main-thread plus 28 worker records, all tagged) | The log handler attributes records through a context var. It holds for **inline** extraction only. Background mode gets "unattributed" events and a friction entry. |
| No public API lists memories: only `search`, plus the private `_list_owned_thread_ids_for_actor` | The per-turn diff reads `AIM_V_MEMORIES` before and after `add_messages`, scoped to the turn's user (and agent, if set). Friction entry. |
| `update_memory` overwrites and there is no `UPDATED_AT` (phase 0 Q4) | The diff stores before and after content. It's the only record of a revision. |
| `OracleSearchResult.distance` exists but is never persisted | The wrapper records rank, id, record type and distance for every search. |
| `search` takes scope ids, not a thread handle | A search can't be tied to a thread when it happens. Turn inference (below) attaches pending searches to the next `add_messages`. |
| The package's `Llm.generate` returns `LlmResponse(text)` only, with no usage | The companion calls `litellm.completion` directly for real usage. The package's own extraction spend stays invisible unless the step 2 spike finds a way to recover it. |
| `litellm.acount_tokens` routes to Anthropic's count-tokens API | Flat-history counts use the same tokenizer as the real call, written up in `docs/token-method.md`. |
| Inline `add_messages` takes 10–12 s per exchange | Fine for seeding. In a chat agent it's a pause on every turn. The companion prints the reply first and then shows "remembering…". Friction entry, since this is what a real user feels. |
| `seed.py --reset` runs `SchemaPolicy.RECREATE` on `aim_app` | Real companion data **must not** live in `aim_app`, or one reset wipes a week of use. See the next table. |

## Decisions

| decision | choice | why |
|---|---|---|
| Library boundary | New top-level Python project `inspector/` (distribution `memory-inspector`, import `memory_inspector`). It takes a caller's pool and memory client and loads no `.env`. It holds the wrapper, run context, stage mapping, log capture, diff, run log writer, and its own SQL. | The "use it with another project" claim has to be true from the first commit. Moving code out after M4 is painful. |
| What happens to `agent/memory_inspector/` | Renamed to `agent/aim_demo/` (demo env config, pool, client factory). Scripts update their imports. | It's demo configuration, not the library, and keeping the name would shadow the real package. |
| Integration API | `memory = inspect(OracleAgentMemory(...), pool=pool)` returns a drop-in wrapper. Optional: `memory.inspector.record_prompt(prompt, reply, usage, memory_ids_used=None)` and `with memory.inspector.turn(thread):`. | One line gets you everything the package itself does. The hook is only for people who want prompt and cost data. |
| Turn boundaries | **Inferred by default:** wrapped calls open a turn. `add_messages` on a thread closes it and gives it that thread id. Searches made while the turn is open belong to it. **Explicit** `turn()` overrides the inference. Turn numbers come from the database (`max(turn)+1` per thread), so they carry on across processes and days. | A real agent has no script loop. It calls `search`, then later `add_messages`, and it restarts. |
| Run identity | `run_id = thread_id`, kept from M2. `AIM_RUNS` is per thread: first and last turn time, `source` (`instrumented`, `replay` or `live`), models, package version. | Keeps `/runs/[id]`. Threads without run data still render, just without the scrubber. |
| Where real data lives | A second package schema, **`aim_live`**, with the same grants as `aim_app`. The companion's daily use writes there, and the scripted seeds stay in `aim_app`. The dashboard picks a schema with `AIM_SCHEMA`, which already exists. `seed.py --reset` refuses to run against anything but `aim_app`. | Protects the real data from resets, and keeps private conversations out of the demo dataset. |
| Retrieved vs used | The panel says "returned by search" unless `record_prompt` supplied `memory_ids_used`, in which case it marks "in prompt". Results that ranked lower are shown as "also returned". | We see what search returned, not what the agent did with it. The UI must not claim more. |
| Lifecycle stages | As before: map known logger and message pairs to `ingestion, extraction, consolidation, retrieval, summarization, revision, other`, keeping raw records in `attrs`. Captured in M3, **displayed in M4**. | A week of real events for M4 to build on. The mapping details are in the step 2 fixture. |
| Write path | Buffer per turn, flush events plus the turn row in one transaction when the turn closes, on a separate pool connection. Log exceptions to stderr and drop them. | "Never block the agent on a failed write." |

## The companion agent

A terminal chat agent for talking through your actual work: projects, decisions, people, preferences, changes of plan. It's small on purpose. Its job is to generate honest memory behavior, not to be a product. **Working name `companion`; pick a real one before step 3.**

- **Location:** top-level `companion/`, its own uv project, depending on `inspector/` by path. It builds its own pool and memory client (roughly 20 lines duplicated from `aim_demo`, on purpose: it's the "other project").
- **Interface:** `uv run companion` opens a REPL. `/new` starts a new thread (one thread per session is the default), `/why` prints last turn's retrievals in the terminal, and `/quit` exits. One `user_id` for you, one `agent_id`.
- **Each turn:**
  1. `search(user_id, record_types=[memory, fact, preference, guideline])`
  2. Assemble the prompt: system prompt, the top 5 memories (`formatted_content`), the last 6 messages, the user message.
  3. Call `litellm.completion` (the model is set by `AIM_LLM_MODEL`).
  4. Print the reply.
  5. `record_prompt(...)` with prompt, reply, usage and the 5 ids used, plus the flat-history token count over the thread's messages.
  6. `add_messages([user, assistant])` while showing "remembering…".
- **Script mode:** `companion --script conversations/support_01.yaml [--replay|--live] --user-id u_alice` runs a YAML conversation through the same loop. Replay uses the scripted assistant line instead of the model, but still searches, assembles and counts. `agent/scripts/seed.py` becomes a loop over this, run against `aim_app`. Conversations move to `companion/conversations/`.
- **Cost:** about 3 LLM calls per turn. Put a spend cap on the key.

## Steps

The order is chosen so daily use starts as soon as possible and the dashboard is built while data accumulates.

### 1. Library skeleton and run log schema (`inspector/`)
- `pyproject.toml` (Python ≥3.10, depends on `oracleagentmemory==26.6.0`, `oracledb`), `src/memory_inspector/`, `tests/`.
- `sql/30_runlog.sql`:
  - `AIM_RUNS`: `run_id` (PK = thread_id), `source`, `user_id`, `agent_id`, `llm_model`, `embed_model`, `package_version`, `first_turn_at`, `last_turn_at`, `turn_count`, `notes JSON`.
  - `AIM_RUN_EVENTS`: `event_id` (identity PK), `run_id` (nullable, for unattributed events), `turn`, `seq`, `parent_seq`, `depth`, `stage` (CHECK on the 7 values), `name`, `source` (`wrapper|log`), `started_at TIMESTAMP(6) WITH TIME ZONE`, `duration_ms`, `input_summary`, `output_summary VARCHAR2(4000)`, `memory_ids JSON`, `scope JSON`, `tokens JSON`, `attrs JSON`, `error VARCHAR2(4000)`. Index on `(run_id, turn, seq)`.
  - `AIM_TURNS`: PK `(run_id, turn)`, `user_message`, `retrieved JSON` (`[{rank, record_id, record_type, distance, in_prompt}]`), `message_ids JSON`, `memory_diff JSON` (`{created:[{id,type,content}], updated:[{id,before,after}], deleted:[{id,type,content}]}`), `started_at`, `duration_ms`. Nullable, from `record_prompt` only: `assembled_prompt CLOB`, `prompt_tokens`, `flat_history_tokens`, `token_method`, `reply CLOB`, `reply_source`, `usage JSON`.
- `sql/40_runlog_views.sql`: `AIM_V_RUNS`, `AIM_V_RUN_EVENTS`, `AIM_V_TURNS`, `AIM_V_MEMORY_RETRIEVALS` (`JSON_TABLE` over `retrieved`).
- CLI: `memory-inspector init --grant-to aim_web` applies the package's SQL in the connected schema and grants SELECT on the views. It's idempotent.
- Infra: add `aim_live` to `infra/init/01_users.sh` for fresh volumes, plus `infra/sql/admin/02_live_user.sql` for the existing container. `apply_sql.py` takes `--user aim_app|aim_live` so the M2 views exist in both schemas. Extend `check_web_grants.py` to cover both schemas and the new views.
- Rename `agent/memory_inspector/` to `agent/aim_demo/` and fix imports. `agent/` depends on `inspector/` by path.

### 2. Instrumentation (`inspector/src/memory_inspector/`)
- `runcontext.py`: a `ContextVar` holding the open turn (run id once known, turn number, event buffer, pending retrievals).
- `stages.py`: pure `(logger_name, message, extras) -> (stage, span_key, phase)`. Fixture `tests/fixtures/add_messages_log.jsonl` captured from a real turn.
- `log_capture.py`: a handler on `oracleagentmemory` that pairs spans with a stack and attaches events to the open turn. Records with no open turn are written as unattributed events rather than dropped. Unmatched starts close at turn end with `attrs.unclosed = true`.
- `turns.py`: turn inference and the explicit `turn()` context manager. Numbering is read from `AIM_TURNS` when the turn closes.
- `wrapper.py`: `inspect()` returns a wrapper around `OracleAgentMemory` and the `OracleThread`s it hands out. It records `create_thread`, `add_messages`, `add_memory`, `search`, `update_memory`, `delete_memory` and `delete_thread`: method, argument summary, result ids in order, distances, elapsed time. **It only observes.** Anything computed (the diff, and `message_ids` if `add_messages` doesn't return them) carries `attrs.computed = true` and gets a friction entry.
- `diff.py`: snapshot `AIM_V_MEMORIES` for the turn's user (and agent) immediately before and after `add_messages`, then diff. Memories that existed before instrumentation began are marked "pre-existing".
- `runlog.py`: `RunLogWriter`: upsert the run and flush the turn, each in one transaction, and it never raises.
- Spike, 30 minutes: can a litellm success callback see the package's internal extraction and summary calls? If yes, attach tokens to those events. If no, log it and move on.

### 3. The companion (`companion/`)
- REPL, script mode and turn loop as specified above, pointed at `aim_live` by default and at `aim_app` in script mode.
- `seed.py` becomes: optionally reset `aim_app` (refused for any other user), then run each YAML through `companion --script --replay`. The run log tables are truncated on reset, since they aren't package objects.
- `docs/token-method.md`: what "scoped" and "flat" include, which API counts them, and that the report's figures are cited separately (M5).

### 4. Start daily use
- Run `memory-inspector init` on `aim_live` and use the companion for real work every day from here on. Note surprises in the friction log as they happen, especially misses you notice while talking to it.
- Check the data every couple of days with SQL, before the dashboard exists: turns per thread, `stage` distribution, the count of unattributed events.

### 5. Dashboard: scrubber and "why" panel (`web/`)
- `queries.ts`: `getRun`, `getTurns`, `getTurnRetrievals(run, n)`, and `getMemoryStateAt(run, n)`. The last one is computed in TypeScript from `memory_diff` over turns 1..n, so revised and deleted content still shows.
- **Scrubber** on `/runs/[id]`, only when a run exists, as in the first plan:
  - A client `TurnScrubber` (MUI `Slider`, step buttons, ←/→ keys) writing `?turn=n` with `router.replace(..., { scroll: false })`.
  - Messages after turn n are dimmed and collapsed.
  - Memory cards are in one of four states: new this turn, retrieved this turn (rank and distance), revised (before and after), removed (struck through). Cards not yet created are hidden.
  - A header shows prompt vs flat-history tokens for the turn when `record_prompt` supplied them.
  - With no `?turn`, it shows the last turn.
- **"Why" panel:**
  - Clicking an assistant message sets `?turn=k&why`, and the right pane switches to that turn's retrievals, ordered by rank.
  - Each row shows record type, distance, the "in prompt" / "returned by search" / "also returned" label, and "created turn j", which links to `?turn=j` so you can jump to where the memory came from.
  - Revised memories show the content as it was at turn k, not the current content.
  - Raw message chunks returned by search are shown and labelled as messages. That's the mixed-search finding.
- Memories from other threads for the same user link to that thread's run at the turn they were created.
- The M2 lesson still applies: no `loading.tsx`, so a bad run id returns a real 404.

### 6. Tests and docs
- `inspector/tests/` with pytest:
  - stage mapping over the fixture
  - span pairing, including nesting and unclosed starts
  - turn inference (search then `add_messages` is one turn; two searches are one turn; `add_messages` alone is a turn with no retrievals; explicit `turn()` overrides; numbering resumes from existing rows)
  - `diff_memories` (created, updated, deleted, unchanged but reordered, pre-existing)
  - writer failure isolation
- `companion/tests/`: prompt assembly, and that flat history grows by exactly one exchange per turn.
- Web: `getMemoryStateAt` as a pure function under `node --test`.
- README: the one-line integration, the companion, the schema split, and screenshots of the scrubber and the "why" panel.
- `inspector/README.md`: install, `init`, `inspect()`, the optional hook, and the limits (inline only, single process).

## Verification
1. `uv run pytest` passes in `inspector/` and `companion/`.
2. `seed.py --reset`, then `apply_sql.py --user aim_app`, then `memory-inspector init`, then `check_web_grants.py`: 3 runs, one `AIM_TURNS` row per exchange, and events on every turn. `select stage, count(*) from aim_v_run_events group by stage` has `other` as a small minority.
3. `seed.py --reset` pointed at `aim_live` refuses and changes nothing.
4. Stale fact: the scrubber on the `support_01` run shows it created, surviving the correction, and retrieved later. Otherwise add `correction_01.yaml`.
5. Failure isolation: `AIM_RUNLOG_FAIL=1` makes `flush_turn` raise. The conversation completes, stderr shows the dropped writes, and the thread and memories still exist.
6. Resumption: quit the companion mid-thread, restart it, `/new`, and continue the old thread later. Turn numbers carry on with no gaps and no duplicates.
7. Integration size: count the inspector-specific lines in `companion/`. There should be 10 or fewer.
8. `/browse`: scrubber and "why" panel at desktop and 375 px, keyboard stepping, no hydration warnings, `created turn j` links landing on the right turn, bad ids returning 404, light and dark, for both `AIM_SCHEMA=AIM_APP` and `AIM_SCHEMA=AIM_LIVE`.
9. `npm run lint`, `tsc`, `npm run build` are all clean.
10. One `--live` script run confirms the model path and that real `usage` lands in `AIM_TURNS`.

## Privacy
`aim_live` holds real work conversations, and they go to Anthropic for extraction and replies. Nothing from `aim_live` goes into the README, a hosted demo, or a message to Richmond or Anant without a redaction pass. The public demo stays on `aim_app` seeds. `docker compose down -v` destroys both schemas, so don't run it once daily use starts. A backup script is M4 material if the data turns out to be worth keeping.

## Out of scope
- The lifecycle strip `/runs/[id]/turn/[n]` (M4, on captured events).
- The health report and `AIM_FINDINGS` (M4).
- `/memories` (M4).
- The cost chart (M5).
- Triggering turns from the UI, background extraction mode, multi-process writers, hosting, and `get_context_card` prompt assembly.

## Risks
- **Turn inference guesses wrong** when an agent searches without writing, or writes to several threads per turn. Mitigations: explicit `turn()`, and a `closed_by` value in `attrs` on every turn so bad inferences can be found. Tests cover the known shapes.
- **Stage mapping is brittle across package versions.** Raw records are kept, the fixture pins behavior, and unknown records land in `other`.
- **The diff reads package state through our view.** It's read-only, but it computes something the API should return, and it's flagged as friction. Scoping the snapshot to one user keeps it cheap on real data.
- **Two schemas mean two sets of views and grants,** and forgetting one breaks the dashboard for that schema. `check_web_grants.py` covers both.
- **The companion becomes the project.** Keep it to a REPL with a turn loop. Tools, a UI and integrations are out.
- **Extraction nondeterminism.** The stale fact may not recur on every seed, so `correction_01.yaml` forces it. Real data will have its own.

## As built

### Step 1 (library skeleton and run log schema)
- **`AIM_TURNS` gained `attrs JSON`.** The Risks section puts `closed_by` in turn attrs, but the table in step 1 had no column for it.
- **`apply_sql.py` also installs the run log** through the library's public `install()`, so the demo sets up with one command and uses the same code path as `memory-inspector init`. The CLI is still the documented route for other projects.
- **`apply_sql.py --create-store`** creates the package schema in a new schema (as `aim_live` needed) by building the client with `CREATE_IF_NECESSARY`. This makes one embedding call.
- **`aim_live` is created by `infra/init/02_live_user.sh`**, which runs on fresh volumes and by hand (`docker exec`) on existing containers, instead of a SQL file under `infra/sql/admin/`. Its password is `AIM_LIVE_PASSWORD` in `infra/.env`.
- **`aim_demo.load_settings(user)`** reads `<USER>_PASSWORD`, so every script can target either schema.
- **CLI passwords come from `MEMORY_INSPECTOR_DB_PASSWORD` or a prompt**, never an argument. `--grant-to` is validated as an Oracle identifier before being put into a GRANT.
- **The library pins `oracleagentmemory>=26.6.0,<26.7`**, not `==`, because stage mapping depends on the log messages of that minor version. The demo still pins `==26.6.0`.

### Step 2 (instrumentation)
- **Checked against the real API first.** `add_messages` returns message ids, so `message_ids` is observed, not computed. `OracleThread` has its own `search`, `add_memory`, `update_memory`, `delete_memory` and `get_context_card`, all wrapped. Search results carry `record.record_type` and `record.thread_id`.
- **Modules:** `stages.py` (message parsing plus rule table), `spans.py` (pairing, nesting, points folded into the enclosing span's `attrs.points`), `diff.py`, `runlog.py`, `inspector.py` (turns, log capture), `wrapper.py`. The plan's separate `runcontext.py` and `turns.py` live in `inspector.py`.
- **The diff reads the package's `MEMORY` table, not `AIM_V_MEMORIES`.** That view belongs to the demo (`infra/sql`), and the library can't assume it exists. The table name comes from the client's private `_store._memory_table` (friction 03:45), with an override argument.
- **Stage mapping** is 27 rules built from the captured fixture `inspector/tests/fixtures/turn_log.jsonl`. Generic operations (search, embedding, LLM calls) inherit the stage of the span they run inside, so the past-memory lookup's search is consolidation. `CLOSES_WITH` handles the context-summary span that never logs its end (friction 03:40). Closing a span also closes anything still open inside it.
- **Turn close points:** `add_messages`, `delete_thread`, explicit `turn()` exit, and `close()`. `delete_thread` looks up the thread's owner *before* deleting, so its turn's diff lists everything the delete removed.
- **Logging:** one shared handler on `oracleagentmemory` sets the logger to DEBUG, stops propagation, and re-dispatches records at or above the previously effective level to the root logger, so the host app's log output doesn't change. `close()` restores the logger.
- **`AIM_V_MEMORY_RETRIEVALS` gained `search_no` and `thread_id`.** A turn can run several searches, and a result's thread shows whether it came from an earlier conversation.
- **The failure hook is `MEMORY_INSPECTOR_FAIL_WRITES=1`**, not `AIM_RUNLOG_FAIL`, because it belongs to the library.
- **Not instrumented:** the `*_async` methods (they pass through, with a one-time warning), `delete_user`, `delete_agent` and `update_thread` (they pass through silently). The "forget a user" story in M6 will need `delete_user`.
- **Spike result:** LiteLLM callbacks can't see the package's LLM calls (friction 03:50). The `tokens` column stays empty for package spans.
- **`agent/scripts/probe_inspector.py`** is the end-to-end check: two real turns, a correction and a thread delete on a throwaway user, then assertions on turn numbering, unmapped events and the delete diff. With `MEMORY_INSPECTOR_FAIL_WRITES=1` it confirms the agent finishes with nothing written. Rerun it after any package bump.
