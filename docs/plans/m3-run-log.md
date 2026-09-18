# Milestone 3 plan: run log, wrapper, scrubber, lifecycle view

2026-09-18. Builds on milestone 2 (`e4ce3e0`), `docs/phase0-answers.md` and `docs/friction.md`.

## Goal

Record what happens on every turn, then show it. Per the spec, this is the spine: the scrubber and the lifecycle view depend on it, and so do M4 and M5.

Done means `run_conversation.py support_01.yaml` produces a run whose thread page has a working turn scrubber. As you step through, memories appear when created, light up when retrieved (with their distance), and gray out when revised or removed. `/runs/[id]/turn/[n]` shows that turn's stage events as a timed horizontal strip, with what each stage produced. The demo moment the spec asks for is watching a stale fact ("bucket in us-east-1") get created at one turn, survive a correction, and then get retrieved later. The M2 seed already reproduces that.

## Facts this plan rests on (checked 2026-09-18)

| fact | consequence |
|---|---|
| Package log records carry flags and counts but no ids or durations (phase 0) | Durations come from pairing `…started` / `…completed` records. Ids, order and distances come from the wrapper. |
| A `contextvars` value set before `add_messages` is visible in the records the package emits from its AnyIO worker thread (probe: 27 main-thread plus 28 worker records, all tagged) | The log handler attributes records to run and turn through a context var. It holds for inline extraction only; background mode is out of scope and noted. |
| No public API lists memories: only `search`, plus the private `_list_owned_thread_ids_for_actor` | The per-turn memory diff reads `AIM_V_MEMORIES` before and after each turn. That's read-only, through our own view. Friction log entry. |
| `update_memory` overwrites and there is no `UPDATED_AT` (phase 0 Q4) | The diff stores **before and after content**, which is the only record of a revision. |
| `OracleSearchResult.distance` exists but is never persisted | The wrapper records rank, id, type and distance for every search. |
| The package's `Llm.generate` returns `LlmResponse(text)` only, with no usage | The agent's chat call uses `litellm.completion` directly to get real `usage.input_tokens`. The package's own extraction token spend stays invisible (friction entry). A litellm success callback might recover it; that's a 30-minute spike in step 2, not a promise, because the package installs a "LiteLLM logging disable patch". |
| `litellm.acount_tokens` routes to Anthropic's count-tokens API | Flat-history token counts use the same tokenizer as the real call, as the spec requires. The method is written up in `docs/token-method.md`. |

## Decisions

| decision | choice | why |
|---|---|---|
| Run identity | `run_id = thread_id`. One scripted conversation is one run is one thread. | Keeps M2's `/runs/[id]` routes. Threads created outside the harness (for example `smoke.py`) show without run data, and the scrubber is hidden for them. |
| Who writes assistant replies | A real harness: retrieve, assemble prompt, call the model, `add_messages`. **`--replay` is the default:** it uses the scripted assistant line instead of calling the chat model, but still assembles and token-counts the prompt. `--live` calls the model. | Replay keeps seeds cheap and repeatable and makes M5's 80-turn cost runs affordable. Live exists for the demo. Extraction runs for real in both modes. |
| Prompt assembly | A system prompt, plus the top 5 memories from `memory.search(user_id, record_types=[memory, fact, preference, guideline])` (formatted with `formatted_content`), plus the last 6 messages, plus the user message. Not `get_context_card()`. | Search returns distances, which the card hides. The card also costs an extra LLM call per turn. Written up in `docs/token-method.md` so the flat vs scoped comparison is explicit. |
| Lifecycle stages | Map known logger and message pairs to `ingestion, extraction, consolidation, retrieval, summarization, revision, other`. Keep the raw logger, message and extras in `attrs` so remapping later needs no rerun. | The spec's enum, plus an honest `other`. |
| Stage mapping (initial) | retrieval: `memory.search` (wrapper) and the `DB store search` / `vector search path` spans outside extraction. consolidation: `past-memory lookup` inside extraction. extraction: `Memory extraction prompt flow` plus its LLM call. summarization: `context-summary update`, `_threadsummarizer`. ingestion: `Thread message append`, `DB store add`, chunking, document embedding. revision: wrapper `update_memory` / `delete_memory`, plus diff-detected updates and deletes. | Built from real phase 0 log lines. Unit-tested against a captured fixture. |
| Write path | Buffer events in memory during a turn and flush the events plus the turn snapshot in one transaction at turn end, on a separate pool connection. Any exception is logged to stderr and dropped. | "Never block the agent on a failed write." Buffering also keeps DB writes out of the timed spans. |
| Storage | Three tables owned by `aim_app`, with JSON columns for the flexible parts, and `AIM_V_*` views granted to `aim_web`. Nothing touches package tables. | As in the spec: all three layers live in Oracle, and the dashboard stays an observer. |

## Steps

### 1. Schema (`infra/sql/30_runlog.sql`, `40_runlog_views.sql`)
- `AIM_RUNS`: `run_id` (PK = thread_id), `conversation`, `mode` (`replay|live`), `user_id`, `agent_id`, `llm_model`, `embed_model`, `package_version`, `started_at`, `finished_at`, `turn_count`, `notes JSON`.
- `AIM_RUN_EVENTS`: `event_id` (identity PK), `run_id` (FK), `turn` (0 = setup), `seq`, `parent_seq`, `depth`, `stage` (CHECK in the 7 values), `name`, `source` (`wrapper|log`), `started_at TIMESTAMP(6) WITH TIME ZONE`, `duration_ms NUMBER`, `input_summary`, `output_summary VARCHAR2(4000)`, `memory_ids JSON`, `scope JSON`, `tokens JSON`, `attrs JSON`, `error VARCHAR2(4000)`. Index on `(run_id, turn, seq)`.
- `AIM_TURNS`: PK `(run_id, turn)`, `user_message`, `retrieved JSON` (`[{rank, memory_id, memory_type, distance}]`), `assembled_prompt CLOB`, `prompt_tokens`, `flat_history_tokens`, `token_method`, `reply CLOB`, `reply_source` (`scripted|model`), `usage JSON`, `memory_diff JSON` (`{created:[{id,type,content}], updated:[{id,before,after}], deleted:[{id,type,content}]}`), `started_at`, `duration_ms`.
- Views: `AIM_V_RUNS`, `AIM_V_RUN_EVENTS`, `AIM_V_TURNS`, plus `AIM_V_MEMORY_RETRIEVALS` (`JSON_TABLE` over `AIM_TURNS.retrieved`: run, turn, memory_id, rank, distance), which M4's retrieval counts need too. Grant SELECT on all to `aim_web`, and extend `check_web_grants.py`.
- `apply_sql.py` already runs every file in order. These tables survive `seed.py --reset` (they aren't package objects), so `--reset` must also truncate them. That's an explicit step in `seed.py`.

### 2. Instrumentation (`agent/memory_inspector/`)
- `runcontext.py`: a `ContextVar[RunContext | None]` holding `run_id`, `turn`, and an event buffer.
- `stages.py`: a pure function `(logger_name, message, extras) -> (stage, span_key, phase)`, where phase is start, end or point. Fixture: `tests/fixtures/add_messages_log.jsonl` captured from a real turn.
- `log_capture.py`: a `logging.Handler` on `oracleagentmemory`. It reads the context var, pairs start/end records per `span_key` using a stack (so it handles nesting), and produces events with `started_at`, `duration_ms`, `depth` and `attrs`. Records outside a run are ignored. Unmatched starts are closed at turn end with `attrs.unclosed = true`.
- `wrapper.py`: `InstrumentedMemory` wraps `OracleAgentMemory` and the `OracleThread`s it returns. It records `create_thread`, `add_messages`, `add_memory`, `search`, `update_memory`, `delete_memory` and `delete_thread`, each with method, argument summary, result ids in order, distances and elapsed time. It **observes only**. Anything it has to compute (the memory diff) is flagged in `attrs.computed = true` and gets a friction log entry.
- `runlog.py`: `RunLogWriter` with `start_run`, `flush_turn(turn_snapshot, events)` and `finish_run`. Each is one transaction, with try/except that logs and continues.
- `agent.py`: `run_turn(user_msg, scripted_reply | None)`:
  1. Snapshot memories.
  2. Search.
  3. Assemble the prompt.
  4. Count tokens for the scoped prompt and for the flat history.
  5. Get the reply: scripted, or `litellm.completion`.
  6. `thread.add_messages([user, assistant])`.
  7. Snapshot memories again and diff.
  8. Flush.
- Spike (time-boxed to 30 min): register a litellm success callback to see whether the package's internal extraction and summary LLM calls report usage. If yes, attach tokens to the extraction and summarization events. If no, log the friction and move on.

### 3. Scripts
- `scripts/run_conversation.py <yaml> [--live] [--user-id ...]`: one run. It prints the run id and a per-turn table (retrieved count, prompt tokens vs flat, created/updated/deleted).
- `seed.py` becomes "for each YAML, `run_conversation` in replay mode". `--reset` also truncates the run log tables.
- `docs/token-method.md`: what "scoped" and "flat" include, which API counts them, and that the report's figures are cited separately (M5).

### 4. Dashboard
- `queries.ts`: `getRun`, `getTurns`, `getTurnEvents(run, n)`, and `getMemoryStateAt(run, n)`. The last one is computed in TypeScript from `memory_diff` of turns 1..n, not from current table state, so revised or deleted content still shows.
- **Scrubber** on `/runs/[id]`, shown only when a run exists:
  - A client `TurnScrubber` (MUI `Slider` plus step buttons and ←/→ keys) writes `?turn=n` with `router.replace(..., { scroll: false })`. The page stays a server component, and a URL like `?turn=4` is shareable.
  - At turn n, the conversation shows messages up to 2n, with later ones dimmed and collapsed.
  - Memory cards are in one of four states: **new this turn** (outlined in the type color, "created turn n"), **retrieved this turn** (highlighted, "#rank · distance 0.27"), **revised** (grayed, before and after content, "revised turn k"), and **removed** (grayed, struck through). Cards not yet created are hidden.
  - A header strip shows prompt tokens vs flat-history tokens for turn n, and links to "lifecycle for turn n →".
  - Default with no `?turn`: the last turn, which is the M2 view plus retrieval stats.
- **Lifecycle view** `/runs/[id]/turn/[n]`:
  - A server-rendered horizontal strip with one lane per stage. Bars are positioned by offset from the turn's start and sized by `duration_ms`. Depth 0 and 1 are shown; deeper spans appear on hover through `title`. Bars use stage colors from a shared `stageColors.ts`.
  - Below it, a card per stage: what it produced (retrieval gives ids plus distances, extraction gives the memory diff, summarization and ingestion give record counts from extras), plus total and share-of-turn time.
  - Prev and next turn links, and back to the thread at `?turn=n`.
  - A real 404 for a bad run or turn (no `loading.tsx`, per the M2 lesson).
- Keep "Show expired rows" working in the scrubber.

### 5. Tests
- `agent/tests/` with pytest (dev dependency):
  - Stage mapping over the captured fixture.
  - Span pairing, including nesting and unclosed starts.
  - `diff_memories` (created, updated, deleted, and unchanged-but-reordered).
  - Token-method assembly (flat history grows by exactly one exchange per turn).
- Web: `getMemoryStateAt` as a pure function, tested with `node --test` against a JSON fixture. No framework added.

### 6. Docs
- Friction log: no list-memories API; extraction token spend is invisible (or recoverable via callback, per the spike); anything else the wrapper had to compute.
- README: `run_conversation.py`, the scrubber screenshot, and the lifecycle screenshot.

## Verification
1. `uv run pytest` passes.
2. `seed.py --reset`, then `apply_sql.py`, then `check_web_grants.py`: 3 runs, one `AIM_TURNS` row per exchange, events on every turn, and every event's stage within the enum. Also check SQL: `select stage, count(*) from aim_v_run_events group by stage`. `other` should be a small minority; if not, fix the mapping.
3. Reproduce the stale fact: on the `support_01` run, the scrubber shows "us-east-1" created at turn 2, still present at turn 3, and retrieved at some later turn if the query surfaces it. Screenshot it for the README.
4. Failure isolation: set `AIM_RUNLOG_FAIL=1` (a test hook that makes `flush_turn` raise). The conversation must complete, stderr must show the dropped writes, and the thread must still exist with its memories.
5. `/browse` (as in M2): the scrubber at desktop and 375px with keyboard stepping and no hydration issues; the lifecycle strip for each turn of one run; bad turn and bad run ids return 404; light and dark.
6. `npm run lint`, `tsc`, `npm run build`: all clean.
7. One `--live` run of `support_01` to confirm the model path and real `usage` land in `AIM_TURNS`.

## Out of scope
The `/memories` table (M4), the cost chart (M5), the UI control to trigger a turn, background extraction mode, hosting, and `get_context_card` prompt assembly (possible lab 3 comparison).

## Risks
- **Log-message stage mapping is brittle across package versions.** Mitigations: raw records are kept in `attrs`, the fixture test pins behavior, and `dump_schema.py` is rerun on bumps. Unknown records land in `other`, never dropped.
- **The diff reads package state through our view.** That's acceptable because it's read-only, but it is computing something the API should return. It's flagged as friction, not hidden.
- **Replay mode's scripted replies ignore retrieval,** so reply quality isn't the point there. It's labelled `reply_source = scripted` everywhere it's shown.
- **Extraction nondeterminism:** the stale-fact reproduction may not recur on every seed. If it doesn't, add a conversation (`correction_01.yaml`) built to force it rather than relying on luck.
