// node --test tests/  (Node 23.6+ strips the TypeScript types itself)
import assert from "node:assert/strict";
import { test } from "node:test";

import { memoryStateAt, parseTurn, promptLabel, retrievalsByRecord, turnByMessage } from "../src/lib/memoryState.ts";

const turn = (n, diff = {}, extra = {}) => ({
  turn: n,
  started_at: new Date(2026, 8, 18, 3, n),
  memory_diff: { created: [], updated: [], deleted: [], ...diff },
  retrieved: [],
  message_ids: [],
  ...extra,
});
const row = (id, content, type = "fact") => ({ memory_id: id, memory_type: type, content });

// The stale-correction story: us-east-1 at turn 2, correction at turn 3,
// a revision at 4, a delete at 5.
const turns = [
  turn(1),
  turn(2, { created: [{ id: "east", type: "fact", content: "bucket in us-east-1" }] }),
  turn(3, { created: [{ id: "west", type: "fact", content: "bucket in us-west-2" }] }, {
    retrieved: [
      { search: 1, rank: 1, record_id: "east", record_type: "fact", distance: 0.21, thread_id: "t", in_prompt: true },
      { search: 1, rank: 2, record_id: "pref", record_type: "preference", distance: 0.5, thread_id: "t", in_prompt: false },
    ],
  }),
  turn(4, { updated: [{ id: "west", type: "fact", before: "bucket in us-west-2", after: "bucket in us-west-2 (confirmed)" }] }),
  turn(5, { deleted: [{ id: "east", type: "fact", content: "bucket in us-east-1" }] }),
];
const current = [row("pref", "email only", "preference"), row("west", "bucket in us-west-2 (confirmed)")];

const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));

test("memories created after turn n are hidden", () => {
  const at1 = byId(memoryStateAt(current, turns, 1));
  assert.deepEqual(Object.keys(at1).sort(), ["pref"]);
  assert.equal(at1.pref.createdTurn, null, "pre-existing memories have no created turn");
});

test("new this turn, and retrieved with rank and distance", () => {
  const at3 = byId(memoryStateAt(current, turns, 3));
  assert.equal(at3.west.newNow, true);
  assert.equal(at3.east.newNow, false);
  assert.equal(at3.east.retrieval.rank, 1);
  assert.equal(at3.east.retrieval.distance, 0.21);
  assert.equal(at3.pref.retrieval.rank, 2);
  assert.equal(at3.west.retrieval, null);
});

test("content is shown as it was at turn n, not as it is now", () => {
  assert.equal(byId(memoryStateAt(current, turns, 3)).west.content, "bucket in us-west-2");
  const at4 = byId(memoryStateAt(current, turns, 4));
  assert.equal(at4.west.content, "bucket in us-west-2 (confirmed)");
  assert.equal(at4.west.revisedNow, true);
  assert.deepEqual(at4.west.revisions.map((r) => r.turn), [4]);
});

test("deleted memories stay visible, marked removed, even though the table forgot them", () => {
  const at4 = byId(memoryStateAt(current, turns, 4));
  assert.equal(at4.east.removedTurn, null);
  const at5 = byId(memoryStateAt(current, turns, 5));
  assert.equal(at5.east.removedTurn, 5);
  assert.equal(at5.east.removedNow, true);
  assert.equal(at5.east.row, null);
  assert.equal(at5.east.content, "bucket in us-east-1");
});

test("ordering: pre-existing first, then by created turn", () => {
  assert.deepEqual(memoryStateAt(current, turns, 5).map((m) => m.id), ["pref", "east", "west"]);
});

test("a memory revised before it was ever seen created starts from its before content", () => {
  const t = [turn(1, { updated: [{ id: "old", type: "fact", before: "v1", after: "v2" }] })];
  assert.equal(byId(memoryStateAt([row("old", "v2")], t, 1)).old.content, "v2");
  assert.equal(byId(memoryStateAt([row("old", "v2")], [turn(1), ...t.map((x) => ({ ...x, turn: 2 }))], 1)).old.content, "v1");
});

test("best-ranked retrieval wins when a record comes back from two searches", () => {
  const t = turn(1, {}, {
    retrieved: [
      { search: 2, rank: 1, record_id: "a", distance: 0.1, in_prompt: null },
      { search: 1, rank: 3, record_id: "a", distance: 0.4, in_prompt: null },
    ],
  });
  assert.equal(retrievalsByRecord(t).get("a").search, 1);
});

test("labels never claim more than the agent reported", () => {
  assert.equal(promptLabel({ in_prompt: true }), "in prompt");
  assert.equal(promptLabel({ in_prompt: false }), "also returned");
  assert.equal(promptLabel({ in_prompt: null }), "returned by search");
});

test("messages map to the turn that wrote them", () => {
  const m = turnByMessage([turn(1, {}, { message_ids: ["u1", "a1"] }), turn(2, {}, { message_ids: ["u2", "a2"] })]);
  assert.equal(m.get("a2"), 2);
  assert.equal(m.get("nope"), undefined);
});

test("?turn= parsing clamps and defaults to the last turn", () => {
  assert.equal(parseTurn(undefined, 7), 7);
  assert.equal(parseTurn("3", 7), 3);
  assert.equal(parseTurn("0", 7), 1);
  assert.equal(parseTurn("99", 7), 7);
  assert.equal(parseTurn("abc", 7), 7);
  assert.equal(parseTurn(["2", "5"], 7), 2);
});
