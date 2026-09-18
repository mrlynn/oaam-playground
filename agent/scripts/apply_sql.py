"""Install everything the dashboard reads into one schema, then check it.

1. infra/sql/*.sql: read-only views over the package schema (AIM_V_THREADS ...)
   and their grants to aim_web.
2. The memory-inspector run log (AIM_RUNS, AIM_TURNS, AIM_RUN_EVENTS and their
   AIM_V_* views), through the library's public install().

Needs the package schema to exist first. For a new schema, pass --create-store
to let the package create it. Safe to rerun: every statement is idempotent.

    uv run python scripts/apply_sql.py                           # aim_app (seeds)
    uv run python scripts/apply_sql.py --user aim_live --create-store
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector import install  # noqa: E402
from memory_inspector.schema import split_statements  # noqa: E402

from aim_demo.config import KNOWN_USERS, REPO_DIR, load_settings  # noqa: E402
from aim_demo.db import build_memory, create_pool  # noqa: E402

SQL_DIR = REPO_DIR / "infra" / "sql"
PACKAGE_VIEWS = ("AIM_V_THREADS", "AIM_V_MESSAGES", "AIM_V_MEMORIES", "AIM_V_STORE_INFO")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", default="aim_app", choices=KNOWN_USERS, help="schema to install into")
    parser.add_argument("--create-store", action="store_true", help="create the package schema if it is missing")
    args = parser.parse_args()

    settings = load_settings(args.user)
    pool = create_pool(settings)
    with pool.acquire() as conn:
        cur = conn.cursor()
        has_store = cur.execute("select count(*) from user_tables where table_name = 'MEMORY'").fetchone()[0]
    if not has_store:
        if not args.create_store:
            sys.exit(f"MEMORY table not found in {args.user}. Create the package schema first "
                     f"(seed.py for aim_app, or rerun with --create-store).")
        # The constructor with CREATE_IF_NECESSARY creates the managed schema.
        # It also makes one embedding call to learn the vector dimension.
        build_memory(pool, settings).close()
        print(f"package schema created in {args.user}")

    with pool.acquire() as conn:
        cur = conn.cursor()
        for path in sorted(SQL_DIR.glob("*.sql")):
            stmts = split_statements(path.read_text())
            for stmt in stmts:
                cur.execute(stmt)
            print(f"{path.name}: {len(stmts)} statements")
        report = install(conn, grant_to="aim_web")
        for name, count in report.statements.items():
            print(f"{name}: {count} statements (memory-inspector)")
        invalid = cur.execute(
            "select object_name from user_objects where object_name like 'AIM\\_%' escape '\\' and status = 'INVALID'"
        ).fetchall()
        if invalid:
            sys.exit(f"INVALID objects (package schema drift?): {[r[0] for r in invalid]}")
        for view in PACKAGE_VIEWS + ("AIM_V_RUNS", "AIM_V_TURNS", "AIM_V_RUN_EVENTS"):
            print(f"  {args.user}.{view}: {cur.execute(f'select count(*) from {view}').fetchone()[0]} rows")
    pool.close()


if __name__ == "__main__":
    main()
