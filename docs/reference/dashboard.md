# Dashboard reference

The dashboard in `web/` is a Next.js 16 app (App Router, MUI 9) that reads Oracle through `oracledb` in thin mode. It's read-only by construction: it logs in as `AIM_WEB`, which can only `SELECT` from the `AIM_V_*` views. It never writes anything, anywhere.

Every page is server-rendered on request. There are no API routes, and the only client-side code is the turn scrubber and some small controls. All state lives in the URL, so any view is a link you can share.

## Running it

```bash
cd web
cp .env.example .env.local     # set AIM_WEB_PASSWORD from infra/.env
npm install
npm run dev                    # http://localhost:3000
```

| variable (`web/.env.local`) | default | meaning |
|---|---|---|
| `AIM_WEB_USER` | `aim_web` | the read-only login |
| `AIM_WEB_PASSWORD` | required | from `infra/.env` |
| `AIM_DB_DSN` | `localhost:1521/FREEPDB1` | |
| `AIM_SCHEMA` | `AIM_APP` | which schema's views to read. `AIM_LIVE` shows your real companion data. |

`npm test` runs the pure-logic tests under `node --test`. Also available: `npm run lint` and `npm run build`.

## Pages

### `/runs`

Every conversation (thread) in the schema, newest activity first. The columns are thread, user, agent, messages, memories, **turns** (blank if the thread predates the run log, hover for the source), created, and last activity. Click a thread to open it.

### `/runs/[id]`

One conversation. Its layout depends on whether the thread has a run log.

**With a run log** (anything written through `inspect()`):

- **The header** shows user, agent, message and memory counts, the run chip (turn count and source; hover for models and package version), and the expired-rows toggle.
- **The scrubber** is a slider with step buttons. The **← and →** keys step turns too, except when focus is in a form field or on the slider itself. The strip under it shows this turn's created, updated, deleted and retrieved counts, prompt tokens against flat history, duration, how the turn closed, whether the reply was scripted, and a **"lifecycle of turn n →"** link. On desktop the strip sticks to the top.
- **The conversation** is on the left. Turn *n*'s messages are outlined, and later turns are dimmed and collapsed to one line. Each assistant reply has a **why?** chip.
- **The right pane** has two tabs:
  - **Memory at turn n.** Every memory as it was at that turn, rebuilt from the run log's diffs, so deleted memories and earlier versions still show. Memories created later are hidden. States:
    - *created turn n*
    - *retrieved #r · 0.207*, with the prompt label
    - *revised turn n*, showing before (struck through) and after
    - *removed turn k*, in the Removed section
    - "existed before the run log"

    Each memory links to the turn that created it. A memory the extractor labelled broader than its thread shows an orange *labelled user* chip.
  - **Why (turn n).** The user's message. Then every search result that turn, grouped by search with its query text: rank, type, a distance bar with the cosine distance, the prompt label, content as of that turn, and where it came from (a link to the turn of this conversation that created it, another conversation's turn, or "before the run log"). Raw message chunks are flagged. Results the latest health check flagged carry a badge that links to the finding: *stale*, *duplicate ×3*, *transient*, *contradicts*, *near-duplicate*. At the bottom, **"Prompt the model saw"** expands to the assembled prompt and its token counts.

  On phones, the "why" pane moves above the conversation, so tapping **why?** shows something.

**Without a run log** (threads written without the inspector, for example by `smoke.py`): the plain M2 layout. Messages on the left, and the thread's memories on the right, placed by derived position ("after message #n"). `?turn` and `?view` are ignored.

| URL parameter | values | default |
|---|---|---|
| `turn` | 1…turn count. Anything else is clamped, and garbage means the last turn. | the last turn |
| `view` | `why` | memory |
| `expired` | `1` shows expired rows | hidden |

A bogus thread id returns a real 404.

### `/runs/[id]/turn/[n]`

The lifecycle of one turn: what the memory package did, as a waterfall.

- **One row per span,** in start order, indented by nesting and coloured by stage (retrieval blue, ingestion teal, summarization pink, extraction purple, consolidation amber, revision red, other grey). Agent calls are bold, and spans whose end was inferred are dashed. Hover a row for name, stage, duration, source and any error. Turns with more than 40 spans collapse to the top three levels, with a "show deeper spans" link (`?depth=all`).
- **The stage cards** show time per stage, counted once per outermost span of that stage, with its share of the turn. Stages overlap, so shares can add up to more than 100%. Each card also shows what the stage produced:
  - retrieval: searches, results, how many went into the prompt, the closest distance
  - extraction: created, updated and deleted counts, with the first three created memories
  - ingestion: messages written and chunks inserted
  - consolidation: past memories looked up
  - summarization: one LLM call
- **Tokens:** the package's own LLM token spend is shown as "not reported by the package", never as zero.
- **Links:** previous and next turn, "conversation at turn n", "why". A turn that's out of range or not a positive integer, or a bogus run, returns 404.

### `/memories`

Two tabs.

**Findings** (the default) shows the latest health check:
- **A header** with the check number, time, memories and close pairs examined, the judge model (hover for call and cache counts), and new, still-open and resolved counts against the previous run with the same scope and judge.
- **Findings grouped by severity.** Each card has:
  - severity, kind, a *new* chip, user, and "decided by SQL + LLM judgment" (or text pattern)
  - title and detail
  - the memories involved (type, role, and where each was created)
  - "see why" links for affected turns
  - the evidence: cosine distance, matched text, "LLM judgment · model" and its rationale, per-turn wasted slots
  - the suggested fix, as code

  Each card has an anchor (`#finding-<id>`) that the badges link to.
- **Resolved since the last check** is collapsed at the bottom.
- With no check yet, the page says how to run one.

**All memories** (`?tab=all`) lists every current memory: type, content (two lines, hover for all of it), user, created (date plus the turn or thread that created it), **retrieved** (times returned by an instrumented search), **in prompt** (times it reached the prompt), and finding badges. Sort with `?sort=retrieved` (the default), `created` or `findings`. `?expired=1` includes expired rows.

## Where each page reads from

| page | views |
|---|---|
| `/runs` | `AIM_V_THREADS`, `AIM_V_RUNS` |
| `/runs/[id]` | `AIM_V_THREADS`, `AIM_V_RUNS`, `AIM_V_TURNS`, `AIM_V_MESSAGES`, `AIM_V_MEMORIES`. In "why" mode it adds `AIM_V_FINDINGS` and `AIM_V_CHECK_RUNS` for badges. |
| `/runs/[id]/turn/[n]` | `AIM_V_RUNS`, `AIM_V_TURNS`, `AIM_V_RUN_EVENTS` |
| `/memories` | `AIM_V_CHECK_RUNS`, `AIM_V_FINDINGS`, `AIM_V_MEMORIES`, `AIM_V_TURNS`, `AIM_V_MEMORY_RETRIEVALS` |
| header chips | `AIM_V_STORE_INFO` |

## Code map

| file | role |
|---|---|
| `src/lib/db.ts` | the single connection pool (cached across hot reloads). `query()` calls `connection()` so nothing reads the database at build time. |
| `src/lib/queries.ts` | every SQL statement. Views only, bind variables only. |
| `src/lib/memoryState.ts` | memory as of turn *n*, from diffs (pure, tested) |
| `src/lib/findings.ts` | new/open/resolved, badges, memory stats (pure, tested) |
| `src/lib/lifecycle.ts` | waterfall layout and stage totals (pure, tested) |
| `src/components/run/*` | scrubber, "why" pane, memory state card, run view, header |
| `src/components/health/FindingCard.tsx` | one finding |
| `tests/*.test.mjs` | 23 `node --test` cases |

## Related

- [How it works](../explanation/how-it-works.md#how-the-dashboard-answers-why-did-it-say-that)
- [Data model](data-model.md) · [Demo guide](../how-to/demo.md)
