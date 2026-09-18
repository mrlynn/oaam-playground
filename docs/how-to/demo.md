# How to demonstrate the memory inspector

This guide gets you from a cold laptop to a demo that lands. There are three lengths, each built on the same story. The 5-minute version is the spine, and the longer ones add to it.

**The story, in one line:** *an agent gave a wrong answer while the right one sat in its memory, and in two clicks you can see exactly why, and then find every other place that will happen.*

## Prerequisites

- The repo set up once (see the [first-run tutorial](../tutorial/first-run.md)).
- Docker, Ollama (for embeddings) and an Anthropic API key in `agent/.env`.
- About 15 minutes before the demo for the checklist below.

## Before any demo (15 minutes ahead)

1. **Start the database, and confirm it's healthy.**

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   docker ps --filter name=aim-oracle --format '{{.Status}}'     # "Up … (healthy)"
   ```

2. **Make sure Ollama is running** (`ollama list` shows `nomic-embed-text`). Every search embeds its query, so nothing works without it.

3. **Decide whether to reseed.** A fresh seed takes about 5 minutes and makes real LLM calls. Reseed if the labs or experiments have been run since the last seed, or if step 5 reports a missing moment.

   ```bash
   cd agent
   uv run python scripts/seed.py --reset && uv run python scripts/apply_sql.py
   ```

4. **Start the dashboard,** and check that it shows the seeds, not your real data (`AIM_SCHEMA=AIM_APP` in `web/.env.local`).

   ```bash
   cd web && npm run dev
   ```

5. **Print today's links** and read the `->` lines. They say whether each demo moment reproduced in this seed.

   ```bash
   cd agent && uv run python scripts/demo_links.py
   ```

   ```
   The stale fact (support_01)
     Fact created, turn 2    http://localhost:3000/runs/8f54…?turn=2
     Correction, turn 3      http://localhost:3000/runs/8f54…?turn=3
     Why the correction turn http://localhost:3000/runs/8f54…?turn=3&view=why
     Lifecycle of that turn  http://localhost:3000/runs/8f54…/turn/3
     -> this seed: the stale us-east-1 fact ranked #1 (cosine 0.207) and went into the prompt

   The miss (support_03, the mixed question)
     Why that reply          http://localhost:3000/runs/0c19…?turn=1&view=why
   ...
   ```

6. **Open the tabs in demo order:** the support_03 "why" link, `/memories`, the support_01 lifecycle link, and `/memories?tab=all`. Zoom the browser to 125% for a shared screen.

7. **For the longer versions,** have a terminal ready in `companion/` and, if you'll show the fix loop, lab 3 already run in Jupyter.

**Never demo from `aim_live`.** It holds your real conversations. Everything here uses the seeded users `u_alice` and `u_bob`.

## The 5-minute version: "why did it say that?"

The one to use on a call, with a manager, or at the start of anything longer. Five beats.

### 1. The problem (0:00–0:45)

**Show:** `/runs`.

**Say:** "Agents with long-term memory fail quietly. The answer's wrong and you can't tell why. Was the fact never stored? Stored wrong? Not found? Found, and then crowded out? From the outside it all looks the same. This is Oracle AI Agent Memory with an inspector on it. Every conversation here was recorded turn by turn."

### 2. The miss (0:45–2:00)

**Show:** the support_03 "why" link.

**Say:** "Alice asked one question with two parts: which region is my bucket in, and how should you contact me. In a live run, the agent said it had nothing on file about how to contact her. It does. 'Email only, never phone' is in the database. So why didn't the model see it? This is everything search returned for that turn, and the five that went into the prompt."

**Point at the badges:** "Slot one is a question the assistant asked in an earlier conversation, 'awaiting reply', stored as if it were a fact. That's *transient*. Slot two is the bucket region she corrected weeks ago, the old wrong one. That's *stale*. Slot three is the correction itself. Slot four is a near-copy of the correction. The contact preference isn't in the top five. It's not in the top ten."

The slots above are from one seed. Yours will differ a little, because extraction is an LLM, so narrate the badges you actually see. The shape holds: junk in the top five, and the preference missing.

**The line to land:** "The model didn't fail. Memory handed it the wrong five things."

### 3. Where the stale fact came from (2:00–3:00)

**Show:** click the stale result's "created in an earlier conversation … turn 2" link. You land on support_01 at turn 2, memory view.

**Say:** "Here's the conversation where it came from. Turn 2, she says us-east-1, and a memory is created." Press **→** to step to turn 3. "Turn 3, she corrects it: us-west-2. Watch the memory panel. A *new* memory appears. The old one is still there. The package appends corrections, it never applies them. Both are stored, both are retrievable, and they're 0.04 apart, so a search for one returns the other."

### 4. Finding it everywhere (3:00–4:15)

**Show:** `/memories`.

**Say:** "Clicking through turns doesn't scale. So there's a health check that looks at the whole store. It compares every memory with every other one using `VECTOR_DISTANCE`, inside Oracle, then an LLM judge sorts the close pairs: duplicate, stale, contradiction, or fine to keep both."

Open one **crowded prompt** card, then one **superseded** card. "Every finding has its evidence (the distance, the judge's reasoning, labelled as a judgment) and a fix you can run. And it's careful. This one says read both before deleting, because sometimes the stale memory holds a detail the new one dropped."

### 5. Why this matters (4:15–5:00)

**Say:** "Two things make this possible. Instrumenting an agent is one line, `inspect(client)`, and nothing about the agent changes. And memory is ordinary rows in Oracle. The dashboard logs in read-only, enforced by grants. The health check is a SQL query. You can prove a deletion cascaded. That's the argument for keeping agent memory in the database: you can see it, check it and trust it."

**Stop there.** If there's interest, go longer.

## The 15-minute version

The 5-minute spine, plus four extensions. Pick the ones that fit the audience.

### A. The lifecycle: where the time goes (+2 min)

**Show:** the support_01 lifecycle link (`/runs/…/turn/3`).

**Say:** "This is what the memory package itself did on that correction turn, as a trace. 12.4 seconds in all. Here's the context-summary LLM call, 1.6 seconds, dashed because the package never logs its end, so we infer it. The past-memory lookup, 65 milliseconds. And this purple bar is the extraction LLM call: 9.5 seconds. That's the pause after every reply. And look at the extraction card: 5 memories created, 0 revised. Even on the turn where the user corrected herself."

### B. The memories that earn their keep, and the ones that don't (+1 min)

**Show:** `/memories?tab=all`, sorted by **Retrieved**.

**Say:** "Every memory, sorted by how often search returned it. Look at the top four. Three are flagged: one stale, one transient, one duplicated. The memories reaching the model most often are the ones that shouldn't exist."

### C. One line to instrument, in a real agent (+3 min)

**Show:** the companion in a terminal. Use the seed user, not your real data:

```bash
cd companion
uv run companion --db-user aim_app --user-id u_alice
```

Type the mixed question: *Which region is my export bucket in, and how should you contact me?* Wait about 10 seconds for "remembered in …s", then type `/why`.

**Say:** "Same question, live. `/why` shows what the reply was built from: rank, distance, whether it went in the prompt, and the turn that created each memory." Then ask *How should you contact me?* on its own, and `/why` again. "Asked alone, the preference comes back at the top. A two-topic question gets one embedding that lands between the topics. Sometimes the fix isn't the memory, it's the question."

The model writes live replies, so wording varies. If it happens to get both answers right, say so. The `/why` view still shows what was crowded.

Then show the integration: `companion/src/companion/config.py` (the `inspect(...)` line) and `agent.py` (`record_prompt`). "Four touch points, and the agent's behaviour doesn't change."

### D. The fix loop (+3 min)

**Show:** lab 3 in Jupyter, already run, scrolled to parts 4–5.

**Say:** "The check named ten memories: stale, duplicate, transient. Here they are, read before deleting. Delete them, ask again, check again. Every targeted finding comes back *resolved*, including the crowded turn."

### E. What we'd change in the package (+2 min, for Oracle audiences)

**Show:** the [five fixes page](../friction.md#summary-five-fixes) (or its shared artifact).

**Say:** "A day of building on it turned up five things, ranked by what they cost an agent's answers. The top one is the one you just saw: corrections are appended, not applied. The extractor already looks up the old memory before it writes, so the information to fix it is there."

## The workshop (60–90 minutes)

Use the three labs. Each starts cold and uses its own memory user, so late arrivals can start at any lab.

| time | lab | what attendees do |
|---|---|---|
| 0:00 | intro | the 5-minute demo above |
| 0:10 | [lab 1](../../labs/lab1_first_memory.ipynb), 15 min | connect, `inspect()`, memory as rows and as search results, first health check |
| 0:25 | [lab 2](../../labs/lab2_extraction_and_scope.ipynb), 25 min | watch extraction keep conversation state and stale facts; fix the first with custom instructions; see why the second can't be fixed that way; lose a preference by deleting its thread |
| 0:50 | [lab 3](../../labs/lab3_retrieval_quality.ipynb), 25 min | a clean hit, a near miss, and a crowded prompt; find it, fix it, ask again; split the question |
| 1:15 | wrap-up | the five fixes, and questions |

**Setup notes:**
- Everyone needs the database, Ollama and a key. On a shared database, give each person a `LAB_SUFFIX` (for example their initials) so lab users don't collide.
- A full pass is about 30 extraction calls and 40 judge calls per person.
- Results vary from run to run. The labs are written so the point lands either way, so say that up front.

## If a beat doesn't reproduce

Extraction is an LLM, so a seed can occasionally miss a beat. `demo_links.py` tells you before you start.

| it says | do this |
|---|---|
| "no superseded us-east-1 finding" | Run `uv run python scripts/check.py`, then rerun `demo_links.py`. If it's still missing, reseed. |
| "the stale fact exists but that turn's search didn't return it" | Tell beat 3 on support_01 turn 2 → 3 (creation, then correction), and skip the claim that it reached the prompt. |
| "support_03 not found" | The seed ran without it. Reseed. |
| A page shows "database unreachable" | The container is stopped, or `web/.env.local` has the wrong password. |
| The "why" view has no badges | No judged check has run since the seed. Run `check.py`. |

## Questions you'll get

**"Is this an Oracle product?"**
No. It's a personal work sample, built on the public `oracleagentmemory` package to learn it, and Apache-2.0 licensed.

**"Does the inspector slow the agent down?"**
It hasn't been benchmarked. Per write turn it adds two small reads of the memory table and one write transaction after the turn. For scale, the package's own extraction LLM call is 9.5 of the 12.4 seconds on a typical turn.

**"What if the inspector breaks?"**
The agent doesn't notice. Every piece of bookkeeping is guarded, and a failed write is logged and dropped. There's a switch that forces every write to fail, and the probe confirms the conversation still completes.

**"Can I trust the LLM judge?"**
Partly, by design. On 11 hand-labelled pairs it agrees on 9 or 10, and it always gets the hard two right: the contradiction, and the pair that looks like a duplicate but should be kept. Every verdict shows its reasoning and is labelled as a judgment, verdicts are cached so reruns agree, and the fixes say "read before deleting". A cheaper model scored the same but got the costly one wrong, which is why it isn't the default.

**"Why not just use a similarity threshold?"**
Because a real contradiction sat at distance 0.042, and a legitimate cause-and-fix pair at 0.070. Any cutoff that catches one catches the other.

**"Does it fix the memory for me?"**
No, deliberately. The dashboard can't write. It's read-only by database grant. Fixes are shown as code, and lab 3 applies them.

**"Does it work with LangChain / mem0 / other memory libraries?"**
No. It reads this package's log messages and tables, and pins 26.6.x. The ideas carry over, though: record each turn, diff the store, check it with vectors in the database.

**"Why is the prompt with memory bigger than the whole history?"**
Early on, it is. Five memories from earlier conversations outweigh a three-message history. Memory pays off once the conversation is long. See the [token method](../token-method.md).

**"What about deleting a user's data?"**
Deleting a thread cascades to its messages, memories and vectors, and you can verify that with SQL (lab 2). `delete_user` isn't instrumented yet.

**"What would you change in the package?"**
The [five fixes](../friction.md#summary-five-fixes). Lead with number one: corrections are appended, never applied.

## Tailor it to the room

| audience | lead with | spend time on | skip |
|---|---|---|---|
| Developers | beat 2 (the miss) | C (companion, one-line integration), lifecycle | the database pitch |
| Field and customers | beat 5 (why the database) | beat 4 (health check), `/memories` | code |
| Oracle product people | beat 3 (appended corrections) | E (five fixes), the lifecycle | the workshop |
| Educators | the workshop | labs 2 and 3 | E |

## Don't

- Show `aim_live`, or any real conversation.
- Say the judge is always right. It's 9–10 of 11, and it's labelled as a judgment.
- Promise that cleanup alone fixes the mixed question. It moved the preference from outside the top 10 to about rank 8. Splitting the question put it at rank 1.
- Present it as Oracle's tool.

## Related

- [How it works](../explanation/how-it-works.md): the architecture you're describing.
- [Dashboard reference](../reference/dashboard.md): every panel and URL.
- [Operate and troubleshoot](operate.md).
