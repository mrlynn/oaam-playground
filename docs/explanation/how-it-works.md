# How it works

This project makes an AI agent's memory visible. You can see what the agent remembered, what it looked up before each reply, why that reply came out the way it did, and what's wrong with the memory as a whole. It's built on [Oracle AI Agent Memory](https://pypi.org/project/oracleagentmemory/) (`oracleagentmemory` 26.6.0), a Python package that stores an agent's conversations and extracted memories in Oracle Database.

This page explains the moving parts and why they're shaped the way they are. For exact names, columns and flags, see the [reference docs](#where-to-go-next). For how to show it to someone, see the [demo guide](../how-to/demo.md).

## The problem

An agent with long-term memory fails quietly. It gives a wrong answer and you can't tell why. Maybe the fact was never stored, maybe it was stored wrong, maybe search didn't find it, maybe search found three other things first, or maybe the model ignored what it was given. From the outside, all of those look the same.

The package does the storing and the searching, but it doesn't tell you what happened on a given turn. Its logs say *that* a search ran, not *what* it returned. It has no way to list memories, and no record of when a memory changed. So the first question anyone debugging an agent asks, "why did it say that?", has no answer.

This project answers it, and then goes one step further: it looks at the whole store and finds problems before they cost an answer.

## The parts

```
 ┌──────────────────────────────── your agent ───────────────────────────────┐
 │ companion/ (a real chat agent)   labs/ (notebooks)   agent/scripts/seed.py │
 └──────────────────────────────────────┬─────────────────────────────────────┘
                                        │ memory = inspect(OracleAgentMemory(...), pool=pool)
                                        ▼
 ┌─────────────── memory-inspector (inspector/) ─────────────┐
 │ wrapper: every call passes through unchanged, and is recorded │
 │ log capture: the package's own log records, as timed spans    │
 │ memory diff: what the memory table looked like before/after   │
 └──────────────┬──────────────────────────────┬─────────────────┘
                │ records                      │ calls
                ▼                              ▼
 ┌──────────── Oracle Database (one schema, e.g. AIM_APP) ────────────────────┐
 │ run log (ours):  AIM_RUNS  AIM_TURNS  AIM_RUN_EVENTS                         │
 │ package tables:  THREAD  MESSAGE  MEMORY  RECORD_CHUNKS (vectors)            │
 │ health (ours):   AIM_CHECK_RUNS  AIM_FINDINGS  AIM_JUDGMENTS                 │
 │                     ▲                                                        │
 │                     │ memory-inspector check: VECTOR_DISTANCE + an LLM judge │
 │ read-only views:  AIM_V_*  ─────────────────────────────┐                    │
 └─────────────────────────────────────────────────────────┼────────────────────┘
                                                            │ SELECT only (user AIM_WEB)
                                                            ▼
                                              web/ dashboard (Next.js)
```

There are six pieces. Each has its own README or reference page.

| piece | what it is | where |
|---|---|---|
| **memory-inspector** | A Python library. One `inspect()` call wraps the package's client and records every turn. `memory-inspector check` runs a health check on the whole store. | `inspector/`, [reference](../reference/inspector.md) |
| **Run log** | Three tables in the same schema as the memories: one row per conversation, one per turn, one per timed step. | [data model](../reference/data-model.md) |
| **Health check** | Finds stale, duplicated and conversation-state memories, and the turns where they crowded the prompt. | [explanation](health-checks.md) |
| **Dashboard** | A read-only Next.js app: every conversation turn by turn, "why" for every reply, a trace of each turn, and the health findings. | `web/`, [reference](../reference/dashboard.md) |
| **Companion** | A small, real terminal agent that uses the library. Its job is to produce honest memory behaviour from real use. | `companion/` |
| **Labs** | Three notebooks that teach the loop: look, find what's wrong, fix it, check again. | `labs/` |

Everything else (`agent/`, `infra/`) is setup: the database container, users and grants, seed data, and scripts.

## Three kinds of data, one database

All of it lives in Oracle, in the same schema:

1. **The package's own tables.** `THREAD` (one row per conversation), `MESSAGE` (every message), `MEMORY` (durable memories: facts, preferences, guidelines and free-form memories) and `RECORD_CHUNKS` (the text chunks and their embedding vectors that search runs against). The package creates and owns these. This project never writes to them. It only reads.
2. **The run log.** Our tables, written by the inspector: what happened on each turn.
3. **Health findings.** Our tables, written by the health check: what's wrong with the memory right now.

Keeping it all in one database is deliberate, and it's the point of the whole exercise. Memory in Oracle is ordinary rows, so it can be inspected like any other data:
- The dashboard logs in as a user who can only `SELECT` from views, and a script proves it.
- The health check compares every memory with every other using `VECTOR_DISTANCE`, inside the database.
- You can check with plain SQL that deleting a thread removed its messages, memories and vectors.

## What happens on one turn

Take one turn of the companion: the user asks something, the agent replies, the exchange is saved. Here's everything that happens, in order.

```
 you type a question
   │
 1 │ agent calls memory.search(question, user_id, record_types=[memory types])
   │    └─ inspector: opens a TURN, records the 10 results (rank, id, type, cosine distance)
 2 │ agent builds the prompt: system prompt + top 5 memories + last 6 messages + question
 3 │ agent calls the model (LiteLLM) and prints the reply
 4 │ agent calls memory.inspector.record_prompt(prompt, reply, usage, memory_ids_used=top 5)
   │    └─ inspector: now it knows which results went into the prompt
 5 │ agent calls thread.add_messages([question, reply])
   │    ├─ inspector: snapshot of the user's memories BEFORE
   │    ├─ package: append messages
   │    │     └─ extraction: context-summary LLM call (~1.6 s)
   │    │                    past-memory lookup (a search, ~65 ms)
   │    │                    extraction LLM call (~9.5 s)
   │    │                    write messages + memories, chunk, embed, insert (~180 ms)
   │    │     (each step logs "X started." / "X completed.", captured as timed spans)
   │    ├─ inspector: snapshot AFTER → diff: created / updated / deleted memories
   │    └─ inspector: CLOSES the turn and writes it: one AIM_TURNS row + its AIM_RUN_EVENTS
   ▼
 "remembered in 11.4s: 2 created"
```

The timings are real, from turn 3 of the seeded `support_01` conversation. They explain the companion's pause after every reply: almost all of it is the package's extraction LLM call.

A few things in that sequence need explaining.

**What a turn is.** A turn opens on the first recorded call (usually the search) and closes when the agent writes the exchange (`add_messages`) or deletes the thread. The agent doesn't have to say where turns begin and end, which matters for real agents that have no script loop. Turn numbers come from the database under a row lock, so they carry on correctly across restarts and days. An agent that wants explicit boundaries can use `with memory.inspector.turn(thread):`.

**How the package's work becomes a timeline.** The package logs through Python's standard `logging`, under `oracleagentmemory.*`. Each operation logs a start record and an end record: "DB store add started.", "DB store add completed.". The inspector installs one log handler that pairs them into timed spans and nests each span under whatever was open when it started. It then maps each span to a lifecycle stage (ingestion, extraction, consolidation, retrieval, summarization, revision or other) using a rule table built from records captured on 26.6.0. Part of the package's work runs on a background worker thread. A Python context variable follows it there, so those records still land in the right turn.

**Why it snapshots the memory table.** The package has no "list memories" call and no `UPDATED_AT` column, so there's no other way to learn what a turn created, changed or deleted. The inspector reads the user's rows from `MEMORY` before and after `add_messages` and diffs them. That diff is the only record of a revision anywhere, and it's what lets the dashboard show memory *as it was at turn 3*, including memories that have since been deleted.

**Why failures never reach the agent.** Every piece of bookkeeping runs inside a guard that logs the error and moves on. The real package call always runs exactly once, with the caller's arguments, and its result or exception comes back unchanged. Run log writes happen in one transaction per turn, after the turn, and a failed write is logged and dropped. `MEMORY_INSPECTOR_FAIL_WRITES=1` forces that failure path for testing.

## How the dashboard answers "why did it say that?"

The dashboard reads only the `AIM_V_*` views. For one conversation it can show:

- **The conversation at turn n.** Later messages are dimmed, and this turn's are outlined.
- **Memory at turn n.** Rebuilt from the per-turn diffs, not from the table: content as it was then, what was created this turn, what search returned (rank and distance), what was revised (before and after), what was removed.
- **Why (turn n).** Every search result that turn, whether it went into the prompt, where each memory was created (a turn of this conversation or another), and the prompt the model actually saw. Results the health check flagged carry a badge: *stale*, *duplicate ×3*, *transient*.
- **The lifecycle of turn n.** Every span as a waterfall, coloured by stage, with a card per stage showing what it produced.

The labels on search results are careful not to claim more than is known. A result is "in prompt" only if the agent reported it with `record_prompt`. Otherwise it's "returned by search", because the inspector can't see the prompt on its own.

## How the health check finds problems

The dashboard explains one turn at a time. The health check looks at everything at once.

In short:
1. A SQL query inside Oracle compares every memory with every other memory of the same user, using `VECTOR_DISTANCE(..., COSINE)`, and keeps pairs closer than 0.15.
2. An LLM judge reads each close pair and decides how they relate: duplicate, one supersedes the other, contradiction, complementary (both worth keeping), or unrelated. It also reads likely "conversation state" memories and decides whether they're durable or transient.
3. Plain Python turns those verdicts into findings, each with evidence and a fix you can run, and compares them with the last check to show what's new and what's resolved.

Distance alone can't tell a stale fact from a legitimate neighbour, which is why the judge exists. The details, the trade-offs and the accuracy numbers are in [the health checks explanation](health-checks.md).

## The two schemas

The database has two copies of the same shape:

| schema | holds | reset? |
|---|---|---|
| `AIM_APP` | the scripted seeds, the labs, demos | freely: `seed.py --reset` recreates it |
| `AIM_LIVE` | your real conversations with the companion | never: `seed.py --reset` refuses |

A third user, `AIM_WEB`, is the dashboard's login. It can `SELECT` from the `AIM_V_*` views in both schemas and nothing else. The dashboard shows `AIM_APP` unless `AIM_SCHEMA=AIM_LIVE` is set in `web/.env.local`. The split protects a week of real use from one reset, and keeps private conversations out of screenshots.

## Design decisions and what they cost

| decision | why | what it costs |
|---|---|---|
| **Observe, never reimplement.** The wrapper passes every call through unchanged. | You can drop it into any agent without changing what the agent does. | Anything the package doesn't expose has to be inferred (diffs, span pairing), and those workarounds are listed in the [friction log](../friction.md). |
| **Infer turn boundaries by default.** | Real agents don't announce turns. | An agent that searches without writing, or writes to two threads in one turn, can confuse the inference. `turn()` fixes it, and every turn records `closed_by`. |
| **Keep the run log in the same database.** | One system to explain, and the "memory belongs in the database" argument stays intact. | The run log adds tables to the agent's schema, and they need `memory-inspector init`. |
| **Map stages from log message text.** | It's the only signal the package gives. | It's brittle across package versions. Mitigations: raw records are kept, unmapped spans are flagged not dropped, a captured fixture pins the behaviour, and `probe_inspector.py` re-checks against the live package after an upgrade. |
| **A read-only dashboard, enforced by grants.** | Makes "observer" something the database guarantees, not a coding convention. | Fixes can only be suggested, never applied from the UI. The labs apply them in code. |
| **An LLM judge for the health check.** | Distance can't tell a contradiction (0.042) from a legitimate cause-and-fix pair (0.070). | Verdicts can be wrong. They're labelled as judgments, always show a rationale, and are cached so reruns agree. Measured agreement with hand labels is 9–10 of 11. |
| **Two schemas, live and seed.** | Resets can't touch real data. | Views and grants must be installed in both, and `check_web_grants.py` covers both. |
| **Only inline extraction is supported.** | Background extraction runs after the turn closes, so its work can't be attributed. | Agents using background mode get their package spans recorded as "unattributed". |

## Where to go next

- [Tutorial: first run](../tutorial/first-run.md) takes you from a clean machine to the "why" moment.
- [Demo guide](../how-to/demo.md) covers 5-minute, 15-minute and workshop versions.
- [Health checks explained](health-checks.md).
- Reference: [library and CLI](../reference/inspector.md) · [data model](../reference/data-model.md) · [dashboard](../reference/dashboard.md) · [scripts and configuration](../reference/scripts-and-config.md).
- How-to: [instrument your own agent](../how-to/instrument-your-agent.md) · [operate and troubleshoot](../how-to/operate.md).
- [What we learned about the package](../friction.md#summary-five-fixes).
