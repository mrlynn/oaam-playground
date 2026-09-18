// The recorded demo the docs site replays: rows from the AIM_APP views, exactly
// as the dashboard reads them, written by scripts/export-demo.mts. This file
// holds the shape, the date reviver, and the checks that decide whether a seed
// is worth publishing. Pure, so the exporter and the site's test share it.

import { memoryStateAt } from "./memoryState.ts";
import type {
  CheckRunRow,
  EventRow,
  FindingRow,
  FindingStub,
  MemoryOrigin,
  MemoryRow,
  MessageRow,
  RunRow,
  ThreadRow,
  TurnPrompt,
  TurnRow,
} from "./runTypes.ts";
import { whyRows } from "./why.ts";

/** A turn with its prompt and reply, which the dashboard fetches separately. */
export type DemoTurn = TurnRow & TurnPrompt;

export type DemoConversation = {
  /** The scripted conversation it replays, e.g. "support_03". */
  key: string;
  thread: ThreadRow;
  run: RunRow;
  turns: DemoTurn[];
  messages: MessageRow[];
  events: (EventRow & { turn: number })[];
};

export type DemoExport = {
  manifest: {
    exported_at: string;
    schema: "AIM_APP";
    git_sha: string | null;
    package_version: string | null;
    llm_model: string | null;
    embed_model: string | null;
    check_run_id: number | null;
    judge_model: string | null;
  };
  conversations: DemoConversation[];
  /** Every memory of the seed users, current rows (expired ones flagged). */
  memories: MemoryRow[];
  /** Raw message chunks that a search returned from a thread not exported above. */
  extraMessages: MessageRow[];
  origins: MemoryOrigin[];
  checkRun: CheckRunRow | null;
  findings: FindingRow[];
  /** The previous comparable check's findings, for new and resolved. */
  previous: FindingStub[] | null;
};

const DATE_KEY = /(_at|^last_activity|^last_retrieved)$/;

/** JSON.parse reviver: turn the view's timestamp columns back into Dates. */
export function reviveDates(key: string, value: unknown): unknown {
  return typeof value === "string" && DATE_KEY.test(key) ? new Date(value) : value;
}

export const CORRECTION = "Actually wait"; // support_01: Alice corrects the bucket region
export const MIXED = "Which region is my export bucket in"; // support_03: the two-topic question

export type Moment = { name: string; ok: boolean; detail: string; required: boolean };

/**
 * The demo guide's moments, checked against this export. A seed that misses a
 * required one isn't published: extraction is an LLM, and some seeds miss a beat.
 */
export function checkMoments(d: DemoExport): Moment[] {
  const out: Moment[] = [];
  const byKey = new Map(d.conversations.map((c) => [c.key, c]));
  const s1 = byKey.get("support_01");
  const s3 = byKey.get("support_03");
  const correction = s1?.turns.find((t) => t.user_message?.includes(CORRECTION));
  out.push({
    name: "support_01 correction turn",
    required: true,
    ok: Boolean(correction),
    detail: correction ? `turn ${correction.turn}` : "no turn contains the correction",
  });

  const memById = new Map(d.memories.map((m) => [m.memory_id, m]));
  const staleFinding = d.findings.find((f) => {
    const stale = memById.get(String(f.evidence?.stale ?? ""));
    return f.kind === "superseded" && stale?.content?.includes("us-east-1") && !stale.content.includes("us-west-2");
  });
  const staleId = staleFinding ? String(staleFinding.evidence?.stale) : null;
  out.push({
    name: "stale us-east-1 fact found by the check",
    required: true,
    ok: Boolean(staleFinding),
    detail: staleFinding ? `finding ${staleFinding.finding_id}` : "no superseded finding names the us-east-1 fact",
  });

  if (s1 && correction && staleId) {
    const hit = correction.retrieved?.find((r) => r.record_id === staleId);
    out.push({
      name: "stale fact in the correction turn's prompt",
      required: false,
      ok: Boolean(hit?.in_prompt),
      detail: hit ? `#${hit.rank}, cosine ${hit.distance?.toFixed(3)}, ${hit.in_prompt ? "in prompt" : "returned, not used"}` : "not returned that turn",
    });
  }

  const mixed = s3?.turns.find((t) => t.user_message?.includes(MIXED));
  if (s3 && mixed) {
    const state = memoryStateAt(d.memories.filter((m) => m.thread_id === s3.thread.thread_id), s3.turns, mixed.turn);
    const rows = whyRows({
      turn: mixed,
      state,
      memories: d.memories,
      messages: [...d.conversations.flatMap((c) => c.messages), ...d.extraMessages],
      origins: d.origins,
      findings: d.findings,
    });
    const badged = rows.filter((r) => r.in_prompt && r.badges.length);
    out.push({
      name: "support_03 prompt carries flagged memories",
      required: true,
      ok: badged.some((r) => r.badges.some((b) => b.label === "stale")),
      detail: `${badged.length} of ${rows.filter((r) => r.in_prompt).length} prompt slots badged: ${badged.flatMap((r) => r.badges.map((b) => b.label)).join(", ") || "none"}`,
    });
    const crowded = d.findings.find((f) => f.kind === "crowded_turn" && f.turns?.some((t) => t.run_id === s3.run.run_id && t.turn === mixed.turn));
    out.push({
      name: "support_03 turn found as a crowded prompt",
      required: true,
      ok: Boolean(crowded),
      detail: crowded ? `finding ${crowded.finding_id}` : "no crowded_turn finding points at it",
    });
  } else {
    out.push({ name: "support_03 mixed question", required: true, ok: false, detail: "not in this export" });
  }
  return out;
}
