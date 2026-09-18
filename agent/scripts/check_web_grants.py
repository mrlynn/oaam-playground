"""Prove the dashboard login (aim_web) can read the views and nothing else.

    uv run python scripts/check_web_grants.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import oracledb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.config import load_settings  # noqa: E402

VIEWS = ["AIM_V_THREADS", "AIM_V_MESSAGES", "AIM_V_MEMORIES", "AIM_V_STORE_INFO"]
MUST_FAIL = [
    ("read base table", "select count(*) from aim_app.memory"),
    ("read chunk table", "select count(*) from aim_app.record_chunks"),
    ("delete through view", "delete from aim_app.aim_v_memories"),
    ("update through view", "update aim_app.aim_v_threads set user_id = user_id"),
]


def main() -> None:
    settings = load_settings()
    conn = oracledb.connect(user="aim_web", password=os.environ["AIM_WEB_PASSWORD"], dsn=settings.db_dsn)
    cur = conn.cursor()
    failures = 0
    for view in VIEWS:
        count = cur.execute(f"select count(*) from aim_app.{view}").fetchone()[0]
        print(f"ok    read {view}: {count} rows")
    for label, sql in MUST_FAIL:
        try:
            cur.execute(sql)
            print(f"FAIL  {label}: allowed")
            failures += 1
        except oracledb.DatabaseError as exc:
            # 26ai reports missing DML privileges as ORA-41900, not ORA-01031.
            print(f"ok    {label}: blocked ({str(exc).splitlines()[0]})")
    conn.rollback()
    conn.close()
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
