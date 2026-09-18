-- Read-only views over the health checks, granted by `memory-inspector init`.

CREATE OR REPLACE VIEW aim_v_check_runs AS
SELECT check_run_id, started_at, finished_at, scope_user_id, params, counts, judge_model, package_version
  FROM aim_check_runs
/

CREATE OR REPLACE VIEW aim_v_findings AS
SELECT finding_id, check_run_id, fingerprint, kind, severity, user_id, memory_ids, turns,
       title, detail, suggestion, evidence, method
  FROM aim_findings
/
