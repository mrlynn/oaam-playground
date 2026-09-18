# How the health check works

`memory-inspector check` looks at an agent's whole memory store and reports what's wrong with it: facts that were corrected but are still stored, the same thing stored three times, conversation state saved as if it were a durable fact, and the turns where those took up the prompt. Each finding comes with evidence and a fix you can run.

This page explains how it decides, what it trades off, and how far to trust it. For flags and the Python API, see the [library reference](../reference/inspector.md#memory-inspector-check). For the tables it writes, see the [data model](../reference/data-model.md#health-tables).

## The problem

The package's extraction writes memories one exchange at a time, and it only ever adds. On a real support conversation, that produces three kinds of damage:

- **Stale facts.** The user says us-east-1, then corrects it to us-west-2. Both are stored. They sit 0.04 apart in embedding space, so a search for one returns the other, and the stale one often ranks first.
- **Duplicates.** The same preference is extracted from two conversations, or restated in the same one. Each copy takes a search slot.
- **Transient memories.** "The assistant asked which region; awaiting reply" is stored as a durable memory and retrieved in later sessions.

On the seed data, three of the four most-retrieved memories carried a finding: one stale, one transient, one duplicated. In one reproduced turn they took 3 of 5 prompt slots, and the user's actual contact preference didn't make the top 10. The agent answered "I have nothing on file about how to contact you" while the preference sat in the database.

The per-turn "why" view shows this after the fact, one turn at a time. The health check finds it across the whole store, before it costs an answer.

## The approach

```
                       ┌─────────────────────────────────────────────┐
  MEMORY, RECORD_CHUNKS│ 1. gather (as the schema owner, read-only)  │
  AIM_TURNS, AIM_RUNS ─►    memories · close pairs (SQL) · orphans ·  │
                       │    recorded turns                           │
                       └──────────────────┬──────────────────────────┘
                                          ▼
                       ┌─────────────────────────────────────────────┐
  AIM_JUDGMENTS ◄─────►│ 2. judge (optional, cached)                  │
   (cache)             │    pairs → duplicate / supersedes /          │
                       │            contradicts / complementary /     │
                       │            unrelated                         │
                       │    candidates → durable / transient          │
                       └──────────────────┬──────────────────────────┘
                                          ▼
                       ┌─────────────────────────────────────────────┐
                       │ 3. checks (pure functions, no I/O)          │
                       │    superseded · contradiction · duplicate · │
                       │    transient · crowded_turn · scope_mismatch│
                       │    orphan_chunks · near_duplicate           │
                       └──────────────────┬──────────────────────────┘
                                          ▼
                       ┌─────────────────────────────────────────────┐
  AIM_CHECK_RUNS ◄─────│ 4. write one check run + its findings,       │
  AIM_FINDINGS         │    compare with the previous comparable run  │
                       └─────────────────────────────────────────────┘
```

### 1. Candidates come from SQL, inside the database

Every memory is exactly one row in `RECORD_CHUNKS`, with its embedding stored as a FLOAT64 vector. One self-join finds every pair of memories that belong to the same user and sit closer than the threshold:

```sql
select a.source_id, b.source_id, min(vector_distance(a.embedding, b.embedding, COSINE))
  from record_chunks a
  join record_chunks b on a.source_id < b.source_id and a.user_id = b.user_id
 where a.source_record_type in ('memory','fact','preference','guideline')
   and b.source_record_type in ('memory','fact','preference','guideline')
   and vector_distance(a.embedding, b.embedding, COSINE) < :threshold
 group by a.source_id, b.source_id
```

COSINE is the same metric the package's `search` reports. That was measured, not assumed: `agent/spikes/search_metric.py` recomputes search distances in SQL and matches them exactly. So a pair's distance and a search result's distance share one scale.

The default threshold is **0.15**. It was tuned on 34 seed memories, and the run records it so it can be changed and compared.

### 2. A judge classifies what distance can't

Distance finds candidates but can't tell them apart. These are real pairs from the seeds:

| distance | the pair | what it really is |
|---|---|---|
| 0.042 | "bucket in us-west-2 (corrected from us-east-1)" / "bucket in us-east-1" | supersedes |
| 0.045 | two phrasings of "analyst accounts expire in 90 days" | duplicate |
| 0.070 | "role is missing s3:PutObject" / "add s3:PutObject to the role" | complementary: keep both |
| 0.093 | "assistant asked which region; awaiting reply" / "bucket is in us-east-1" | a pending question and its answer |

The contradiction sits closer than the legitimate pair. Any cutoff that catches one catches the other.

So an LLM reads each pair (older one first, with both memory types) and answers in JSON with one relation, which side is current if it's a supersession, and one sentence of rationale. It also reads each memory that might be conversation state (anything matching a pattern like "awaiting", "asked", "again" or "unresolved", plus every free-form `memory`-type memory) and says durable or transient. That candidate pattern (`JUDGE_PATTERN`) is wider than the one that makes a finding on its own in no-judge mode (`TRANSIENT_PATTERN`), because a false match only costs a cached judge call.

How the judge is kept honest:
- **Cached by content.** A verdict is stored in `AIM_JUDGMENTS` under a hash of the prompt version, the model and the exact text judged. Rerun the check and you get the same answer with zero model calls. Edit a memory and it's judged again. This matters because newer models reject `temperature=0`, so caching is the only way to get stable answers.
- **Versioned prompts.** Changing a prompt means bumping `PAIR_VERSION` or `MEMORY_VERSION`, which invalidates old verdicts.
- **Unparsed is a verdict.** A reply without usable JSON becomes `unparsed`, which is reported as an unclassified near-duplicate. It's never cached and never crashes the run.
- **Measured.** `agent/spikes/judge_agreement.py` runs the real judge against 11 hand-labelled seed pairs. Claude Sonnet 5 agrees on 9 or 10 of 11, varying by run, and always gets the contradiction and the complementary pair right. Haiku 4.5 also scores 9, but calls the cause-and-fix pair a duplicate, which would tell users to delete a guideline worth keeping. That's why the judge defaults to the chat model.

### 3. Checks are plain functions

Each check takes gathered inputs and verdicts and returns findings. No database, no model, which is why each one has its own unit tests (`inspector/tests/test_health.py`).

| finding | severity | how it's decided | the fix it suggests |
|---|---|---|---|
| `superseded` | high | the judge says one of a pair makes the other out of date. **One finding per stale memory**, listing everything that supersedes it. | read both; fold any detail only the stale one has into the current one (`update_memory`); then `delete_memory` the stale one |
| `contradiction` | high | the judge says they conflict and neither says which is current | confirm with the user, delete the wrong one |
| `crowded_turn` | high | a recorded turn put stale, duplicate or transient memories into its prompt: at least one stale, or at least two wasted slots. **One finding per conversation**, naming the worst turn. | fix the linked findings, then ask again |
| `orphan_chunks` | high | vectors whose memory or message no longer exists | find what deleted the source records outside the package |
| `duplicate` | medium | the judge says a pair repeat each other. Pairs are merged into clusters, so three copies make one finding. The longest copy is kept. | delete the other copies |
| `transient` | medium | the judge says conversation state, or a pattern match when there's no judge | delete it, and set `memory_extraction_custom_instructions` (through `MemoryExtractionConfig`) to stop new ones (the tested wording is included) |
| `scope_mismatch` | low | memories labelled broader than one conversation but stored on a thread. **One finding per user.** | copy them to user level before deleting the thread |
| `near_duplicate` | low | a close pair nobody classified: there was no judge, or the reply was unparsed | read both and decide |

Two rules keep the report from saying the same thing twice. A pending question that was later answered is both "superseded" and "transient", and it's reported once, as transient, because that fix covers both. Inside a crowded turn, a memory that's both stale and transient is labelled transient too.

The `superseded` fix says "read both first" for a reason. Reviewing the report surfaced a stale memory ("accounts will be created… expiring after 90 days") whose replacement ("accounts have been created") had dropped the expiry. Deleting the stale one blindly would have lost the only record of it.

### 4. Findings keep their identity across runs

Each finding gets a **fingerprint**, so two check runs can be compared:
- **Most kinds** are identified by their memory ids (and turns). Delete the stale memory and its `superseded` finding is gone on the next run: *resolved*.
- **`crowded_turn`, `scope_mismatch` and `orphan_chunks`** are about a conversation, a user and the store. They're identified by that subject instead, so a conversation whose problems shrank is the same finding, still open, not a "resolved" plus a "new" with the same title.

A run is compared only with the previous run that has **the same scope and the same judge model**. A `--no-judge` run compared with a judged one would report every judged finding as resolved.

## Trade-offs

- **The judge can be wrong.** It's an LLM. Mitigations: agreement is measured, verdicts are labelled "LLM judgment · model" with their rationale in every finding, the fix text says to read before deleting, and the dashboard never deletes anything itself.
- **Thresholds were tuned on seed data.** 0.15 cosine and the transient patterns came from 34 seed memories. They're recorded with every run. The patterns have now met real use: on `aim_live`, "has asked about X again", "X remains unresolved" and "the user asks about…" were typed as facts, so `JUDGE_PATTERN` gained "asks", "again", "unresolved", "remains open/unanswered/unclear" and "as of the latest" (it adds no candidates on the seeds). The 0.15 threshold is still unchecked on real data: `aim_live` is too small to have close pairs yet.
- **Cost.** One model call per new pair and per new candidate memory. On the seeds that's about 18–24 calls for a first run and 0 for a rerun. A store with thousands of memories and many close pairs costs proportionally more on its first run.
- **It sees only what's stored.** "Crowded turn" needs the run log, so it only covers instrumented turns. With `record_prompt` it knows what reached the prompt. Without it, it counts everything search returned and says so.
- **Deterministic mode is narrow on purpose.** Without a judge, a pair is only called superseded when the newer memory says it corrects the older one. Everything else is reported unclassified, never guessed.

## Alternatives considered

- **Distance thresholds alone.** Rejected, because of the 0.042 contradiction next to the 0.070 complementary pair.
- **Haiku as the judge, for cost.** Measured and rejected (see above).
- **Tuning the prompt until it matches every hand label.** Stopped after two rewordings made no difference on one ambiguous pair. Moving the labels toward the model, or the model toward 11 labels, would be overfitting.
- **Fixing things from the dashboard.** Rejected, because the dashboard is read-only by design and by grant. The labs show the fixes in code.

## Related

- [Library reference: check](../reference/inspector.md#memory-inspector-check)
- [Data model: health tables](../reference/data-model.md#health-tables)
- [Dashboard: /memories](../reference/dashboard.md#memories)
- Lab 2 (the transient fix) and lab 3 (the cleanup loop), in `labs/`
- The spikes behind the numbers: `agent/spikes/`
