// The rows of the "why" pane: every search result of one turn, with its
// content as of that turn, where it came from, and any health badges. Pure, no
// runtime imports beyond sibling pure files, so the dashboard page and the docs
// site's replay build the pane from the same code.

import { type Badge, badgesByMemory } from "./findings.ts";
import type { MemoryAt } from "./memoryState.ts";
import type { FindingRow, MemoryOrigin, MemoryRow, MessageRow, Retrieval, TurnRow } from "./runTypes.ts";

export type WhyRow = Retrieval & {
  /** Content as it was at this turn when the run log knows, else the current row. */
  content: string | null;
  /** Where it was created: a turn of this run, another run, or unknown. */
  origin: { runId: string; turn: number } | null;
  /** Thread the record is stored on (for records created before the run log). */
  storedThread: string | null;
  gone: boolean;
  /** Open findings from the latest health check that accuse this memory. */
  badges: Badge[];
};

/** One turn's search results in search, then rank, order. */
export function sortedRetrievals(turn: TurnRow | undefined): Retrieval[] {
  return [...(turn?.retrieved ?? [])].sort((a, b) => a.search - b.search || a.rank - b.rank);
}

export type WhyInputs = {
  turn: TurnRow | undefined;
  /** memoryStateAt(...) for the same turn. */
  state: MemoryAt[];
  /** Current rows for the retrieved memory ids, from any thread. */
  memories: MemoryRow[];
  /** Rows for retrieved raw message chunks. */
  messages: MessageRow[];
  origins: MemoryOrigin[];
  findings: FindingRow[];
};

export function whyRows({ turn, state, memories, messages, origins, findings }: WhyInputs): WhyRow[] {
  const badges = badgesByMemory(findings);
  const asOfTurn = new Map(state.map((m) => [m.id, m]));
  const current = new Map(memories.map((m) => [m.memory_id, m]));
  const messageById = new Map(messages.map((m) => [m.message_id, m]));
  const originOf = new Map<string, { runId: string; turn: number }>();
  for (const o of origins) if (!originOf.has(o.memory_id)) originOf.set(o.memory_id, { runId: o.run_id, turn: o.turn });
  return sortedRetrievals(turn).map((r) => {
    const known = asOfTurn.get(r.record_id);
    const row = current.get(r.record_id);
    const msg = messageById.get(r.record_id);
    return {
      ...r,
      content: known?.content ?? row?.content ?? msg?.content ?? null,
      origin: originOf.get(r.record_id) ?? null,
      storedThread: row?.thread_id ?? msg?.thread_id ?? r.thread_id,
      gone: !row && !msg,
      badges: badges.get(r.record_id) ?? [],
    };
  });
}

/** The one-line summary under the user's message. */
export function whySummary(rows: WhyRow[]): string {
  const searches = new Set(rows.map((r) => r.search)).size;
  const inPrompt = rows.filter((r) => r.in_prompt === true).length;
  const reported = rows.some((r) => r.in_prompt !== null);
  const s = `${rows.length} results from ${searches} search${searches === 1 ? "" : "es"}`;
  if (rows.length === 0) return "The agent didn't search this turn, or search returned nothing: the reply used no memories.";
  return reported
    ? `${s}; ${inPrompt} went into the prompt.`
    : `${s}. The agent didn't report which it used, so none are marked "in prompt".`;
}
