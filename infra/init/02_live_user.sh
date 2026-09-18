#!/bin/bash
# Creates aim_live in FREEPDB1: a second package schema for real companion
# conversations, kept apart from aim_app so `seed.py --reset` can never wipe
# them. Same grants as aim_app (see 01_users.sh for why each is there).
#
# Runs automatically on a fresh volume. On an existing container, run it once:
#   docker exec -e AIM_LIVE_PASSWORD="$AIM_LIVE_PASSWORD" aim-oracle \
#     bash /container-entrypoint-initdb.d/02_live_user.sh
set -euo pipefail
: "${AIM_LIVE_PASSWORD:?AIM_LIVE_PASSWORD is not set}"
sqlplus -s / as sysdba <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE USER aim_live IDENTIFIED BY "${AIM_LIVE_PASSWORD}"
  DEFAULT TABLESPACE users QUOTA UNLIMITED ON users;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE, CREATE JOB TO aim_live;
EXIT
SQL
