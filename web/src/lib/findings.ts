// Pure helpers for health findings: status against the previous check run,
// badges per memory, and per-memory stats. No runtime imports, so
// tests/findings.test.mjs runs this file under plain `node --test`.

import type { MemoryRow } from "./queries";
import type { FindingRow, FindingStub, MemoryOrigin, RetrievalStat } from "./runTypes";

export type FindingStatus = "new" | "open";

export type Comparison = {
  status: Map<number, FindingStatus>; // finding_id -> status
  resolved: FindingStub[];
  /** false when there is no comparable previous run: nothing is called new. */
  compared: boolean;
};

export function compareRuns(current: FindingRow[], previous: FindingStub[] | null): Comparison {
  if (previous === null) {
    return { status: new Map(current.map((f) => [f.finding_id, "open"])), resolved: [], compared: false };
  }
  const before = new Set(previous.map((p) => p.fingerprint));
  const now = new Set(current.map((f) => f.fingerprint));
  return {
    status: new Map(current.map((f) => [f.finding_id, before.has(f.fingerprint) ? "open" : "new"])),
    resolved: previous.filter((p) => !now.has(p.fingerprint)),
    compared: true,
  };
}

export type Badge = { kind: FindingRow["kind"]; label: string; hint: string; findingId: number };

/**
 * What a memory is accused of, for chips next to it elsewhere (the "why" view,
 * the memories table). Only the memory the fix would delete gets a badge: the
 * stale side of a supersession, the extra copies of a duplicate.
 */
export function badgesByMemory(findings: FindingRow[]): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  const add = (id: unknown, badge: Badge) => {
    if (typeof id !== "string") return;
    const have = out.get(id) ?? [];
    // Stale in two pairs is still one "stale": the first finding's link is enough.
    if (!have.some((b) => b.label === badge.label)) out.set(id, [...have, badge]);
  };
  for (const f of findings) {
    const ev = f.evidence ?? {};
    const ids = f.memory_ids ?? [];
    switch (f.kind) {
      case "superseded":
        add(ev.stale, { kind: f.kind, label: "stale", hint: f.title, findingId: f.finding_id });
        break;
      case "contradiction":
        ids.forEach((id) => add(id, { kind: f.kind, label: "contradicts", hint: f.title, findingId: f.finding_id }));
        break;
      case "duplicate":
        ids.filter((id) => id !== ev.keep).forEach((id) =>
          add(id, { kind: f.kind, label: `duplicate ×${ids.length}`, hint: f.title, findingId: f.finding_id }));
        break;
      case "near_duplicate":
        ids.forEach((id) => add(id, { kind: f.kind, label: "near-duplicate", hint: f.title, findingId: f.finding_id }));
        break;
      case "transient":
        ids.forEach((id) => add(id, { kind: f.kind, label: "transient", hint: f.title, findingId: f.finding_id }));
        break;
      default:
        // crowded_turn, scope_mismatch, orphan_chunks are about turns, users and the store
        break;
    }
  }
  return out;
}

export type MemoryStats = MemoryRow & {
  retrieved: number;
  inPrompt: number;
  lastRetrieved: Date | null;
  /** The run and turn whose diff created it; null if it predates the run log. */
  createdIn: { runId: string; turn: number } | null;
  badges: Badge[];
};

export type SortKey = "retrieved" | "created" | "findings";

export function memoryStats(
  memories: MemoryRow[],
  stats: RetrievalStat[],
  origins: MemoryOrigin[],
  badges: Map<string, Badge[]>,
  sort: SortKey = "retrieved",
): MemoryStats[] {
  const byId = new Map(stats.map((s) => [s.record_id, s]));
  const originOf = new Map<string, { runId: string; turn: number }>();
  for (const o of origins) if (!originOf.has(o.memory_id)) originOf.set(o.memory_id, { runId: o.run_id, turn: o.turn });
  const rows = memories.map((m) => {
    const s = byId.get(m.memory_id);
    return {
      ...m,
      retrieved: s?.retrieved ?? 0,
      inPrompt: s?.in_prompt ?? 0,
      lastRetrieved: s?.last_retrieved ?? null,
      createdIn: originOf.get(m.memory_id) ?? null,
      badges: badges.get(m.memory_id) ?? [],
    };
  });
  const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
  const cmp: Record<SortKey, (a: MemoryStats, b: MemoryStats) => number> = {
    retrieved: (a, b) => b.retrieved - a.retrieved || b.inPrompt - a.inPrompt || time(b.created_at) - time(a.created_at),
    created: (a, b) => time(b.created_at) - time(a.created_at),
    findings: (a, b) => b.badges.length - a.badges.length || b.retrieved - a.retrieved,
  };
  return rows.sort(cmp[sort]);
}

export function parseSort(raw: string | string[] | undefined): SortKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "created" || v === "findings" ? v : "retrieved";
}
