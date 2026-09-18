// Shapes of the AIM_V_* view rows. JSON columns arrive as parsed values.
// Types only, so server code, the node --test suite and the docs site's
// replay can all import this file.

// ---- demo views over the package (infra/sql/10_views.sql) ---------------------

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

// ---- run log (memory-inspector) ------------------------------------------------

export type RunRow = {
  run_id: string;
  source: "instrumented" | "replay" | "live";
  user_id: string | null;
  agent_id: string | null;
  llm_model: string | null;
  embed_model: string | null;
  package_version: string | null;
  first_turn_at: Date | null;
  last_turn_at: Date | null;
  turn_count: number;
};

/** One search result, as recorded by the wrapper. in_prompt is null when the agent didn't say. */
export type Retrieval = {
  search: number;
  rank: number;
  record_id: string;
  record_type: string | null;
  distance: number | null;
  thread_id: string | null;
  in_prompt: boolean | null;
};

export type DiffRecord = { id: string; type: string; content: string | null; thread_id?: string | null };
export type DiffUpdate = { id: string; type: string; before: string | null; after: string | null };
export type MemoryDiff = { created: DiffRecord[]; updated: DiffUpdate[]; deleted: DiffRecord[] };

export type TurnAttrs = {
  closed_by?: string;
  queries?: string[];
  computed?: string[];
  [key: string]: unknown;
};

export type TurnRow = {
  turn: number;
  started_at: Date;
  duration_ms: number | null;
  user_message: string | null;
  retrieved: Retrieval[] | null;
  message_ids: string[] | null;
  memory_diff: MemoryDiff | null;
  attrs: TurnAttrs | null;
  prompt_tokens: number | null;
  flat_history_tokens: number | null;
  reply_source: "scripted" | "model" | null;
};

export type TurnPrompt = {
  assembled_prompt: string | null;
  reply: string | null;
  token_method: string | null;
  usage: Record<string, unknown> | null;
};

/** Where a memory was first seen created in the run log, in any run. */
export type MemoryOrigin = { memory_id: string; run_id: string; turn: number };

// ---- memory health (memory-inspector check) ----------------------------------

export type CheckRunRow = {
  check_run_id: number;
  started_at: Date;
  finished_at: Date | null;
  scope_user_id: string | null;
  params: Record<string, unknown> | null;
  counts: {
    memories?: number;
    candidate_pairs?: number;
    judge_calls?: number;
    judge_cache_hits?: number;
    unparsed?: number;
    findings?: Record<string, number>;
  } | null;
  judge_model: string | null;
  package_version: string | null;
};

export type FindingKind =
  | "superseded" | "contradiction" | "duplicate" | "near_duplicate"
  | "transient" | "crowded_turn" | "scope_mismatch" | "orphan_chunks";

export type FindingRow = {
  finding_id: number;
  check_run_id: number;
  fingerprint: string;
  kind: FindingKind;
  severity: "high" | "medium" | "low";
  user_id: string | null;
  memory_ids: string[] | null;
  turns: { run_id: string; turn: number }[] | null;
  title: string;
  detail: string | null;
  suggestion: string | null;
  evidence: Record<string, unknown> | null;
  method: string;
};

/** A previous run's finding, enough to say what was resolved. */
export type FindingStub = Pick<FindingRow, "fingerprint" | "kind" | "title">;

export type RetrievalStat = {
  record_id: string;
  retrieved: number;
  in_prompt: number;
  last_retrieved: Date | null;
};

// ---- lifecycle (AIM_V_RUN_EVENTS) ----------------------------------------------

export type Stage = "ingestion" | "extraction" | "consolidation" | "retrieval" | "summarization" | "revision" | "other";

export type EventRow = {
  event_id: number;
  seq: number;
  parent_seq: number | null;
  depth: number;
  stage: Stage;
  name: string;
  source: "wrapper" | "log";
  started_at: Date;
  duration_ms: number | null;
  input_summary: string | null;
  output_summary: string | null;
  memory_ids: string[] | null;
  attrs: Record<string, unknown> | null;
  error: string | null;
};
