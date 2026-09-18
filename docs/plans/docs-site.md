# Docs site plan: a public site with a replay you can click

2026-09-18. Builds on milestone 4 (`492021c` docs, `f49dc68` README). Not started. It waits on the one open M4 item (see "Before this starts").

## Why this milestone

The moment that sells this project is a bad reply, then "why did it say that?", then the stale fact that caused it, with the finding that says to delete it. Today nobody sees that moment without Docker, Oracle, Ollama, an Anthropic key and four minutes of seeding. That's a lot to ask of someone who clicked a link.

The docs have the same problem from the other side. They're good and they're organized, but they're markdown in a repo, and the published pages are private to one account. Anyone outside gets the GitHub file view.

A Docusaurus site over `docs/` fixes the second problem cheaply. The reason to build it is the first problem. One React component replays a real seeded conversation from exported JSON, with no database: the scrubber, "memory at turn n", and the "why" pane with its badges. That turns the docs into a demo. Everything else on the site is the markdown we already have.

## Goal

Done means:
- A public site on GitHub Pages, built from `docs/` with no copies of any doc.
- The landing page opens on a working replay of a seeded conversation. A visitor can step turns, open "why" on any reply, and follow a badge to its finding, all without installing anything.
- The replay shows the same thing the dashboard shows at the same turn, for every demo moment in the demo guide.
- The replay data is exported from `aim_app` by a script that refuses any other schema and refuses to export a seed where a demo moment didn't reproduce.
- Every markdown file still reads correctly on GitHub. No JSX goes into `docs/`.
- CI builds the site on every push to `main` and fails on a broken link.

## Before this starts

The last M4 item comes first: use the companion for real for a few days, run `check.py --user aim_live`, and write down what the findings got wrong. A public site makes claims about what the health check finds. Those claims should be checked against real data before they're published, and if the real run changes the check, the docs change with it.

## Facts this plan rests on (checked 2026-09-18)

| fact | consequence |
|---|---|
| `web/src/lib/memoryState.ts`, `findings.ts` and `lifecycle.ts` are pure and have no runtime imports. They already run under plain `node --test`. | The replay can import the dashboard's own logic. "Memory at turn n", badges and the waterfall layout get computed by the same code in both places, so they can't disagree. |
| `memoryState.ts` and `findings.ts` import the `MemoryRow` type from `queries.ts`, which imports `server-only` and the database pool | It's a type-only import and gets erased, but it's fragile. Move `MemoryRow` (and `MemoryType`) into `runTypes.ts` first, and have `queries.ts` re-export them. |
| The dashboard's components use MUI and link to Next routes | Don't port them. Write small replay components against Docusaurus's own theme variables, and share the logic, not the markup. |
| The dashboard reads everything through the `AIM_V_*` views as `aim_web` | The export can do the same. If it reads as `aim_web`, it can't contain anything the dashboard can't already show. |
| Docusaurus 3 parses `.md` as MDX by default. Several docs have `{...}` and `<...>` inside code spans and tables. | Set `markdown.format: "detect"` so `.md` files are parsed as plain CommonMark. Components live only in `.mdx` files under `site/`. |
| Six links in `docs/` point outside it: three in `docs/README.md` (the `inspector`, `companion` and `labs` READMEs) and three in `docs/how-to/demo.md` (the lab notebooks) | The site build would fail on them. Rewrite those six to GitHub URLs at build time with a small remark plugin, so the source files stay as they are. |
| `demo_links.py` already works out whether each demo moment reproduced in the current seed | The exporter reuses that check. A seed where extraction didn't produce the stale fact doesn't get published. |
| GitHub Pages on a free account needs a public repo | Making `mrlynn/oaam-playground` public is a decision, not a side effect of this plan (open question 1). |

## Decisions

| decision | choice | why |
|---|---|---|
| Where the site lives | `site/` at the repo root, with the docs plugin pointed at `../docs` | One copy of every doc. The site is a view over the repo, like the dashboard is a view over the database. |
| Export shape | The same row types the dashboard gets from `queries.ts` (`RunRow`, `TurnRow`, `MessageRow`, `MemoryRow`, `FindingRow`, `CheckRunRow`, `EventRow`), plus a small manifest | The shared pure functions take them unchanged, and a type change in the dashboard shows up as a type error in the site. |
| What gets exported | All four seeded conversations, their latest check run, and lifecycle events for the turns the demo guide names | It's small (estimate under 1 MB), and it lets the site show the stale correction, the duplicates and the crowded turn, not just one of them. |
| Where the export lives | Committed JSON at `site/src/data/demo.json` | CI has no Oracle. The site has to build from the repo alone. |
| Components | `<TurnReplay conversation="support_03" />`, `<Lifecycle conversation="…" turn={n} />`, `<Finding id="…" />` | These are the three things the markdown can't show. Anything else is text. |
| Styling | Docusaurus's Infima variables, light and dark | It matches the rest of the site, and dark mode comes for free. |
| Hosting | GitHub Pages through a GitHub Actions workflow | Free, next to the code, and no extra accounts. |
| The published artifact pages | Keep them as private share copies until the site is live, then stop updating them | Three copies of the docs would drift. The site becomes the link to send. |

## Steps

### 1. Export (`agent/scripts/export_demo.py`)

- Connect as `aim_web` with the password from `infra/.env`, and read `AIM_APP` views only. Refuse any other schema, the same way `seed.py --reset` refuses anything but `aim_app`.
- Run the `demo_links.py` checks first. If any demo moment didn't reproduce, stop and say which one. Don't write a partial export.
- Write `site/src/data/demo.json`: a manifest (export time, git sha, package version, check run id, models), then the rows per conversation.
- Print the file size and the conversations and turns it wrote.

### 2. Share the logic

- Move `MemoryRow` and `MemoryType` from `queries.ts` into `runTypes.ts`, with a re-export from `queries.ts`. The web tests and build have to stay green.
- Point the site at `web/src/lib` with a webpack alias (`@inspector/lib`), and import only the pure files.
- Add a site test that loads the committed `demo.json` through `memoryState`, `findings` and `lifecycle` and checks the demo moments come out right: the stale bucket fact badged in `support_03`, and the crowded turn found.

### 3. Docusaurus over `docs/`

- Scaffold `site/` with the TypeScript template. Docs plugin `path: "../docs"`, `routeBasePath: "/docs"`, `markdown.format: "detect"`, `onBrokenLinks: "throw"`.
- The sidebar follows the doc types: Tutorial, How-to, Explanation, Reference, then "What we learned" (friction, token method, phase 0 answers, schema snapshot), then "How it was built" (the plans).
- `docs/README.md` becomes the docs landing page.
- A remark plugin rewrites the six links that leave `docs/` to `https://github.com/mrlynn/oaam-playground/blob/main/...`.
- `editUrl` points at the repo, so every page has "edit this page".

### 4. The replay components (`site/src/components/`)

- **`TurnReplay`**: a scrubber (slider, step buttons, ← and →), the conversation with the current turn outlined and later turns dimmed, and two tabs: "memory at turn n" and "why". Badges link to the finding on the same page. On phones "why" sits above the conversation, as in the dashboard.
- **`Lifecycle`**: the waterfall and stage cards for one turn, from `lifecycle.ts`, with the dashboard's stage colours.
- **`Finding`**: one finding card: severity, kind, title, evidence, suggested fix.
- A **landing page** (`site/src/pages/index.mdx`): two sentences on what this is, then `TurnReplay` open on the turn where the stale fact reaches the prompt, then three links: see it work, add it to your agent, what we learned.
- A **"Try it"** page (`site/src/pages/replay.mdx`) with all four conversations and a short walk through each demo moment, written from the demo guide.
- Every component says plainly that it's a recorded replay from a seeded run, with the export date. It never implies a live connection.

### 5. Deploy

- `.github/workflows/site.yml`: on push to `main` when `docs/**`, `site/**` or `web/src/lib/**` change. Install, run the site test, build, and deploy to Pages.
- The same workflow runs `npm test` in `web/`, since the site now depends on `web/src/lib`.
- `baseUrl: "/oaam-playground/"`.

### 6. Docs

- Link the site at the top of the root `README.md` and `docs/README.md`.
- `docs/how-to/operate.md`: after a reseed, run `export_demo.py` and commit the new `demo.json`, or the site keeps showing the old seed.
- `docs/reference/scripts-and-config.md`: add `export_demo.py`.
- An "As built" section in this plan.

## Verification

- `npm run build` in `site/` passes with `onBrokenLinks: "throw"`.
- For each demo moment in the demo guide, the replay at that turn matches the dashboard at the same turn: the same memories, the same retrieved results in the same order, the same badges. Check side by side on a fresh seed.
- `export_demo.py --user aim_live` (or any schema but `aim_app`) exits non-zero and writes nothing.
- With a seed where a moment didn't reproduce, the exporter stops and names the moment.
- Every file in `docs/` still renders correctly on GitHub.
- The replay works at phone width and in dark mode, and with the keyboard only.
- The site loads with the network tab showing no requests to anything but the site itself and its fonts.

## Out of scope

- A site that reads a live database. The replay is recorded, on purpose.
- Porting the MUI dashboard. It stays the tool you run. The site is the thing you send.
- Search beyond the built-in local search, versioned docs, translations, a blog.
- A custom domain (open question 3).
- Anything from `aim_live`. Real conversations never leave the machine.

## Risks

| risk | mitigation |
|---|---|
| The export and the dashboard drift apart as the run log changes | Shared row types and shared logic, plus the site test on the committed JSON. A shape change breaks the build instead of the page. |
| Extraction varies, so a new seed can lose a demo moment | The exporter refuses to write one. The old `demo.json` stays in place until a good seed exists. |
| The site goes stale after a reseed | It shows the export date on every replay, and the runbook says to re-export. A stale replay is still internally consistent, because it's one export. |
| MDX parsing breaks an existing doc | `format: "detect"` keeps `.md` as plain markdown. The build fails loudly if anything slips. |
| Making the repo public exposes something private | Before flipping it, rerun the history scan for keys and passwords (last run 2026-09-18: only `change_me_*` placeholders), and reread `docs/friction.md` and the plans with an outside reader in mind. |

## Effort

About a day of Claude Code time: an hour for the export, an hour for scaffolding and links, most of the rest on `TurnReplay`, and an hour on CI and docs. Checking the replay against the dashboard on a fresh seed is the part not to skip.

## Open questions for you

1. Make `mrlynn/oaam-playground` public? Pages needs it on a free account. The alternative is Netlify or Vercel from a private repo.
2. Which conversation opens the landing page? The default is `support_03`, where one "why" pane shows a transient, a stale and a near-duplicate memory crowding out the contact preference. `support_01` is simpler: one correction, one stale fact.
3. The default `mrlynn.github.io/oaam-playground` address, or a custom domain?
4. Retire the 11 published artifact pages once the site is live, or keep them as private share copies?

## As built

2026-09-18. Steps 1 to 4 are built, step 5 builds and tests but doesn't deploy, and step 6 is done. The `aim_live` check from "Before this starts" hasn't happened. Nothing is published, so no claim has gone out ahead of it.

### What changed from the plan

| plan | as built | why |
|---|---|---|
| Called milestone 5 | Renamed to this docs-site plan, off the milestone track | M5 was already the cost view and labs 4 and 5 (`docs/token-method.md`, the M3 and M4 plans). |
| Exporter in Python, `agent/scripts/export_demo.py` | Node, `web/scripts/export-demo.mts`, run with `npm run export-demo` | python-oracledb in thin mode can't read the run log's named time zones (DPY-3022). node-oracledb reads them, and it decodes every row exactly the way the dashboard does. |
| Reuse `demo_links.py`'s checks | `checkMoments()` in `web/src/lib/demoExport.ts` | `demo_links.py` reads base tables as the schema owner. The export reads views as `aim_web`, so the checks run on the exported rows instead, and the site test runs the same function on the committed file. |
| Move `MemoryRow` and `MemoryType` | Moved all four view row types (`ThreadRow`, `MessageRow`, `MemoryRow`, `MemoryType`) into `runTypes.ts` | The replay needs threads and messages too. |
| Share the logic that was already pure | Also pulled the logic out of three MUI files: the "why" rows (`why.ts`), what each stage produced and the span formatting (`lifecycle.ts`), and finding labels, roles and evidence lines (`findings.ts`) | Otherwise the replay would have had its own copy of the "why" pane's rules, which is exactly the drift this plan exists to prevent. The dashboard now calls the same functions. |
| Landing and replay pages in `.mdx` | `.tsx` | Both are mostly state and layout. Neither has prose that benefits from MDX. |
| `Lifecycle` beside the replay | A third tab in the replay: memory, why, lifecycle | One place to step turns for all three views. |
| Deploy on push | Build and test on push. Deploy only when the repo variable `PAGES_ENABLED` is `true`. | Open question 1 isn't answered, and a deploy job against a private repo would fail every push. |

### Checked

- **Export:** `npm run export-demo` finds all five moments in the current seed and writes 407 KB (4 conversations, 13 turns, 369 events, 32 memories, 17 findings). The support_03 prompt has 2 of its 5 slots badged (stale, transient). `--schema aim_live` exits 1 and writes nothing. The file holds only `u_alice` and `u_bob`, and a scan found no keys, passwords or real names.
- **Replay against the dashboard:** at support_03 turn 1, support_01 turn 2 and support_01 turn 3, the "why" rows match the running dashboard row for row: rank, type, distance, prompt label and badges. The memory view at support_01 turn 3 matches card for card.
- **Links:** the build passes with `onBrokenLinks`, `onBrokenAnchors` and broken markdown links all set to throw. The six links out of `docs/` go to GitHub.
- **Layout:** no horizontal scroll at 375 px, dark mode follows the system, ← and → step turns, and a cross-conversation link from the landing page opens `/replay` at that conversation and turn.
- **Tests:** web 25 (2 new, for `why.ts`) and site 5, plus lint, `tsc` and `next build` for the dashboard. The dashboard's pages render the same after the refactor.

## Still open

1. The `aim_live` check, before anything is published.
2. Open questions 1 to 4 above. Deploying needs question 1: make the repo public, turn on Pages with "GitHub Actions" as the source, then set `PAGES_ENABLED=true`.
3. Screenshots in `docs/` are still the M2 thread view. The replay makes most of them unnecessary on the site, but the GitHub README still uses one.
