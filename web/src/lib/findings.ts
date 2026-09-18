// Pure helpers for health findings: status against the previous check run,
// badges per memory, and per-memory stats. No runtime imports, so
// tests/findings.test.mjs runs this file under plain `node --test`.

import type { FindingRow, FindingStub, MemoryOrigin, MemoryRow, RetrievalStat } from "./runTypes";

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

// ---- how a finding reads (the /memories card and the docs site's replay) ------

export const KIND_LABEL: Record<FindingRow["kind"], string> = {
  superseded: "superseded",
  contradiction: "contradiction",
  duplicate: "duplicate",
  near_duplicate: "near-duplicate",
  transient: "transient",
  crowded_turn: "crowded prompt",
  scope_mismatch: "scope mismatch",
  orphan_chunks: "orphan chunks",
};

export function methodLabel(method: string): string {
  return method
    .replace("sql", "SQL")
    .replace("llm", "LLM judgment")
    .replace("pattern", "text pattern")
    .replaceAll("+", " + ");
}

/** The memory's part in the finding: the stale side, the current side, or the copy to keep. */
export function memoryRole(f: FindingRow, id: string): "stale" | "current" | "keep" | null {
  const ev = f.evidence ?? {};
  const supersededBy = new Set(((ev.superseded_by as { id: string }[] | undefined) ?? []).map((s) => s.id));
  if (ev.stale === id) return "stale";
  if (ev.current === id || supersededBy.has(id)) return "current";
  if (ev.keep === id) return "keep";
  return null;
}

/** For a crowded prompt: what this memory was doing in the prompt, e.g. "stale in prompt". */
export function crowdedLabel(f: FindingRow, id: string): string | null {
  const turns = (f.evidence ?? {}).turns as { wasted?: Record<string, string> }[] | undefined;
  const labels = new Set((turns ?? []).map((t) => t.wasted?.[id]).filter(Boolean));
  return labels.size ? `${[...labels].join(", ")} in prompt` : null;
}

type Judge = { relation?: string; kind?: string; rationale?: string; model?: string; current?: string | null };

/** Distances, patterns and judge rationales, labelled for what they are. */
export function evidenceLines(f: FindingRow): { label: string; text: string }[] {
  const ev = (f.evidence ?? {}) as Record<string, unknown>;
  const lines: { label: string; text: string }[] = [];
  if (typeof ev.distance === "number") lines.push({ label: "cosine distance", text: ev.distance.toFixed(3) });
  if (typeof ev.pattern === "string") lines.push({ label: "matched text", text: `“${ev.pattern}”` });
  const judge = ev.judge as Judge | null | undefined;
  if (judge?.rationale) {
    lines.push({ label: `LLM judgment · ${judge.model ?? "model"}`, text: `${judge.relation ?? judge.kind}: ${judge.rationale}` });
  }
  const pairs = ev.pairs as { distance: number; rationale: string; model: string }[] | undefined;
  for (const p of pairs ?? []) {
    lines.push({ label: `LLM judgment · ${p.model} · distance ${p.distance.toFixed(3)}`, text: p.rationale });
  }
  if (f.kind === "scope_mismatch" && ev.labels) {
    lines.push({ label: "extractor labels", text: Object.entries(ev.labels as Record<string, number>).map(([k, n]) => `${k} × ${n}`).join(", ") });
  }
  if (f.kind === "crowded_turn" && Array.isArray(ev.turns)) {
    for (const t of ev.turns as { turn: number; wasted: Record<string, string>; slots: number }[]) {
      lines.push({ label: `turn ${t.turn}`, text: `${Object.keys(t.wasted).length} of ${t.slots} slots: ${Object.values(t.wasted).join(", ")}` });
    }
    if (ev.basis === "returned") lines.push({ label: "note", text: "the agent didn't report its prompt; counted everything search returned" });
  }
  return lines;
}
