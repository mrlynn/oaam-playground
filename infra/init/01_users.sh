#!/bin/bash
# Runs once, on first container start, as SYSDBA. Creates two users in FREEPDB1:
#   aim_app  - owns the package-managed agent memory schema and our run log tables
#   aim_web  - read-only login for the dashboard; SELECT grants are added after the
#              schema exists (infra/sql/, milestone 2)
# Grants for aim_app are deliberately explicit rather than DB_DEVELOPER_ROLE so
# phase 0 can record exactly what oracleagentmemory needs.
set -euo pipefail
sqlplus -s / as sysdba <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE USER aim_app IDENTIFIED BY "${AIM_APP_PASSWORD}"
  DEFAULT TABLESPACE users QUOTA UNLIMITED ON users;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE TO aim_app;
-- The package creates a scheduler job that purges expired records. Without this
-- it warns and continues: expired rows are hidden but never physically removed.
GRANT CREATE JOB TO aim_app;

CREATE USER aim_web IDENTIFIED BY "${AIM_WEB_PASSWORD}";
GRANT CREATE SESSION TO aim_web;
EXIT
SQL
