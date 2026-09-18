// What durable memory looked like at turn n of a run, rebuilt from the run
// log's per-turn diffs rather than the memory table. The table only holds the
// latest content and forgets deleted rows; the diffs remember both.
//
// No runtime imports: tests/memoryState.test.mjs runs this file under plain
// `node --test`.

import type { MemoryRow, Retrieval, TurnRow } from "./runTypes";

export type Revision = { turn: number; before: string | null; after: string | null };

export type MemoryAt = {
  id: string;
  type: string;
  /** Content as it was at turn n. */
  content: string | null;
  /** Turn that created it in this run; null if it predates the run log. */
  createdTurn: number | null;
  /** Revisions at or before turn n, oldest first. */
  revisions: Revision[];
  /** Turn it was removed at, if at or before n. */
  removedTurn: number | null;
  newNow: boolean;
  revisedNow: boolean;
  removedNow: boolean;
  /** Its best-ranked appearance in turn n's searches. */
  retrieval: Retrieval | null;
  /** The current row, when the memory still exists. */
  row: MemoryRow | null;
};

type History = {
  type: string;
  created: { turn: number; content: string | null } | null;
  updates: Revision[];
  deleted: { turn: number; content: string | null } | null;
};

function histories(turns: TurnRow[]): Map<string, History> {
  const map = new Map<string, History>();
  const get = (id: string, type: string) => {
    let h = map.get(id);
    if (!h) {
      h = { type, created: null, updates: [], deleted: null };
      map.set(id, h);
    }
    return h;
  };
  for (const t of [...turns].sort((a, b) => a.turn - b.turn)) {
    const d = t.memory_diff;
    if (!d) continue;
    for (const c of d.created ?? []) get(c.id, c.type).created ??= { turn: t.turn, content: c.content };
    for (const u of d.updated ?? []) get(u.id, u.type).updates.push({ turn: t.turn, before: u.before, after: u.after });
    for (const x of d.deleted ?? []) get(x.id, x.type).deleted ??= { turn: t.turn, content: x.content };
  }
  return map;
}

/** The best-ranked result per record id in one turn's searches. */
export function retrievalsByRecord(turn: TurnRow | undefined): Map<string, Retrieval> {
  const out = new Map<string, Retrieval>();
  const rows = [...(turn?.retrieved ?? [])].sort((a, b) => a.search - b.search || a.rank - b.rank);
  for (const r of rows) if (!out.has(r.record_id)) out.set(r.record_id, r);
  return out;
}

/**
 * Memories as of turn n. `current` is what the memory table holds now (this
 * thread's memories); anything the diffs mention is added even if it has since
 * been deleted. Memories created after turn n are left out.
 */
export function memoryStateAt(current: MemoryRow[], turns: TurnRow[], n: number): MemoryAt[] {
  const hist = histories(turns);
  const rows = new Map(current.map((r) => [r.memory_id, r]));
  const retrieved = retrievalsByRecord(turns.find((t) => t.turn === n));
  const order = [...rows.keys(), ...[...hist.keys()].filter((id) => !rows.has(id))];

  const out: MemoryAt[] = [];
  for (const id of order) {
    const h = hist.get(id);
    const row = rows.get(id) ?? null;
    const createdTurn = h?.created?.turn ?? null;
    if (createdTurn !== null && createdTurn > n) continue;

    // Start from the earliest content we know, then replay revisions up to n.
    const updates = h?.updates ?? [];
    let content = h?.created?.content ?? updates[0]?.before ?? h?.deleted?.content ?? row?.content ?? null;
    const revisions = updates.filter((u) => u.turn <= n);
    for (const u of revisions) content = u.after;

    const removedTurn = h?.deleted && h.deleted.turn <= n ? h.deleted.turn : null;
    out.push({
      id,
      type: h?.type ?? row?.memory_type ?? "memory",
      content,
      createdTurn,
      revisions,
      removedTurn,
      newNow: createdTurn === n,
      revisedNow: revisions.some((u) => u.turn === n),
      removedNow: removedTurn === n,
      retrieval: retrieved.get(id) ?? null,
      row,
    });
  }
  // Pre-existing memories first, then in the order the run created them.
  return out.sort((a, b) => (a.createdTurn ?? 0) - (b.createdTurn ?? 0));
}

/** message id -> the turn that wrote it. */
export function turnByMessage(turns: TurnRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of turns) for (const id of t.message_ids ?? []) map.set(id, t.turn);
  return map;
}

export type PromptLabel = "in prompt" | "also returned" | "returned by search";

/** Never claim more than the agent reported: without record_prompt we only know search returned it. */
export function promptLabel(r: Retrieval): PromptLabel {
  if (r.in_prompt === true) return "in prompt";
  if (r.in_prompt === false) return "also returned";
  return "returned by search";
}

/** Clamp a ?turn= value to the run; anything missing or invalid means the last turn. */
export function parseTurn(raw: string | string[] | undefined, turnCount: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(n) || turnCount < 1) return turnCount;
  return Math.min(Math.max(n, 1), turnCount);
}
