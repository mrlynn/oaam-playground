# Milestone 4 plan: memory health, lifecycle view, labs 1–3

2026-09-18. Builds on milestone 3 (`70ca8ed`), `docs/friction.md` and the M3 as-built notes.

## Why this milestone

M3 made memory problems visible one turn at a time: you open a conversation, step to the bad reply, and "why" shows the cause. M4 finds them **without anyone looking**. Every failure the dashboard has shown so far can be detected from the store itself:
- stale corrections still retrievable (friction 03:05)
- conversation state saved as durable memory (03:05)
- duplicates crowding a real preference out of the prompt (04:25)
- memories labelled user-scoped that die with their thread (02:45)

The health report turns the friction log into something anyone can run against their own agent: `memory-inspector check`, then a list of findings, each with evidence and a fix.

M4 also brings the two items M3 deferred: the lifecycle strip (its events have been captured since M3 step 2), and labs 1–3, rebuilt around the loop *find → fix → rerun → finding resolved*.

## Goal

Done means:
- `memory-inspector check` against the seeded `aim_app` reports:
  - the us-east-1 / us-west-2 pair as **superseded**
  - the analyst-account facts and the contact preferences as **duplicates**
  - the "awaiting response" memories as **transient**
  - at least one recorded turn as **crowded** (prompt slots spent on duplicates or stale facts), linked to its "why" view
- `/memories` shows those findings with their evidence and a suggested fix, and marks which are new or resolved since the previous check.
- In the "why" view, a result that belongs to a finding carries a badge, for example "stale: superseded at turn 3".
- `/runs/[id]/turn/[n]` draws the lifecycle strip for any recorded turn.
- Labs 1–3 run top to bottom from a seeded state. Lab 2 or 3 demonstrates a fix that makes a finding disappear on the next check.
- The same check has been run against `aim_live` once real data exists, and any threshold changes that required are written down.

## Facts this plan rests on (checked 2026-09-18)

| fact | consequence |
|---|---|
| Every memory is exactly one row in `RECORD_CHUNKS` (34 of 34 on the seeds), with `SOURCE_RECORD_TYPE` = the memory type | Candidate pairs can be found in SQL: a self-join on `RECORD_CHUNKS` with `VECTOR_DISTANCE(a.embedding, b.embedding, COSINE)`, same user, memory types only. That runs inside Oracle, which is the "memory belongs in the database" argument made concrete. |
| On the seeds, 11 memory pairs are under 0.15 cosine distance. They include a contradiction (0.042), a paraphrase (0.045), a cross-type duplicate (0.059), a complementary fact/guideline pair (0.070) and transient-vs-fact (0.093) | **Distance finds candidates; it can't classify them.** A contradiction sits closer than a legitimate pair. Classification needs a judge (an LLM), and its verdicts must be labelled as judgments, not facts. |
| One exact duplicate (distance 0) exists across threads: the explicit "Team plan" fact written by both `support_01` and `smoke.py` | Nothing dedups across threads, so `add_memory` twice gives two rows. That's a real finding, with seeds that reproduce it. |
| Superseding memories often say so ("corrected from an earlier stated us-east-1") | A cheap deterministic signal. Correction language plus a close, older neighbour means "likely superseded" before any judge runs. |
| We compute COSINE ourselves, and spike 0.1 confirmed that `search`'s `distance` is the same COSINE | One scale for candidate pairs and search results; the UI can say "cosine". |
| `aim_web` can't read `RECORD_CHUNKS` or `MEMORY` | Checks run on the Python side as the schema owner and write `AIM_FINDINGS`. The dashboard reads findings through views, as it does everything else. |
| The run log already has everything "crowded turn" needs: per-turn `retrieved` with `in_prompt` | A crowded turn is one where two or more in-prompt results belong to the same duplicate or superseded pair. No new instrumentation is needed. |
| The 04:25 crowding happened in a live REPL turn that the reset has since wiped | The seeds need a scripted turn that reproduces it. `companion/conversations/support_03.yaml` asks Alice's mixed question after `support_01` and `onboarding_01`. |
| LLM verdicts vary from run to run | The labs' "fix and watch it disappear" loop needs stable verdicts. Judgments are cached by (model, prompt version, content hash), so reruns reuse them and only changed memories are judged again. |

## Spike results (step 0, 2026-09-18)

| spike | result | what changes |
|---|---|---|
| 0.1 search metric (`agent/spikes/search_metric.py`) | `search`'s `distance` is **exactly** `VECTOR_DISTANCE(..., COSINE)`. Embeddings are normalized FLOAT64; a FLOAT32 bind fails with ORA-51812. | The UI can say "cosine distance". Candidate pairs from SQL and search distances share one scale. Query vectors must be bound as FLOAT64. |
| 0.2 custom instructions (`agent/spikes/custom_instructions.py`) | Transient memories: 4 → **0** in every trial. Stale corrections: kept in **3 of 3** trials; extraction only appends. Wording that says to drop the earlier value strips the "(corrected from…)" signal. | **Lab 2** teaches the transient fix with the tested string (in the spike script). **Lab 3** teaches supersession cleanup by hand (`delete_memory` on the id the finding names). The instruction must keep "(corrects X)". The append-only behaviour is the headline of the friction summary. |
| 0.3 judge agreement (`agent/spikes/judge_agreement.py`, fixture `inspector/tests/fixtures/judge_pairs.json`) | Sonnet 5: **10/11**, contradiction and complementary pair both right. Haiku 4.5: 9/11, and it calls the complementary cause/fix pair a duplicate. Both read one pending-question pair as "supersedes", which is low harm because it flags a transient memory. About 5k tokens for 11 pairs. | **Judge defaults to `AIM_LLM_MODEL`**, not Haiku: Haiku's miss would tell users to delete a legitimate guideline. `max_tokens=1000`, no `temperature` (Sonnet 5 rejects 0), a reply without JSON becomes an `unparsed` verdict, and verdicts are cached for stability. |

Open question 1 (judge model) is answered by 0.3. Question 2 (timing): building now on seeds, validating on `aim_live` at the end.

## Decisions

| decision | choice | why |
|---|---|---|
| Where checks live | In the library: `memory_inspector.health`, run by `memory-inspector check`. The judge is an optional extra (`memory-inspector[judge]`, LiteLLM). | Another project gets the health report with the wrapper. Without a judge, deterministic findings still work, and candidate pairs are reported as "unclassified near-duplicates". |
| Which checks | **Core:** `superseded`, `duplicate`, `transient`, `crowded_turn`, `scope_mismatch`, `orphan_chunks`. **If time allows:** `never_retrieved`, `messages_in_results`. | The core six cover every finding in the friction log. The other two are cheap SQL, but need care with caveats (instrumented turns only). |
| Severity | `high`: superseded, crowded_turn, orphan_chunks. `medium`: duplicate, transient. `low`: scope_mismatch (one finding per user with a count, not one per memory), plus the optional two. | A stale fact that gets into the prompt changes answers. A duplicate only wastes a slot until it crowds something out, and then it shows up as crowded_turn anyway. |
| Thresholds | Candidate pairs under **0.15** cosine. `transient` needs the judge, with a regex pre-filter ("awaiting", "asked the user", "has not yet confirmed"). All thresholds are recorded in each check run's `params`. | Tuned on 34 seed memories, so they are provisional. They're re-checked against `aim_live` before M4 is called done. |
| Finding identity | `fingerprint` = sha256 of kind + sorted memory ids (+ run/turn for crowded_turn). Two check runs are compared by fingerprint, giving new, still open, and resolved. | Needed for the labs' loop and for "resolved since last check" in the dashboard. |
| Judge | Default model `AIM_LLM_MODEL`, overridable with `--judge-model`. JSON output with a versioned prompt (`JUDGE_VERSION`). Pair verdicts: `duplicate`, `supersedes` (with direction), `contradicts` (neither says which is current), `complementary`, `unrelated`. Memory verdicts: `durable`, `transient`. Each comes with a one-sentence rationale. | The rationale is what the dashboard shows as evidence. `complementary` exists so the 0.070 cause/fix pair isn't flagged. |
| Storage | `AIM_CHECK_RUNS`, `AIM_FINDINGS`, `AIM_JUDGMENTS` (the cache) in the same schema, created by `memory-inspector init`. Views `AIM_V_CHECK_RUNS` and `AIM_V_FINDINGS` are granted to the dashboard user. The judgments cache is not granted; its rationale is copied into each finding's `evidence`. | Same pattern as the run log: our tables only, and nothing written to package tables. |
| Dashboard screens | `/memories` gets two tabs, **Findings** (the default) and **All memories**. The lifecycle strip is `/runs/[id]/turn/[n]`. No other new pages. | That's the spec's four screens (thread, memory, lifecycle, cost), with cost still in M5. The health report lives on the memory screen instead of becoming a fifth. |
| All-memories table | Joins the demo view `AIM_V_MEMORIES` with the library views (retrieval counts from `AIM_V_MEMORY_RETRIEVALS`, created and last-touched turns from `AIM_V_TURNS` diffs) **in TypeScript**, not in a new SQL view. | Keeps the library's SQL independent of the demo's views. Both are read-only. |
| Fixing things | The dashboard stays read-only. Fixes are shown as suggestions: a `memory_extraction_custom_instructions` string, `record_types`, or `delete_memory` / `update_memory` calls with ids. The labs apply them in code. | The spec's rule: the dashboard is an observer. |
| Labs format | Jupyter notebooks in `labs/`, a uv project depending on `inspector/` and `oracleagentmemory`. Each lab seeds its own user (`lab1_…`) through `labs/_setup.py`, so any lab can start cold and labs don't collide. | The spec says to write every notebook so a learner can start at lab 3. Separate users also keep lab data out of the seeds. |

## Steps

### 0. Spikes (time-boxed, half a day in total)
1. **Search metric.** Run one `search` and compute `VECTOR_DISTANCE(..., COSINE)` for the same query embedding and results. If they match, say "cosine" in the UI. If not, find the metric, or keep calling it "distance". Friction entry either way.
2. **Does `memory_extraction_custom_instructions` stop transient memories and apply corrections?**
   - Rerun `support_01` per turn into a fresh user with instructions such as "Store only durable facts, preferences and guidelines. Never store what the assistant asked or is waiting for. When the user corrects an earlier fact, restate the corrected fact only."
   - Count transient memories and duplicate region facts, with and without the instructions.
   - **Lab 2's payoff depends on this.** If it works, lab 2 teaches the fix. If it doesn't, lab 2 teaches detection plus manual cleanup (`delete_memory` on the stale id), and the gap goes to the friction log as the headline finding for Matt.
3. **Judge agreement.** Hand-label the 11 seed pairs (the table above plus the rest) as `tests/fixtures/judge_pairs.json`, run the judge, and report agreement. Target: at least 9 of 11 overall, with the contradiction and the complementary pair both right. Below that, change the prompt before building on it.

### 1. Health checks in the library (`inspector/`)
- `sql/50_health.sql`:
  - `AIM_CHECK_RUNS`: `check_run_id` (identity), `started_at`, `finished_at`, `params` JSON, `counts` JSON, `package_version`, `judge_model`.
  - `AIM_FINDINGS`: `finding_id`, `check_run_id` (FK, cascade), `fingerprint`, `kind` (CHECK), `severity` (CHECK), `user_id`, `memory_ids` JSON, `turns` JSON (`[{run_id, turn}]`), `title`, `detail`, `suggestion`, `evidence` JSON (distances, verdicts, rationales, matched patterns), `method` (`sql`, `llm` or `sql+llm`).
  - `AIM_JUDGMENTS`: `cache_key` (PK), `kind` (`pair` or `memory`), `verdict`, `direction`, `rationale`, `model`, `judge_version`, `created_at`.
- `sql/60_health_views.sql`: `AIM_V_CHECK_RUNS` and `AIM_V_FINDINGS`, granted by `install()`.
- `health/candidates.py`: the `VECTOR_DISTANCE` self-join (same user, memory types, under the threshold, `a.source_id < b.source_id`), returning ids, types, content, thread, created time and distance. Table names come from the client (as in M3) or from CLI flags.
- `health/judge.py`: prompt, JSON parsing, cache read-through, and a `NullJudge` for runs without the judge extra.
- `health/checks.py`: one pure function per check, from inputs (candidates, verdicts, memories, run log turns, chunk orphans) to findings. Unit-tested against fixtures, with no database.
- `health/runner.py`: gathers inputs, runs checks, writes one check run and its findings in one transaction, and prints a summary.
- CLI: `memory-inspector check --user --dsn [--user-id U] [--judge-model M | --no-judge] [--threshold 0.15]`, with the password from the environment as for `init`. Exit 0 whatever is found; findings are data, not failures.
- Tests: each check against small fixtures, fingerprint stability, and the judge cache (hit, miss, invalidation on prompt version change).

### 2. Seeds that reproduce every finding
- Add `companion/conversations/support_03.yaml`: Alice's mixed question ("Which region is my export bucket in, and how should you contact me?") replayed after the other conversations, so `crowded_turn` has a recorded turn to point at.
- `seed.py` runs the conversations in a fixed order (support_03 last) and then runs `memory-inspector check`, so a fresh seed arrives with findings.

### 3. Dashboard: `/memories` and "why" badges (`web/`)
- **Queries:** `getLatestCheckRuns(2)`, `getFindings(checkRunId)`, `listMemoriesWithStats()` (the TypeScript merge described above), `getFindingsForMemories(ids)`.
- **Findings tab (the default):**
  - Grouped by severity, each finding shows: title, the memories involved (type chip, content, created turn linked to its run), evidence (distance, plus the judge's verdict and rationale labelled "LLM judgment, <model>"), the suggested fix as copyable code, and links to affected turns (`?turn=n&view=why`).
  - A header shows the last check time, the judge model, and counts of new, open and resolved against the previous check.
  - With no check run yet, the page says how to run one.
- **All memories tab:**
  - A table with type, content, user, stored-on thread, created (run and turn), last touched, retrieval count and times in prompt, plus finding badges.
  - Sortable by retrieval count, as the spec asks, to show which memories earn their keep. Retrieval counts are labelled "instrumented turns only".
- **"Why" badges:** results that belong to an open finding get a chip ("stale: superseded by …", "duplicate of #3", "transient"), linked to the finding.
- `node --test` covers the finding diff (new, open, resolved by fingerprint) and the stats merge.

### 4. Lifecycle strip: `/runs/[id]/turn/[n]`
- **Query:** `getTurnEvents(run, n)` over `AIM_V_RUN_EVENTS`.
- **The strip:**
  - One lane per stage, with bars placed by offset from the turn's start and sized by `duration_ms`.
  - Depth 0–1 are always drawn; depth 2 appears on hover via `title`.
  - Colours come from a shared `stageColors.ts`.
  - Server-rendered HTML and CSS, with no chart library.
- **One card per stage**, showing what it produced:
  - retrieval: ids and distances
  - extraction: the turn's diff
  - ingestion: rows and chunks inserted, from the `Record-chunk insert` points
  - summarization: duration
  - Each card also shows total time and share of the turn.
- **Links:** a "lifecycle →" link in the scrubber's strip; previous and next turn; back to `?turn=n`. A bad run or turn returns a real 404.
- **Labelling:** spans closed by inference are marked (`end_inferred`, `unclosed`). The package's extraction token spend is shown as "not reported by the package" (friction 03:50), never as zero.

### 5. Labs 1–3 (`labs/`)
- **Setup:** `labs/pyproject.toml`, `labs/_setup.py` (connection, a lab user per notebook, seeding helpers), and `labs/README.md`. Each lab states its time, its prerequisites, and where to click in the dashboard.
- **Lab 1: environment and first memory.**
  - Connect, build the client, and wrap it with `inspect()`.
  - Write one exchange and one explicit memory.
  - Open the conversation in the dashboard: "these are your rows, in your database".
  - Run `memory-inspector check` once and read an empty report, so the loop is familiar.
- **Lab 2: extraction and scope.**
  - Replay a conversation per turn and look at what became durable.
  - Run the check and read the transient and superseded findings.
  - Apply the fix from spike 0.2 (or the manual cleanup fallback), replay into a fresh user, and check again: the finding count drops.
  - Add a second user and show that search stays inside its boundary.
  - Delete a thread and watch a "user-scoped" preference go with it (the scope_mismatch finding made concrete).
- **Lab 3: retrieval quality.**
  - Three queries: a clean hit, a near miss, and the mixed question whose top results are crowded out.
  - Open "why" for each.
  - Toggle `record_types` and watch raw messages enter and leave the results.
  - Remove the stale duplicate the finding names, rerun the mixed question, and see the preference return to the prompt. The crowded_turn finding resolves on the next check.
- **Tests:** a smoke test that executes each notebook top to bottom against `aim_app` (`jupyter nbconvert --execute`), run by hand before sharing. Not in unit tests, because it makes LLM calls.

### 6. Docs and the friction summary
- **READMEs:** the root README and `inspector/README.md` cover `check`, the judge extra, and what each finding means.
- **`docs/friction.md` summary:** three to five fixes written as observations, each with a reproduction script, as the spec asks. Likely candidates:
  - revise on correction (with spike 0.2's result)
  - honour extractor scope when writing
  - keep transient state out of durable memory
  - return usage and ids in logs
  - a public list-memories API

  This is the artefact for Matt and the product managers.
- **This plan's "as built" section.**

## Verification
1. `uv run pytest` passes in `inspector/` and `companion/`, and `npm test`, lint, `tsc` and `npm run build` pass in `web/`.
2. `seed.py --reset` finishes with a check run whose findings include each kind named in the Goal. Findings are spot-checked by hand against the dashboard, and every judge verdict shows its rationale.
3. **Stability.** Run the check twice with no changes. Every fingerprint is the same, the second run makes no judge calls (all cached), and nothing reports as new or resolved.
4. **The loop.** Lab 3's cleanup, then a rerun and a check: the targeted crowded_turn and duplicate findings show as resolved, and nothing unrelated changes.
5. **Without the judge.** `--no-judge` still reports scope_mismatch, orphan_chunks, and candidate pairs as unclassified, with no errors and nothing claimed that wasn't judged.
6. **`check_web_grants.py` covers the new views and tables:** views readable, tables and the judgments cache not.
7. **Lifecycle.** The strip renders for every turn of one seeded run. Bars stay inside their parents, lanes match the stage counts in SQL, a bad turn returns 404, and it reads at 375 px and in dark mode.
8. **Real data.** Run the check on `aim_live`. Record in the as-built notes how many findings of each kind appeared, any false positives, and any threshold change.
9. **Labs.** Each notebook executes cold, in any order, against a freshly seeded `aim_app`.

## Out of scope
- Fixing memory from the dashboard (it stays read-only).
- Scheduling checks, and alerts.
- The cost view and lab 5 (M5).
- The retention and revision lab (lab 4, M5).
- Checks across users (duplicates are per user by design).
- The optional checks, if time runs out.
- Hosting and the short URL.

## Risks
- **The judge is wrong in ways that look authoritative.** Mitigations: verdicts are labelled "LLM judgment", the rationale is always shown, spike 0.3 measures agreement before building on it, and `complementary` exists to spare legitimate neighbours.
- **Thresholds overfit 34 seed memories.** They're recorded per check run and re-checked on `aim_live` (verification 8).
- **The fix doesn't fix.** If custom instructions don't stop transient or stale memories (spike 0.2), lab 2 changes shape. That's still a strong lab, and a stronger friction finding.
- **The report reads as a list of the package's flaws.** Findings are framed as "things to tune" with a fix each, as agreed in the M3 discussion. The raw friction summary goes privately to Richmond and Matt before any public demo.
- **Labs duplicate the DeepLearning.AI course.** They're built around diagnosing an agent (the inspector, the findings, the fix loop), not around the API tour the course already covers. Show Anant labs 1–3 before writing 4 and 5.
- **Scope creep on `/memories`.** Two tabs, no new pages, and the optional checks come last.

## Open questions for you
1. **Judge cost and model.** The seeds need about 11 pair judgments and 34 memory judgments, cached after the first run. Is the default chat model fine, or should the judge use a cheaper one (Haiku 4.5)?
2. **Real data timing.** Build steps 0–5 now on seeds and validate on `aim_live` at the end (verification 8), or pause after step 1 until a few days of companion use exist? I'd build now, because the seeds already reproduce every finding kind.
3. **Anant.** Share labs 1–3 as a draft when they run, before polishing?
