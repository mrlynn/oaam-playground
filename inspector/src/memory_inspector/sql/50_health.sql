-- Memory health checks (memory-inspector check). Our tables only: the checks
-- read the package's memory and chunk tables from Python and never write to them.

-- One row per `memory-inspector check`.
CREATE TABLE IF NOT EXISTS aim_check_runs (
  check_run_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at       TIMESTAMP(6) WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  finished_at      TIMESTAMP(6) WITH TIME ZONE,
  scope_user_id    VARCHAR2(128),        -- NULL: every user in the store
  params           JSON,                 -- thresholds, patterns, judge settings
  counts           JSON,                 -- findings per kind, judge calls, cache hits
  judge_model      VARCHAR2(256),        -- NULL: ran without a judge
  package_version  VARCHAR2(32)
)
/

-- Findings of one check run. fingerprint identifies "the same finding" across
-- runs (kind + memory ids + turns), which is how new and resolved are computed.
CREATE TABLE IF NOT EXISTS aim_findings (
  finding_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_run_id  NUMBER NOT NULL
                CONSTRAINT aim_findings_run_fk REFERENCES aim_check_runs (check_run_id) ON DELETE CASCADE,
  fingerprint   VARCHAR2(64) NOT NULL,
  kind          VARCHAR2(24) NOT NULL
                CONSTRAINT aim_findings_kind_ck CHECK (kind IN
                  ('superseded', 'contradiction', 'duplicate', 'near_duplicate', 'transient',
                   'crowded_turn', 'scope_mismatch', 'orphan_chunks')),
  severity      VARCHAR2(8) NOT NULL
                CONSTRAINT aim_findings_severity_ck CHECK (severity IN ('high', 'medium', 'low')),
  user_id       VARCHAR2(128),
  memory_ids    JSON,
  turns         JSON,                     -- [{run_id, turn}]
  title         VARCHAR2(400) NOT NULL,
  detail        VARCHAR2(4000),
  suggestion    VARCHAR2(4000),
  evidence      JSON,                     -- distances, judge verdicts and rationales, matched patterns
  method        VARCHAR2(16) NOT NULL     -- sql, pattern, llm, or a combination such as sql+llm
)
/

CREATE INDEX IF NOT EXISTS aim_findings_run_i ON aim_findings (check_run_id, severity)
/

-- Cached judge verdicts, keyed by model, prompt version and the exact content
-- judged, so reruns are stable and free. Not granted to the dashboard: each
-- finding copies the verdict and rationale it relied on into its evidence.
CREATE TABLE IF NOT EXISTS aim_judgments (
  cache_key      VARCHAR2(64) PRIMARY KEY,
  kind           VARCHAR2(8) NOT NULL CONSTRAINT aim_judgments_kind_ck CHECK (kind IN ('pair', 'memory')),
  verdict        VARCHAR2(24) NOT NULL,
  current_side   VARCHAR2(8),             -- for pair "supersedes": older or newer
  rationale      VARCHAR2(2000),
  model          VARCHAR2(256) NOT NULL,
  judge_version  VARCHAR2(32) NOT NULL,
  created_at     TIMESTAMP(6) WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
)
/
