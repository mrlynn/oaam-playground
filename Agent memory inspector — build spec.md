# Agent memory inspector — build spec

2026-09-18 · @Someone

## What this is

A memory inspector for Oracle AI Agent Memory, plus a set of labs built around it. You stand up Oracle AI Database Free, run the oracleagentmemory package against it, and build a dashboard that shows what an agent remembers and why: threads and messages on one side, durable memories with retrieval scores on the other, and each lifecycle stage visible as it fires.

The gap this fills is visibility. Oracle has the research, a DeepLearning.AI course, and a package on PyPI. Nobody has a way for a developer or a field engineer to watch memory work. That makes the claims hard to teach and harder to sell, which is part of why workshop content goes stale and salespeople forget the story.

It serves three audiences at once. Richmond gets a visual companion to the lifecycle framing from the technical report. Anant gets something droppable into the agent memory workshop and the observability workshop he has not finished. The field gets a five-minute demo that answers why memory belongs in the database, which is the pitch that has to survive an account where an OCI rep is pushing something else.

It also puts your history to work in the right direction. You built a MongoDB-backed semantic memory system, so you know where the hard parts are. Running the same problem on Oracle's package and reporting the difference honestly is the most credible thing an ex-MongoDB person can bring into that building.

## Stack and setup

Python for the agent and the labs, since that is what the package ships and what Anant's workshops use. Next.js with MUI for the dashboard, talking to Oracle through node-oracledb. Jupyter notebooks as the lab format. Docker for the database.

What you need before writing code: Docker, Python 3.10 or newer, uv or pip, Node 20 or newer, an API key for whichever model you use for extraction and chat, and an embedding model. The package takes an embedder and an LLM at construction, so both are pluggable.

The database is Oracle Database Free in a container. Oracle's own agent memory demo repo uses the gvenzl/oracle-free image as the local substrate for the package, so start there rather than hunting for an image yourself. Create a dedicated application user for the demo so the managed agent memory schema does not land in the SYSTEM tablespace.

Install the package with a pinned version rather than latest, because the version moves and your labs need to stay reproducible. Then build the client with an embedder, an LLM, and a session pool, and confirm you can create a thread and add a message before anything else.

One setup detail worth knowing early: in managed schemas there is no default retention period on messages and memories. That matters for the retention lab later, and it is the kind of thing a field engineer will get asked about.

Repo layout to start with: `infra/` for the compose file and init SQL, `agent/` for the instrumented client and the scripted conversations, `labs/` for the notebooks, `web/` for the Next.js app, and `docs/` for the README and the friction log.

## Phase 0: inspect before you design

Do not design the dashboard against guessed table names. I do not know the package's actual schema, and neither does any model you hand this to. The first real task is to let the package create its schema, then read it.

Run a tiny script that creates a thread, adds a few messages, stores one memory, and runs one retrieval. Then dump the schema for that user: every table with its columns and types, primary and foreign keys, indexes including any vector indexes, and row counts. Save the dump to `docs/schema-snapshot.md` and commit it. That file is your contract for everything downstream, and it is also the artifact that tells Richmond you read the implementation rather than the blog post.

While you are in there, answer five questions in writing. Where do raw messages live, and where do durable memories live? How are user, agent, and thread scope stored, as columns or as a separate scope table? Where are the embeddings, inline or in a chunk table? What timestamps exist on a memory, created and updated or only created? And does a retrieval score come back from the API, or would you have to compute similarity yourself to show it?

That last question decides how much of the dashboard's retrieval view you can build from the package alone. If scores are not returned, you record them in your own run log instead.

Rerun this inspection whenever you bump the package version. Schema drift between versions is exactly the kind of thing the team will want flagged.

## Data model

Three layers. The package owns the first. You own the second and third, and they are what make the dashboard worth looking at.

Layer one is the package's managed schema: threads, messages, durable memories, and the vector or chunk data behind them. You never write to it directly. Instead build read-only views over it that give the app a stable shape regardless of version churn. A thread view with thread id, user id, agent id, created time, message count, and last activity. A message view with message id, thread id, role, content, and timestamp. A memory view with memory id, content, the scope ids for user, agent, and thread, created time, updated time, and the score field if one exists.

Layer two is the run log, and it is the spine of the whole project. One row per lifecycle event, in your own table. Columns: event id, run id, turn number, stage, started at, duration in milliseconds, input summary, output summary, affected memory ids as JSON, scope used as JSON, token counts where available, and an error field. Stage is a small enum drawn from the report's lifecycle: ingestion, extraction, consolidation, retrieval, summarization, and revision. Add an `other` value so an unexpected event still lands somewhere.

Layer three is the per-turn snapshot, which lets the UI replay a conversation. One row per turn: run id, turn number, the user message, the retrieved memory ids with their scores as JSON, the assembled prompt, its token count, a token count for flat history over the same conversation, the model reply, and the memory ids created, updated, or deleted as a result of the turn.

The flat-history token count is the one field people will argue about, so compute it honestly and write down your method. Count the tokens you would have sent if you passed every prior message verbatim, using the same tokenizer as the real call.

Keep all three layers in Oracle. A memory demo that needs a second database to explain itself is a harder sell inside Oracle, and the point of the project is that this is a database problem. Use JSON columns for the flexible fields so you are not migrating the run log every time you add a stage.

## Instrumentation

Two capture paths, because neither alone gives you the full picture.

The first is logging. The package emits diagnostics through standard Python logging under the logger name `oracleagentmemory`, and it configures no handlers or levels itself. Attach your own handler that parses those records into run log rows. Set the level to debug during development so you can see what the package considers worth saying.

The second is a wrapper. Write a thin class around the memory client that records every call: which method, the arguments, the result, the elapsed time, and the run and turn it belongs to. Every public call you use in the labs goes through it. This is where you catch what logging does not tell you, like exactly which memory ids came back from a retrieval and in what order.

Give every conversation a run id and every exchange a turn number, and thread both through the wrapper. Without that, the scrubber in the UI has nothing to scrub.

Write events append-only and never block the agent on a failed write. If the run log write fails, log it and carry on. An instrumentation bug should not break the demo mid-workshop.

One design rule worth holding: the wrapper observes, it does not reimplement. If you find yourself computing what the package should have returned, write that down in the friction log instead. Those notes are the product feedback that makes this project useful to the team rather than just impressive.

## Dashboard

Four screens. Resist adding a fifth.

The thread view is the one people will remember. Conversation on the left, the memories that existed at that point on the right, and a scrubber across the top to step turn by turn. As you move, memories appear, get highlighted when retrieved, and gray out when revised or removed. Watching a memory get created at turn 6, retrieved at turn 31, and rewritten at turn 47 makes the argument better than any slide.

The memory view is a table of durable memories with scope chips for user, agent, and thread, the turn each was created, when it was last touched, how many times it has been retrieved, and its full content on expand. Sort by retrieval count to show which memories actually earn their keep.

The lifecycle view takes one turn and lays its stage events out as a horizontal strip with durations, plus what each stage produced. This is the screen that teaches the lifecycle, and the one Richmond will recognize from his own framing.

The cost view carries the token chart: input tokens per turn for scoped retrieval against flat history, plotted at every turn, with retrieval latency underneath. Label your own numbers clearly and cite the report's figures separately rather than implying you reproduced them.

Routes: `/runs` for the list, `/runs/[id]` for the thread view with the scrubber, `/runs/[id]/turn/[n]` for the lifecycle view, `/memories` for the memory table, and `/runs/[id]/cost` for the chart. Server components for reads, API routes only where the page needs to poll.

Read from the views you built in layer one, never from the package's tables directly, and never write to package tables from the web app. The dashboard is an observer. Keep a single connection pool module so you are not opening pools per request.

Build it read-only first. A control to trigger a new turn from the UI is tempting and it can wait until the labs work.

## Lab sequence

Five notebooks. Each one ends by sending the learner to the dashboard to see what they just did.

Lab one, environment and first memory. Container up, package installed, embedder and LLM configured, pool open. Create a thread, add messages, store a memory. The payoff is seeing their own rows in the dashboard, which also proves this is real database state and not a hidden service.

Lab two, extraction and scope. Feed a conversation holding a durable preference, a one-off detail, and a fact the user corrects mid-conversation. Let automatic extraction run, then examine what became durable. The discussion question is what should have been kept and was not. Then add a second user and show that retrieval stays inside its boundary. Scope control across users, agents, and threads is a core claim in the report, and this is where a learner feels it.

Lab three, retrieval quality. Same store, different queries. Show a clean hit, a near miss, and a case where the top result is wrong. Have the learner change the search scope and watch the results move. This lab teaches judgment rather than API calls, and it is the one that will earn respect from advanced developers.

Lab four, revision and retention. Contradict an earlier fact and see what the system does with it. Set time to live on messages and memories through the retention config or per record, then watch data age out. Finally delete a thread and confirm the cascade took the messages, durable memories, and managed vector or chunk data with it. Governance is what enterprise buyers ask about and what most memory demos skip, so this lab is your differentiator with the field.

Lab five, the cost argument. Run one long conversation twice, flat history against scoped retrieval, and plot input tokens at turns 10, 40, and 80. The report puts scoped memory near 1,300 input tokens per request at turn 80 against roughly 13,900 for flat history. Your numbers will differ. Say so in the notebook and let the learner compute their own ratio.

Optional sixth for the field: a five-minute scripted walkthrough on seeded data with no setup, written for an account cloud engineer who has to explain this on a call. Ask Anant whether he wants it before you build it.

Write every notebook so a learner can start at lab three without having run one and two, using seeded data. Workshop attendees arrive late.

## Build order

Five milestones, each one shippable on its own.

Milestone one is the walking skeleton: container running, package installed, a scripted support conversation completing, and the schema snapshot committed. Nothing visual yet. You should be able to finish this in an evening.

Milestone two is the thread view reading real rows, even without the scrubber. This is the first thing worth showing anyone. Send it to Richmond here rather than waiting for the full set.

Milestone three is the run log and the wrapper, which unlocks the lifecycle view and the scrubber. Everything downstream depends on this, so do not skip ahead to the charts.

Milestone four is labs one through three plus the memory view. At this point you have something Anant could actually drop into a workshop.

Milestone five is the cost view with lab five, then revision and retention as lab four. Retention goes last because it is the most involved and the least necessary for the first demo.

Put it behind a short URL like you did with the Northwind course, with a README that says what you built, what surprised you, and what you would change. Cap any hosted model spend the same way, so people can try it without setup.

The discipline that matters: do not start milestone three before two is shareable. The value of this project is that it exists and works, not that it is complete.

## Friction log

Keep `docs/friction.md` open the whole time and write in it as things happen, not afterward. Timestamp each entry, describe what you tried, what you expected, and what happened. This file is half the value of the project.

Track the time to first memory from an empty machine. That number is the single most useful developer experience metric you can hand this team, and you already use time to value as a framework. Break it into discovery, setup, implementation, integration, and production so the number points at a specific stage.

Note anything you had to read source or guess at because the docs did not say. Note error messages that did not tell you what to fix. Note defaults that surprised you, starting with retention. Note every place your wrapper had to compute something the API should have returned.

Write the summary as observations rather than complaints, with a suggested fix for each. Three specific fixes with reproduction steps land better than a page of critique, and they give Matt something to take to the product managers he already has access to.

## Open questions and what not to build

Things I do not know and you will answer in phase 0: the package's actual table and column names, whether retrieval returns a score you can display, how consolidation decides what merges, and which package version to pin. Do not let a coding agent invent answers to these. Have it inspect and report.

Two things to leave alone. Do not rebuild the DeepLearning.AI course in different clothes, because it exists, Richmond co-created it, and a parallel version reads as competition. And do not build the harness engineering and observability workshop, because Anant is mid-build on it. If your lifecycle view fits his workshop, offer it as a contribution rather than shipping a rival.

Decided: this stays a personal work sample. You build it on your own time and share it when a milestone is worth showing, which keeps it yours while the offer is pending and keeps the friction log honest. Two things follow. Keep the repo and the hosted demo under your own account and name, and license it so you could hand it over later without untangling anything. And when you share a milestone with Richmond or Anant, frame it as something you built to learn the package, not as a deliverable you are proposing the team adopt. If they ask to fold it in, that is a good problem and a better conversation to have after they have seen it work.

What to hand a coding agent first: this doc, then phase 0 only. Let it produce the schema snapshot and the five written answers before it writes a line of the dashboard. Everything after that is easier once the schema is known, and anything built before it will be wrong.
