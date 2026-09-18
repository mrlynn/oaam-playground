import "server-only";

import { query, v } from "./db";
import type { MemoryOrigin, RunRow, TurnPrompt, TurnRow } from "./runTypes";

export type StoreInfo = {
  schema_version: string | null;
  vector_dim: string | null;
  indexing_mode: string | null;
  retention_config: string | null;
};

export type ThreadRow = {
  thread_id: string;
  user_id: string | null;
  agent_id: string | null;
  created_at: Date;
  message_count: number;
  memory_count: number;
  last_activity: Date;
};

export type MessageRow = {
  message_id: string;
  thread_id: string;
  position: number;
  role: string;
  content: string | null;
  created_at: Date;
  expires_at: Date | null;
  is_expired: number;
};

export type MemoryType = "memory" | "fact" | "preference" | "guideline";

export type MemoryRow = {
  memory_id: string;
  memory_type: MemoryType;
  content: string | null;
  thread_id: string | null;
  user_id: string | null;
  agent_id: string | null;
  created_at: Date;
  expires_at: Date | null;
  is_expired: number;
  origin: "extracted" | "explicit";
  extractor_scope: string | null;
  importance: number | null;
  entities: string[] | null;
  extraction_id: string | null;
  after_message_position: number;
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

export type { MemoryOrigin, RunRow, TurnPrompt, TurnRow } from "./runTypes";

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

/** The run and turn that created each memory, across every run in the schema. */
export async function getMemoryOrigins(ids: string[]): Promise<MemoryOrigin[]> {
  if (!ids.length) return [];
  const { sql, binds } = inList("m", ids.slice(0, MAX_IDS));
  return query<MemoryOrigin>(
    `select jt.memory_id, t.run_id, min(t.turn) as turn
       from ${v("aim_v_turns")} t,
            json_table(t.memory_diff, '$.created[*]' columns (memory_id varchar2(128) path '$.id')) jt
      where jt.memory_id in (${sql})
      group by jt.memory_id, t.run_id`,
    binds,
  );
}

/** Turn counts for the runs list. */
export function listRuns(): Promise<Pick<RunRow, "run_id" | "source" | "turn_count">[]> {
  return query(`select run_id, source, turn_count from ${v("aim_v_runs")}`);
}
