-- Run log for the memory inspector. Our tables, not the package's: nothing
-- here references or writes to oracleagentmemory objects, so it can be
-- installed before or after the package schema and survives a package RECREATE.
-- Installed by `memory-inspector init`. Statements end with a "/" line.
-- IF NOT EXISTS makes reruns safe; column changes need an explicit migration.

-- One row per instrumented thread. run_id is the package thread id. There is
-- no FK to THREAD on purpose: the run log must outlive a deleted thread so the
-- deletion itself stays visible.
CREATE TABLE IF NOT EXISTS aim_runs (
  run_id           VARCHAR2(128) PRIMARY KEY,
  source           VARCHAR2(16)  DEFAULT 'instrumented' NOT NULL
                   CONSTRAINT aim_runs_source_ck CHECK (source IN ('instrumented', 'replay', 'live')),
  user_id          VARCHAR2(128),
  agent_id         VARCHAR2(128),
  llm_model        VARCHAR2(256),
  embed_model      VARCHAR2(256),
  package_version  VARCHAR2(32),
  first_turn_at    TIMESTAMP(6) WITH TIME ZONE,
  last_turn_at     TIMESTAMP(6) WITH TIME ZONE,
  turn_count       NUMBER DEFAULT 0 NOT NULL,
  notes            JSON
)
/

-- One row per turn. Turn numbers start at 1 and continue across processes.
-- The nullable block at the end is filled only when the agent calls
-- record_prompt(); the inspector cannot see prompts on its own.
CREATE TABLE IF NOT EXISTS aim_turns (
  run_id               VARCHAR2(128) NOT NULL
                       CONSTRAINT aim_turns_run_fk REFERENCES aim_runs (run_id) ON DELETE CASCADE,
  turn                 NUMBER NOT NULL,
  started_at           TIMESTAMP(6) WITH TIME ZONE NOT NULL,
  duration_ms          NUMBER,
  user_message         CLOB,
  retrieved            JSON,   -- [{rank, record_id, record_type, distance, in_prompt}]
  message_ids          JSON,   -- ids written by add_messages this turn
  memory_diff          JSON,   -- {created:[{id,type,content}], updated:[{id,before,after}], deleted:[...]}
  attrs                JSON,   -- closed_by, computed flags, anything else
  assembled_prompt     CLOB,
  prompt_tokens        NUMBER,
  flat_history_tokens  NUMBER,
  token_method         VARCHAR2(256),
  reply                CLOB,
  reply_source         VARCHAR2(16)
                       CONSTRAINT aim_turns_reply_source_ck CHECK (reply_source IN ('scripted', 'model')),
  usage                JSON,
  CONSTRAINT aim_turns_pk PRIMARY KEY (run_id, turn)
)
/

-- One row per lifecycle event. run_id and turn are NULL for package log
-- records emitted outside any open turn (for example background extraction):
-- kept as unattributed rather than dropped.
CREATE TABLE IF NOT EXISTS aim_run_events (
  event_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          VARCHAR2(128)
                  CONSTRAINT aim_run_events_run_fk REFERENCES aim_runs (run_id) ON DELETE CASCADE,
  turn            NUMBER,
  seq             NUMBER NOT NULL,
  parent_seq      NUMBER,
  depth           NUMBER DEFAULT 0 NOT NULL,
  stage           VARCHAR2(16) NOT NULL
                  CONSTRAINT aim_run_events_stage_ck CHECK (stage IN
                    ('ingestion', 'extraction', 'consolidation', 'retrieval', 'summarization', 'revision', 'other')),
  name            VARCHAR2(256) NOT NULL,
  source          VARCHAR2(8) NOT NULL
                  CONSTRAINT aim_run_events_source_ck CHECK (source IN ('wrapper', 'log')),
  started_at      TIMESTAMP(6) WITH TIME ZONE NOT NULL,
  duration_ms     NUMBER,
  input_summary   VARCHAR2(4000),
  output_summary  VARCHAR2(4000),
  memory_ids      JSON,
  scope           JSON,
  tokens          JSON,
  attrs           JSON,
  error           VARCHAR2(4000)
)
/

CREATE INDEX IF NOT EXISTS aim_run_events_turn_i ON aim_run_events (run_id, turn, seq)
/
