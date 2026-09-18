# web: the inspector dashboard

Next.js 16 (App Router) + MUI 9, reading Oracle through `oracledb` in thin mode.
Read-only by construction: it logs in as `AIM_WEB`, which can only SELECT the
`AIM_V_*` views (`agent/scripts/check_web_grants.py` proves it).

```bash
cp .env.example .env.local   # AIM_WEB_PASSWORD comes from infra/.env
npm install
npm run dev                  # http://localhost:3000
```

- `src/lib/db.ts` is the one connection pool. Every query calls `connection()` first, so nothing reads the database at build time.
- `src/lib/queries.ts` names views only, never package tables.
- `src/lib/memoryState.ts` rebuilds memory as it was at turn n from the run log's per-turn diffs, because the memory table only holds the latest content and forgets deleted rows. It's pure; `npm test` runs it under plain `node --test`.
- Routes:
  - `/runs`: the thread list, with turn counts where a run log exists.
  - `/runs/[id]`: for threads with a run log, the scrubber plus a right pane with two views:
    - memory at turn n: new, retrieved (rank and distance), revised (before and after), removed
    - "why": every search result for turn n, whether it went into the prompt, where it was created, and the prompt the model saw
  - Threads without a run log get the M2 view.
- URL state: `?turn=n` (missing or invalid means the last turn), `view=why`, `expired=1`. Every state is a shareable link. ←/→ step through turns.
