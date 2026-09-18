-- Read-only views over the run log. Dashboards read these, never the tables.
-- Installed by `memory-inspector init`, which also grants SELECT on every
-- AIM_V_* view below to the --grant-to user.

CREATE OR REPLACE VIEW aim_v_runs AS
SELECT run_id, source, user_id, agent_id, llm_model, embed_model, package_version,
       first_turn_at, last_turn_at, turn_count, notes
  FROM aim_runs
/

CREATE OR REPLACE VIEW aim_v_turns AS
SELECT run_id, turn, started_at, duration_ms, user_message, retrieved, message_ids,
       memory_diff, attrs, assembled_prompt, prompt_tokens, flat_history_tokens,
       token_method, reply, reply_source, usage
  FROM aim_turns
/

CREATE OR REPLACE VIEW aim_v_run_events AS
SELECT event_id, run_id, turn, seq, parent_seq, depth, stage, name, source,
       started_at, duration_ms, input_summary, output_summary, memory_ids, scope,
       tokens, attrs, error
  FROM aim_run_events
/

-- One row per search result per turn. Retrieval counts and "retrieved at
-- turn n" both come from here. in_prompt is 1/0 when the agent reported which
-- results it used (record_prompt), NULL when we only know search returned it.
CREATE OR REPLACE VIEW aim_v_memory_retrievals AS
SELECT t.run_id,
       t.turn,
       t.started_at,
       jt.rank,
       jt.record_id,
       jt.record_type,
       jt.distance,
       CASE jt.in_prompt WHEN 'true' THEN 1 WHEN 'false' THEN 0 END AS in_prompt
  FROM aim_turns t,
       JSON_TABLE(t.retrieved, '$[*]'
         COLUMNS (rank        NUMBER         PATH '$.rank',
                  record_id   VARCHAR2(128)  PATH '$.record_id',
                  record_type VARCHAR2(32)   PATH '$.record_type',
                  distance    NUMBER         PATH '$.distance',
                  in_prompt   VARCHAR2(5)    PATH '$.in_prompt')) jt
/
