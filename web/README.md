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
- Routes: `/runs` (thread list) and `/runs/[id]` (conversation plus memories).
