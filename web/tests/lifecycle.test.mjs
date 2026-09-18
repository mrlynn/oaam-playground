import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTurnParam, stageTotals, sumPointExtras, waterfall } from "../src/lib/lifecycle.ts";

const T0 = new Date(2026, 8, 18, 3, 0, 0).getTime();
const ev = (seq, parent, depth, stage, startMs, durMs, extra = {}) => ({
  event_id: seq, seq, parent_seq: parent, depth, stage, name: `e${seq}`, source: depth ? "log" : "wrapper",
  started_at: new Date(T0 + startMs), duration_ms: durMs, attrs: null, ...extra,
});

// add_messages (ingestion) wrapping extraction wrapping a consolidation lookup
// with a nested search, then the store write.
const events = [
  ev(1, null, 0, "ingestion", 0, 1000),
  ev(2, 1, 1, "ingestion", 1, 998),
  ev(3, 2, 2, "extraction", 10, 700),
  ev(4, 3, 3, "consolidation", 20, 100),
  ev(5, 4, 4, "consolidation", 25, 80),
  ev(6, 2, 2, "ingestion", 800, 150, { attrs: { points: [{ extras: { inserted_row_count: 2 } }, { extras: { inserted_row_count: 1 } }] } }),
];

test("bars are placed by offset and sized by duration", () => {
  const w = waterfall(events);
  assert.equal(w.totalMs, 1000);
  const [root, , extraction] = w.bars;
  assert.equal(root.leftPct, 0);
  assert.equal(root.widthPct, 100);
  assert.equal(extraction.leftPct, 1);
  assert.equal(extraction.widthPct, 70);
});

test("instant spans stay visible and never run past the end", () => {
  const w = waterfall([ev(1, null, 0, "retrieval", 0, 1000), ev(2, 1, 1, "retrieval", 999, 0)]);
  assert.ok(w.bars[1].widthPct > 0);
  assert.ok(w.bars[1].leftPct + w.bars[1].widthPct <= 100.0001);
});

test("deep events are counted, not drawn", () => {
  const w = waterfall(events, 2);
  assert.deepEqual(w.bars.map((b) => b.seq), [1, 2, 3, 6]);
  assert.equal(w.hidden, 2);
});

test("stage totals count only the top span of each stage", () => {
  const totals = Object.fromEntries(stageTotals(events, 1000).map((t) => [t.stage, t]));
  assert.equal(totals.ingestion.ms, 1000); // ev1 only; ev2 and ev6 are nested ingestion
  assert.equal(totals.extraction.ms, 700);
  assert.equal(totals.consolidation.ms, 100); // ev4 only; ev5 is nested consolidation
  assert.equal(totals.consolidation.spans, 2);
  assert.equal(totals.extraction.share, 0.7);
});

test("point extras are summed across events", () => {
  assert.equal(sumPointExtras(events, "inserted_row_count"), 3);
});

test("turn parameter", () => {
  assert.equal(parseTurnParam("3"), 3);
  assert.equal(parseTurnParam("0"), null);
  assert.equal(parseTurnParam("abc"), null);
  assert.equal(parseTurnParam("2.5"), null);
});

test("empty turn", () => {
  assert.deepEqual(waterfall([]), { bars: [], totalMs: 0, hidden: 0 });
});
