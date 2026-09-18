// node --test tests/  (Node 23.6+ strips the TypeScript types itself)
// The committed export, run through the dashboard's own functions, the same
// way the replay runs it. A shape change in web/src/lib breaks this before it
// breaks the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkMoments, reviveDates } from "../../web/src/lib/demoExport.ts";
import { compareRuns } from "../../web/src/lib/findings.ts";
import { producedBy, stageTotals, waterfall } from "../../web/src/lib/lifecycle.ts";
import { memoryStateAt } from "../../web/src/lib/memoryState.ts";
import { whyRows } from "../../web/src/lib/why.ts";

const demo = JSON.parse(readFileSync(new URL("../src/data/demo.json", import.meta.url), "utf8"), reviveDates);

test("every required demo moment reproduces in the committed export", () => {
  for (const m of checkMoments(demo)) {
    if (m.required) assert.ok(m.ok, `${m.name}: ${m.detail}`);
  }
});

test("the export holds the scripted seeds only", () => {
  assert.equal(demo.manifest.schema, "AIM_APP");
  const users = new Set([...demo.memories.map((m) => m.user_id), ...demo.conversations.map((c) => c.run.user_id)]);
  assert.deepEqual([...users].sort(), ["u_alice", "u_bob"]);
  assert.deepEqual(demo.conversations.map((c) => c.key), ["onboarding_01", "support_01", "support_02", "support_03"]);
});

test("dates come back as Dates", () => {
  assert.ok(demo.conversations[0].turns[0].started_at instanceof Date);
  assert.ok(demo.conversations[0].events[0].started_at instanceof Date);
});

test("every turn of every conversation replays", () => {
  const messages = [...demo.conversations.flatMap((c) => c.messages), ...demo.extraMessages];
  for (const c of demo.conversations) {
    const mine = demo.memories.filter((m) => m.thread_id === c.thread.thread_id);
    for (const t of c.turns) {
      const state = memoryStateAt(mine, c.turns, t.turn);
      const rows = whyRows({ turn: t, state, memories: demo.memories, messages, origins: demo.origins, findings: demo.findings });
      assert.equal(rows.length, (t.retrieved ?? []).length, `${c.key} turn ${t.turn}: one why row per search result`);
      assert.ok(rows.every((r) => r.content !== null), `${c.key} turn ${t.turn}: every result has content`);
      const events = c.events.filter((e) => e.turn === t.turn);
      assert.ok(events.length > 0, `${c.key} turn ${t.turn}: has lifecycle events`);
      const wf = waterfall(events);
      for (const s of stageTotals(events, wf.totalMs)) assert.ok(producedBy(s.stage, t, events).length > 0);
    }
  }
});

test("findings compare against the previous check when there is one", () => {
  const cmp = compareRuns(demo.findings, demo.previous);
  assert.equal(cmp.status.size, demo.findings.length);
  assert.equal(cmp.compared, demo.previous !== null);
});
