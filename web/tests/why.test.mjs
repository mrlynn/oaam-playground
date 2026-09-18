// node --test tests/  (Node 23.6+ strips the TypeScript types itself)
import assert from "node:assert/strict";
import { test } from "node:test";

import { memoryStateAt } from "../src/lib/memoryState.ts";
import { whyRows, whySummary } from "../src/lib/why.ts";

const hit = (search, rank, record_id, extra = {}) => ({
  search, rank, record_id, record_type: "fact", distance: 0.1 * rank, thread_id: "t1", in_prompt: true, ...extra,
});
const turns = [
  { turn: 1, memory_diff: { created: [{ id: "m1", type: "fact", content: "bucket in us-east-1" }], updated: [], deleted: [] }, retrieved: [] },
  {
    turn: 2,
    memory_diff: { created: [], updated: [{ id: "m1", type: "fact", before: "bucket in us-east-1", after: "bucket in us-west-2" }], deleted: [] },
    retrieved: [hit(2, 1, "x9", { record_type: "message" }), hit(1, 2, "gone"), hit(1, 1, "m1")],
  },
];
const findings = [{ finding_id: 7, kind: "superseded", title: "stale", evidence: { stale: "m1" }, memory_ids: ["m1", "m2"] }];

test("rows come in search then rank order, with content as of the turn, origin and badges", () => {
  const state = memoryStateAt([], turns, 1);
  const rows = whyRows({
    turn: turns[1],
    state,
    memories: [{ memory_id: "m1", content: "bucket in us-west-2", thread_id: "t1" }],
    messages: [{ message_id: "x9", content: "raw chunk", thread_id: "t2" }],
    origins: [{ memory_id: "m1", run_id: "t1", turn: 1 }],
    findings,
  });
  assert.deepEqual(rows.map((r) => r.record_id), ["m1", "gone", "x9"]);
  assert.equal(rows[0].content, "bucket in us-east-1"); // as of turn 1's state, not the current row
  assert.deepEqual(rows[0].origin, { runId: "t1", turn: 1 });
  assert.deepEqual(rows[0].badges.map((b) => b.label), ["stale"]);
  assert.equal(rows[1].gone, true);
  assert.equal(rows[2].content, "raw chunk");
  assert.equal(rows[2].storedThread, "t2");
});

test("the summary says what was reported, and nothing more", () => {
  assert.match(whySummary([]), /didn't search/);
  assert.equal(whySummary([hit(1, 1, "a"), hit(1, 2, "b", { in_prompt: false })]), "2 results from 1 search; 1 went into the prompt.");
  assert.match(whySummary([hit(1, 1, "a", { in_prompt: null })]), /didn't report/);
});
