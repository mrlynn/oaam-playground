"""Prove the dashboard login (aim_web) can read the views and nothing else,
in every schema the dashboard can point at.

    uv run python scripts/check_web_grants.py                 # aim_app and aim_live
    uv run python scripts/check_web_grants.py --schema aim_app
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import oracledb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.schema import VIEWS as RUNLOG_VIEWS  # noqa: E402

from aim_demo.config import KNOWN_USERS, load_settings  # noqa: E402

VIEWS = ["AIM_V_THREADS", "AIM_V_MESSAGES", "AIM_V_MEMORIES", "AIM_V_STORE_INFO", *RUNLOG_VIEWS]
MUST_FAIL = [
    ("read base table", "select count(*) from {s}.memory"),
    ("read chunk table", "select count(*) from {s}.record_chunks"),
    ("read run log table", "select count(*) from {s}.aim_turns"),
    ("delete through view", "delete from {s}.aim_v_memories"),
    ("update through view", "update {s}.aim_v_threads set user_id = user_id"),
    ("delete through run log view", "delete from {s}.aim_v_turns"),
    ("insert into run log", "insert into {s}.aim_runs (run_id) values ('x')"),
    ("read findings table", "select count(*) from {s}.aim_findings"),
    ("read judge cache", "select count(*) from {s}.aim_judgments"),
]


def check(cur, schema: str) -> int:
    failures = 0
    for view in VIEWS:
        try:
            count = cur.execute(f"select count(*) from {schema}.{view}").fetchone()[0]
            print(f"ok    {schema}: read {view}: {count} rows")
        except oracledb.DatabaseError as exc:
            print(f"FAIL  {schema}: read {view}: {str(exc).splitlines()[0]}")
            failures += 1
    for label, sql in MUST_FAIL:
        try:
            cur.execute(sql.format(s=schema))
            print(f"FAIL  {schema}: {label}: allowed")
            failures += 1
        except oracledb.DatabaseError as exc:
            # 26ai reports missing DML privileges as ORA-41900, not ORA-01031.
            print(f"ok    {schema}: {label}: blocked ({str(exc).splitlines()[0]})")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--schema", action="append", choices=KNOWN_USERS, help="repeatable; default: all")
    args = parser.parse_args()

    settings = load_settings()
    conn = oracledb.connect(user="aim_web", password=os.environ["AIM_WEB_PASSWORD"], dsn=settings.db_dsn)
    cur = conn.cursor()
    failures = sum(check(cur, schema) for schema in args.schema or KNOWN_USERS)
    conn.rollback()
    conn.close()
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
