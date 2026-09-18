import assert from "node:assert/strict";
import { test } from "node:test";

import { badgesByMemory, compareRuns, memoryStats, parseSort } from "../src/lib/findings.ts";

const f = (id, fingerprint, kind, extra = {}) => ({
  finding_id: id, check_run_id: 2, fingerprint, kind, severity: "high", user_id: "u",
  memory_ids: [], turns: [], title: `${kind} ${id}`, detail: null, suggestion: null, evidence: {}, method: "sql",
  ...extra,
});

test("new, open and resolved against the previous run", () => {
  const current = [f(1, "a", "superseded"), f(2, "b", "duplicate")];
  const previous = [{ fingerprint: "a", kind: "superseded", title: "old a" }, { fingerprint: "z", kind: "transient", title: "gone" }];
  const c = compareRuns(current, previous);
  assert.equal(c.status.get(1), "open");
  assert.equal(c.status.get(2), "new");
  assert.deepEqual(c.resolved.map((r) => r.fingerprint), ["z"]);
  assert.equal(c.compared, true);
});

test("with no previous run nothing is called new or resolved", () => {
  const c = compareRuns([f(1, "a", "superseded")], null);
  assert.equal(c.status.get(1), "open");
  assert.deepEqual(c.resolved, []);
  assert.equal(c.compared, false);
});

test("badges go on the memory the fix would delete", () => {
  const b = badgesByMemory([
    f(1, "a", "superseded", { memory_ids: ["east", "west"], evidence: { stale: "east", current: "west" } }),
    f(2, "b", "duplicate", { memory_ids: ["p1", "p2", "p3"], evidence: { keep: "p2" } }),
    f(3, "c", "transient", { memory_ids: ["asked"] }),
    f(4, "d", "crowded_turn", { memory_ids: ["east", "asked"] }),
  ]);
  assert.deepEqual(b.get("east").map((x) => x.label), ["stale"]);
  assert.equal(b.get("west"), undefined);
  assert.deepEqual(b.get("p1").map((x) => x.label), ["duplicate ×3"]);
  assert.equal(b.get("p2"), undefined);
  assert.deepEqual(b.get("asked").map((x) => x.label), ["transient"]);
});

test("one badge per label, even when two findings accuse the same memory", () => {
  const b = badgesByMemory([
    f(1, "a", "superseded", { memory_ids: ["east", "west"], evidence: { stale: "east" } }),
    f(2, "b", "superseded", { memory_ids: ["east", "west2"], evidence: { stale: "east" } }),
  ]);
  assert.deepEqual(b.get("east").map((x) => [x.label, x.findingId]), [["stale", 1]]);
});

test("memory stats merge retrievals, origins and badges, sorted by retrieval", () => {
  const mem = (id, day) => ({ memory_id: id, memory_type: "fact", content: id, created_at: new Date(2026, 8, day) });
  const rows = memoryStats(
    [mem("a", 1), mem("b", 2), mem("c", 3)],
    [{ record_id: "b", retrieved: 5, in_prompt: 3, last_retrieved: null }, { record_id: "c", retrieved: 5, in_prompt: 1, last_retrieved: null }],
    [{ memory_id: "a", run_id: "r1", turn: 2 }],
    new Map([["a", [{ label: "stale" }]]]),
  );
  assert.deepEqual(rows.map((r) => r.memory_id), ["b", "c", "a"]);
  assert.deepEqual(rows[2].createdIn, { runId: "r1", turn: 2 });
  assert.equal(rows[2].retrieved, 0);
  const byFindings = memoryStats([mem("a", 1), mem("b", 2)], [], [], new Map([["a", [{ label: "stale" }]]]), "findings");
  assert.equal(byFindings[0].memory_id, "a");
});

test("sort parsing", () => {
  assert.equal(parseSort(undefined), "retrieved");
  assert.equal(parseSort("created"), "created");
  assert.equal(parseSort("bogus"), "retrieved");
});
