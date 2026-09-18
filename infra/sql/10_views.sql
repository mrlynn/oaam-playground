-- Read-only views over the oracleagentmemory 26.6.0 managed schema (schema
-- version 12). Column names come from docs/schema-snapshot.md. The dashboard
-- reads only these views, so package schema drift is absorbed here.
-- Run as AIM_APP via agent/scripts/apply_sql.py. Statements end with a "/" line.

CREATE OR REPLACE VIEW aim_v_messages AS
SELECT m.record_id                                   AS message_id,
       m.thread_id,
       m.order_seq                                   AS seq,
       ROW_NUMBER() OVER (PARTITION BY m.thread_id ORDER BY m.order_seq) AS position,
       m.message_role                                AS role,
       m.content,
       m.user_id,
       m.agent_id,
       m.created_at,
       m.expires_at,
       CASE WHEN m.expires_at <= SYSTIMESTAMP THEN 1 ELSE 0 END AS is_expired,
       m.metadata
  FROM message m
/

CREATE OR REPLACE VIEW aim_v_memories AS
SELECT m.record_id                                   AS memory_id,
       m.memory_type,
       m.content,
       m.thread_id,
       m.user_id,
       m.agent_id,
       m.order_seq                                   AS seq,
       m.created_at,
       m.timestamp                                   AS logical_ts,
       m.expires_at,
       CASE WHEN m.expires_at <= SYSTIMESTAMP THEN 1 ELSE 0 END AS is_expired,
       CASE WHEN JSON_EXISTS(m.metadata, '$."$agent_memory"') THEN 'extracted' ELSE 'explicit' END AS origin,
       JSON_VALUE(m.metadata, '$."$agent_memory".scope')                        AS extractor_scope,
       JSON_VALUE(m.metadata, '$."$agent_memory".importance' RETURNING NUMBER)  AS importance,
       JSON_QUERY(m.metadata, '$."$agent_memory".entities' RETURNING JSON)      AS entities,
       JSON_VALUE(m.metadata, '$."$agent_memory".extraction_id')                AS extraction_id,
       -- Derived, not recorded: how many of the thread's messages existed when
       -- this memory was written. Inline extraction writes memories after the
       -- batch's messages, so this approximates "created after message N".
       (SELECT COUNT(*) FROM message ms
         WHERE ms.thread_id = m.thread_id AND ms.created_at <= m.created_at) AS after_message_position
  FROM memory m
/

CREATE OR REPLACE VIEW aim_v_threads AS
SELECT t.record_id                                   AS thread_id,
       t.user_id,
       t.agent_id,
       t.created_at,
       t.metadata,
       NVL(ms.message_count, 0)                      AS message_count,
       NVL(mm.memory_count, 0)                       AS memory_count,
       GREATEST(t.created_at,
                NVL(ms.last_message_at, t.created_at),
                NVL(mm.last_memory_at, t.created_at)) AS last_activity
  FROM thread t
  LEFT JOIN (SELECT thread_id, COUNT(*) AS message_count, MAX(created_at) AS last_message_at
               FROM message
              WHERE expires_at IS NULL OR expires_at > SYSTIMESTAMP
              GROUP BY thread_id) ms ON ms.thread_id = t.record_id
  LEFT JOIN (SELECT thread_id, COUNT(*) AS memory_count, MAX(created_at) AS last_memory_at
               FROM memory
              WHERE expires_at IS NULL OR expires_at > SYSTIMESTAMP
              GROUP BY thread_id) mm ON mm.thread_id = t.record_id
/

CREATE OR REPLACE VIEW aim_v_store_info AS
SELECT MAX(CASE WHEN metadata_key = 'schema_version'              THEN metadata_value END) AS schema_version,
       MAX(CASE WHEN metadata_key = 'vector_dim'                  THEN metadata_value END) AS vector_dim,
       MAX(CASE WHEN metadata_key = 'record_chunks_indexing_mode' THEN metadata_value END) AS indexing_mode,
       MAX(CASE WHEN metadata_key = 'memory_retention_config'     THEN metadata_value END) AS retention_config
  FROM oracleagentmemory_schema_meta
/
