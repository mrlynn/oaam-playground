// Waterfall layout and per-stage totals for one turn's events. Pure, no runtime
// imports: tests/lifecycle.test.mjs runs it under plain `node --test`.

import type { EventRow, Stage } from "./runTypes";

export type Bar = EventRow & {
  /** Offset from the turn's first event, ms. */
  offsetMs: number;
  leftPct: number;
  widthPct: number;
};

export type Waterfall = { bars: Bar[]; totalMs: number; hidden: number };

const MIN_WIDTH_PCT = 0.4; // keep instant spans visible

const time = (d: Date) => new Date(d).getTime();

/** Events in start order as positioned bars. Events deeper than maxDepth are counted, not drawn. */
export function waterfall(events: EventRow[], maxDepth = Infinity): Waterfall {
  if (!events.length) return { bars: [], totalMs: 0, hidden: 0 };
  const t0 = Math.min(...events.map((e) => time(e.started_at)));
  const end = Math.max(...events.map((e) => time(e.started_at) + (e.duration_ms ?? 0)));
  const totalMs = Math.max(end - t0, 1);
  const shown = events.filter((e) => e.depth <= maxDepth).sort((a, b) => a.seq - b.seq);
  return {
    totalMs,
    hidden: events.length - shown.length,
    bars: shown.map((e) => {
      const offsetMs = time(e.started_at) - t0;
      const leftPct = (offsetMs / totalMs) * 100;
      const widthPct = Math.min(Math.max(((e.duration_ms ?? 0) / totalMs) * 100, MIN_WIDTH_PCT), 100 - leftPct);
      return { ...e, offsetMs, leftPct, widthPct };
    }),
  };
}

export type StageTotal = { stage: Stage; ms: number; share: number; spans: number };

/**
 * Time per stage without double counting: a span counts only if its parent is
 * a different stage (or it has none), so a search nested inside a search is
 * not added twice, while extraction inside ingestion still counts as extraction.
 * Shares are of the turn's wall time; stages that overlap can sum past 100%.
 */
export function stageTotals(events: EventRow[], totalMs: number): StageTotal[] {
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  const acc = new Map<Stage, StageTotal>();
  for (const e of events) {
    const parent = e.parent_seq == null ? undefined : bySeq.get(e.parent_seq);
    const t = acc.get(e.stage) ?? { stage: e.stage, ms: 0, share: 0, spans: 0 };
    t.spans += 1;
    if (!parent || parent.stage !== e.stage) t.ms += e.duration_ms ?? 0;
    acc.set(e.stage, t);
  }
  return [...acc.values()]
    .map((t) => ({ ...t, ms: Math.round(t.ms), share: totalMs ? t.ms / totalMs : 0 }))
    .sort((a, b) => b.ms - a.ms);
}

/** Sum an integer field over every folded point record, e.g. "inserted_row_count". */
export function sumPointExtras(events: EventRow[], field: string): number {
  let n = 0;
  for (const e of events) {
    const points = (e.attrs?.points as { extras?: Record<string, unknown> }[] | undefined) ?? [];
    for (const p of points) {
      const v = p.extras?.[field];
      if (typeof v === "number") n += v;
    }
  }
  return n;
}

export function parseTurnParam(raw: string): number | null {
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}
