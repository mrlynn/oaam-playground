// Waterfall layout and per-stage totals for one turn's events. Pure, no runtime
// imports: tests/lifecycle.test.mjs runs it under plain `node --test`.

import type { EventRow, Stage, TurnRow } from "./runTypes";

// A typical add_messages turn is about 30 spans, and its story (summary call,
// past-memory lookup, extraction call, store write) sits 3-4 levels down, so
// show everything unless the turn is unusually large.
export const SHOW_ALL_UP_TO = 40;
export const COLLAPSED_DEPTH = 3;

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

/** What each stage produced this turn, from the turn row and the spans' own records. */
export function producedBy(stage: Stage, turn: TurnRow, events: EventRow[]): string[] {
  const diff = turn.memory_diff;
  const inStage = events.filter((e) => e.stage === stage);
  switch (stage) {
    case "retrieval": {
      const r = turn.retrieved ?? [];
      const searches = new Set(r.map((x) => x.search)).size;
      const best = [...r].sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1))[0];
      return [
        `${searches} agent search${searches === 1 ? "" : "es"}, ${r.length} results, ${r.filter((x) => x.in_prompt).length} into the prompt`,
        ...(best ? [`closest: ${best.record_type} at cosine ${best.distance?.toFixed(3)}`] : []),
      ];
    }
    case "extraction": {
      const created = diff?.created ?? [];
      return [
        `${created.length} created · ${diff?.updated?.length ?? 0} updated · ${diff?.deleted?.length ?? 0} deleted`,
        ...created.slice(0, 3).map((m) => `+ [${m.type}] ${m.content ?? ""}`),
        ...(created.length > 3 ? [`and ${created.length - 3} more`] : []),
      ];
    }
    case "ingestion":
      return [
        `${turn.message_ids?.length ?? 0} messages written`,
        `${sumPointExtras(inStage, "inserted_row_count")} chunks embedded and inserted`,
      ];
    case "consolidation": {
      const looked = inStage.map((e) => (e.attrs?.end as Record<string, unknown> | undefined)?.past_memory_count)
        .filter((x): x is number => typeof x === "number");
      return [
        looked.length ? `looked up ${looked.reduce((a, b) => a + b, 0)} past memories before extracting` : "past-memory lookup before extracting",
        ...(diff?.updated?.length ? [] : ["no earlier memory was revised this turn"]),
      ];
    }
    case "summarization":
      return ["context summary updated for the next extraction (one LLM call; tokens not reported)"];
    case "revision":
      return [`${diff?.deleted?.length ?? 0} memories deleted · ${diff?.updated?.length ?? 0} updated`];
    default:
      return ["setup: thread and client initialization"];
  }
}

/** A span's duration as the waterfall prints it. */
export function fmtSpanMs(ms: number | null): string {
  return ms == null ? "—" : ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

/** Drawn dashed: the package logged no end, so the end was inferred. */
export function endInferred(e: EventRow): boolean {
  return Boolean(e.attrs?.end_inferred || e.attrs?.unclosed);
}
