import "server-only";

import { query, v } from "./db";
import type {
  CheckRunRow,
  EventRow,
  FindingRow,
  FindingStub,
  MemoryOrigin,
  MemoryRow,
  MessageRow,
  RetrievalStat,
  RunRow,
  ThreadRow,
  TurnPrompt,
  TurnRow,
} from "./runTypes";

export type StoreInfo = {
  schema_version: string | null;
  vector_dim: string | null;
  indexing_mode: string | null;
  retention_config: string | null;
};

export async function getStoreInfo(): Promise<StoreInfo | null> {
  const rows = await query<StoreInfo>(`select * from ${v("aim_v_store_info")}`);
  return rows[0] ?? null;
}

export function listThreads(): Promise<ThreadRow[]> {
  return query<ThreadRow>(
    `select thread_id, user_id, agent_id, created_at, message_count, memory_count, last_activity
       from ${v("aim_v_threads")}
      order by last_activity desc`,
  );
}

export async function getThread(threadId: string): Promise<ThreadRow | null> {
  const rows = await query<ThreadRow>(
    `select thread_id, user_id, agent_id, created_at, message_count, memory_count, last_activity
       from ${v("aim_v_threads")}
      where thread_id = :threadId`,
    { threadId },
  );
  return rows[0] ?? null;
}

export function getMessages(threadId: string, includeExpired: boolean): Promise<MessageRow[]> {
  return query<MessageRow>(
    `select message_id, thread_id, position, role, content, created_at, expires_at, is_expired
       from ${v("aim_v_messages")}
      where thread_id = :threadId
        and (:includeExpired = 1 or is_expired = 0)
      order by position`,
    { threadId, includeExpired: includeExpired ? 1 : 0 },
  );
}

/**
 * Memories written into this thread, plus the same user's memories that have
 * no thread at all (user-level). Extraction always sets a thread id (see
 * docs/phase0-answers.md), so the second group is usually empty.
 */
export function getThreadMemories(
  threadId: string,
  userId: string | null,
  includeExpired: boolean,
): Promise<MemoryRow[]> {
  return query<MemoryRow>(
    `select memory_id, memory_type, content, thread_id, user_id, agent_id, created_at, expires_at,
            is_expired, origin, extractor_scope, importance, entities, extraction_id,
            after_message_position
       from ${v("aim_v_memories")}
      where (thread_id = :threadId or (thread_id is null and user_id = :userId))
        and (:includeExpired = 1 or is_expired = 0)
      order by after_message_position, seq`,
    { threadId, userId, includeExpired: includeExpired ? 1 : 0 },
  );
}

// ---- run log (memory-inspector) --------------------------------------------

export type { CheckRunRow, EventRow, FindingRow, FindingStub, MemoryOrigin, MemoryRow, MemoryType, MessageRow, RetrievalStat, RunRow, ThreadRow, TurnPrompt, TurnRow } from "./runTypes";

/** `:p0, :p1, ...` placeholders and binds for an IN list. */
function inList(prefix: string, values: string[]): { sql: string; binds: Record<string, string> } {
  const binds = Object.fromEntries(values.map((val, i) => [`${prefix}${i}`, val]));
  return { sql: Object.keys(binds).map((k) => `:${k}`).join(", "), binds };
}

const MAX_IDS = 200;

export async function getRun(runId: string): Promise<RunRow | null> {
  const rows = await query<RunRow>(
    `select run_id, source, user_id, agent_id, llm_model, embed_model, package_version,
            first_turn_at, last_turn_at, turn_count
       from ${v("aim_v_runs")}
      where run_id = :runId`,
    { runId },
  );
  return rows[0] ?? null;
}

/** Every turn of a run, without the large prompt and reply texts. */
export function getTurns(runId: string): Promise<TurnRow[]> {
  return query<TurnRow>(
    `select turn, started_at, duration_ms, user_message, retrieved, message_ids, memory_diff, attrs,
            prompt_tokens, flat_history_tokens, reply_source
       from ${v("aim_v_turns")}
      where run_id = :runId
      order by turn`,
    { runId },
  );
}

export async function getTurnPrompt(runId: string, turn: number): Promise<TurnPrompt | null> {
  const rows = await query<TurnPrompt>(
    `select assembled_prompt, reply, token_method, usage
       from ${v("aim_v_turns")}
      where run_id = :runId and turn = :turn`,
    { runId, turn },
  );
  return rows[0] ?? null;
}

/** Current rows for memories retrieved from anywhere (other threads included). */
export async function getMemoriesByIds(ids: string[]): Promise<MemoryRow[]> {
  if (!ids.length) return [];
  const { sql, binds } = inList("m", ids.slice(0, MAX_IDS));
  return query<MemoryRow>(
    `select memory_id, memory_type, content, thread_id, user_id, agent_id, created_at, expires_at,
            is_expired, origin, extractor_scope, importance, entities, extraction_id,
            after_message_position
       from ${v("aim_v_memories")}
      where memory_id in (${sql})`,
    binds,
  );
}

export async function getMessagesByIds(ids: string[]): Promise<MessageRow[]> {
  if (!ids.length) return [];
  const { sql, binds } = inList("m", ids.slice(0, MAX_IDS));
  return query<MessageRow>(
    `select message_id, thread_id, position, role, content, created_at, expires_at, is_expired
       from ${v("aim_v_messages")}
      where message_id in (${sql})`,
    binds,
  );
}

/** The run and turn that created each memory, across every run in the schema. Every memory if ids is omitted. */
export async function getMemoryOrigins(ids?: string[]): Promise<MemoryOrigin[]> {
  if (ids && !ids.length) return [];
  const list = ids ? inList("m", ids.slice(0, MAX_IDS)) : null;
  return query<MemoryOrigin>(
    `select jt.memory_id, t.run_id, min(t.turn) as turn
       from ${v("aim_v_turns")} t,
            json_table(t.memory_diff, '$.created[*]' columns (memory_id varchar2(128) path '$.id')) jt
      ${list ? `where jt.memory_id in (${list.sql})` : ""}
      group by jt.memory_id, t.run_id`,
    list?.binds ?? {},
  );
}

/** Turn counts for the runs list. */
export function listRuns(): Promise<Pick<RunRow, "run_id" | "source" | "turn_count">[]> {
  return query(`select run_id, source, turn_count from ${v("aim_v_runs")}`);
}

// ---- memory health ------------------------------------------------------------

/** Every current memory in the store (the /memories table). */
export function listAllMemories(includeExpired: boolean): Promise<MemoryRow[]> {
  return query<MemoryRow>(
    `select memory_id, memory_type, content, thread_id, user_id, agent_id, created_at, expires_at,
            is_expired, origin, extractor_scope, importance, entities, extraction_id,
            after_message_position
       from ${v("aim_v_memories")}
      where (:includeExpired = 1 or is_expired = 0)`,
    { includeExpired: includeExpired ? 1 : 0 },
  );
}

/** How often each record came back from an instrumented search, and how often it reached the prompt. */
export function getRetrievalStats(): Promise<RetrievalStat[]> {
  return query<RetrievalStat>(
    `select record_id, count(*) as retrieved, sum(case when in_prompt = 1 then 1 else 0 end) as in_prompt,
            max(started_at) as last_retrieved
       from ${v("aim_v_memory_retrievals")}
      group by record_id`,
  );
}

export async function getLatestCheckRun(): Promise<CheckRunRow | null> {
  const rows = await query<CheckRunRow>(
    `select check_run_id, started_at, finished_at, scope_user_id, params, counts, judge_model, package_version
       from ${v("aim_v_check_runs")}
      where finished_at is not null
      order by check_run_id desc
      fetch first 1 row only`,
  );
  return rows[0] ?? null;
}

/** The run before `run` with the same scope and judge: the only fair comparison. */
export async function getPreviousCheckRun(run: CheckRunRow): Promise<CheckRunRow | null> {
  const rows = await query<CheckRunRow>(
    `select check_run_id, started_at, finished_at, scope_user_id, params, counts, judge_model, package_version
       from ${v("aim_v_check_runs")}
      where finished_at is not null and check_run_id < :id
        and decode(scope_user_id, :scope, 1, 0) = 1
        and decode(judge_model, :judge, 1, 0) = 1
      order by check_run_id desc
      fetch first 1 row only`,
    { id: run.check_run_id, scope: run.scope_user_id, judge: run.judge_model },
  );
  return rows[0] ?? null;
}

export function getFindings(checkRunId: number): Promise<FindingRow[]> {
  return query<FindingRow>(
    `select finding_id, check_run_id, fingerprint, kind, severity, user_id, memory_ids, turns,
            title, detail, suggestion, evidence, method
       from ${v("aim_v_findings")}
      where check_run_id = :checkRunId
      order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, kind, finding_id`,
    { checkRunId },
  );
}

export function getFindingStubs(checkRunId: number): Promise<FindingStub[]> {
  return query<FindingStub>(
    `select fingerprint, kind, title from ${v("aim_v_findings")} where check_run_id = :checkRunId`,
    { checkRunId },
  );
}

/** Findings of the latest check run, or none if there has never been one. */
export async function getLatestFindings(): Promise<FindingRow[]> {
  const run = await getLatestCheckRun();
  return run ? getFindings(run.check_run_id) : [];
}

// ---- lifecycle ------------------------------------------------------------

export function getTurnEvents(runId: string, turn: number): Promise<EventRow[]> {
  return query<EventRow>(
    `select event_id, seq, parent_seq, depth, stage, name, source, started_at, duration_ms,
            input_summary, output_summary, memory_ids, attrs, error
       from ${v("aim_v_run_events")}
      where run_id = :runId and turn = :turn
      order by seq`,
    { runId, turn },
  );
}
