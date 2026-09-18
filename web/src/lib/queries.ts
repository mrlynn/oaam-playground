import "server-only";

import { query, v } from "./db";

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
