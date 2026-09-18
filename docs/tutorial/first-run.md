# First run: from a clean machine to "why did it say that?"

In about 20 minutes you'll have Oracle AI Agent Memory running in a container, four recorded conversations, and a dashboard. You'll use it to find out why an agent said it didn't know a user's contact preference when the preference was sitting in its memory. Along the way you'll see the three things this project is made of: recorded turns, the "why" view, and the health check.

## What you'll need

- Docker, and about 3 GB of disk for the database image.
- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you) and Node 20 or newer.
- [Ollama](https://ollama.com) with the embedding model: `ollama pull nomic-embed-text`.
- An Anthropic API key. Extraction and the health check call Claude, so a full seed costs a few dozen LLM calls.

## Step 1: Start the database

From the repo root, copy the example settings and set four passwords (any values you like), then start the container:

```bash
cp infra/.env.example infra/.env      # set ORACLE_PASSWORD, AIM_APP_PASSWORD, AIM_WEB_PASSWORD, AIM_LIVE_PASSWORD
cp agent/.env.example agent/.env      # set ANTHROPIC_API_KEY
docker compose -f infra/docker-compose.yml up -d
docker ps --filter name=aim-oracle --format '{{.Status}}'
```

After about 10 seconds you'll see `Up … (healthy)`. On first boot the container created three database users: `aim_app` (demo data), `aim_live` (your real conversations, later) and `aim_web` (the dashboard's read-only login).

## Step 2: Record four conversations

```bash
cd agent && uv sync
uv run python scripts/seed.py --reset
uv run python scripts/apply_sql.py
```

`seed.py` replays four scripted support conversations through the companion agent, one exchange at a time, the way a real agent writes. It takes about four minutes, because every exchange runs the package's extraction, and each of those is an LLM call. You'll see a table per conversation:

```
support_01  aim_app  user u_alice  thread 8f54048d-…
  turn  retrieved  prompt tok  flat tok  created  updated  deleted   secs
     1         10         342       163        2        0        0    6.8
     2         10         406       219        3        0        0   11.2
     3         10         463       300        4        0        0   10.6
...
health check 8: 4 crowded_turn, 5 duplicate, 2 scope_mismatch, 6 superseded, 6 transient
```

Look at the `updated` column: always 0. In turn 3 the user corrected a fact, and the package created new memories instead of updating the old one. Remember that for step 4.

`apply_sql.py` installs the read-only views the dashboard reads and grants them to `aim_web`. Run it after every `--reset`.

## Step 3: Open the dashboard and find the miss

```bash
cd ../web && cp .env.example .env.local     # set AIM_WEB_PASSWORD to the value from infra/.env
npm install && npm run dev
```

In another terminal, print today's links (thread ids change with every seed):

```bash
cd agent && uv run python scripts/demo_links.py
```

Open the **"Why that reply"** link under *The miss (support_03)*.

You're looking at one turn. Alice asked *"Which region is my export bucket in, and how should you contact me?"*. On the right is everything memory search returned for that question, ranked, with its cosine distance, and marked "in prompt" for the five the agent put in front of the model. Some carry badges: **transient** (a question the assistant asked weeks ago, stored as if it were a fact), **stale** (the bucket region she later corrected), **duplicate**.

Now look for her contact preference, "email only, never by phone". It isn't in the top five, and probably isn't in the top ten. That's why the agent, in a live run, said it had nothing on file. The model wasn't wrong. Memory handed it the wrong five things.

## Step 4: Follow the stale fact to where it came from

On the **stale** result, click **"created in an earlier conversation: … turn 2"**. You land on the support_01 conversation at turn 2, with the **Memory at turn 2** tab open. The memory "…bucket … in the us-east-1 region" has a green **created turn 2** chip.

Press **→**. At turn 3 the user says "Actually wait, the bucket is in us-west-2." Watch the memory panel. A new memory about us-west-2 appears, and the us-east-1 one is still there, unchanged. That's the `updated: 0` from step 2, made visible: the package appends corrections, it never applies them.

Click **Why (turn 3)**. The search the agent ran for the correction message returned the stale fact at or near the top, and put it in the prompt.

## Step 5: See the whole store at once

Open **Memory** in the top bar (`/memories`). This is the health check the seed ran at the end. It found these problems across every memory without anyone clicking through turns:
- **Crowded prompt:** each conversation where junk took prompt slots. The support_03 turn is one of them.
- **Superseded:** the us-east-1 fact among them, with the judge's reasoning and the exact `delete_memory` call to fix it.
- **Duplicate:** the same preference stored up to three times.
- **Transient:** "the assistant asked…; awaiting reply" memories, with the extraction instruction that stops new ones.

Switch to **All memories**. It's sorted by how often search returned each memory. Look at which ones are flagged near the top.

## Step 6 (optional): Ask it yourself

```bash
cd companion && uv sync
uv run companion --db-user aim_app --user-id u_alice
```

Type *Which region is my export bucket in, and how should you contact me?*, wait for `remembered in …s`, then type `/why`. It's the same view as the dashboard, in the terminal. Then ask *How should you contact me?* on its own, and `/why` again. The preference comes back near the top. A question about two things gets one embedding that lands between them.

Type `/quit` when you're done. Without `--db-user`, the companion writes to `aim_live`, your private schema for real use.

## What you built

A running memory store with four instrumented conversations, and a dashboard that answers "why did it say that?" for every reply. You've seen:
- **Recorded turns:** what search returned, what went into the prompt, and what memory changed, every turn.
- **Memory over time:** the scrubber rebuilds memory as it was at any turn, including memories that were later deleted.
- **The health check:** stale, duplicate and transient memories found across the whole store, with evidence and a fix.

Next:
- [How it works](../explanation/how-it-works.md): what happened under the hood in each step.
- [Demo guide](../how-to/demo.md): this same story as a 5-minute demo.
- The labs (`labs/`): fix these problems yourself, in code.
- [Instrument your own agent](../how-to/instrument-your-agent.md).

## If something goes wrong

| at step | symptom | fix |
|---|---|---|
| 1 | not healthy after a minute | `docker logs aim-oracle`. Usually a missing password in `infra/.env`. |
| 2 | hangs, then an embedding error | Ollama isn't running, or `nomic-embed-text` isn't pulled |
| 2 | `Missing credentials` | `ANTHROPIC_API_KEY` isn't set in `agent/.env` |
| 3 | "database unreachable" | `AIM_WEB_PASSWORD` in `web/.env.local` doesn't match `infra/.env` |
| 3 | pages error after a reseed | run `apply_sql.py` |
| 3 | `demo_links.py` says a moment didn't reproduce | reseed (extraction varies), or follow its suggestion |

More in [operate and troubleshoot](../how-to/operate.md).
