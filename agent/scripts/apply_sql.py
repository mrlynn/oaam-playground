"""Apply infra/sql/*.sql in order as aim_app, then fail if any view is invalid.

Needs the package schema to exist first (run smoke.py or seed.py once). Safe
to rerun: every statement is CREATE OR REPLACE or an idempotent GRANT.

    uv run python scripts/apply_sql.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.config import REPO_DIR  # noqa: E402
from memory_inspector.db import create_pool  # noqa: E402

SQL_DIR = REPO_DIR / "infra" / "sql"


def statements(text: str) -> list[str]:
    """Split on lines holding only "/" (SQL*Plus style); drop comment-only chunks."""
    parts = re.split(r"^\s*/\s*$", text, flags=re.MULTILINE)
    out = []
    for part in parts:
        body = "\n".join(line for line in part.splitlines() if not line.strip().startswith("--")).strip()
        if body:
            out.append(body.rstrip(";"))
    return out


def main() -> None:
    pool = create_pool()
    with pool.acquire() as conn:
        cur = conn.cursor()
        if not cur.execute("select count(*) from user_tables where table_name = 'MEMORY'").fetchone()[0]:
            sys.exit("MEMORY table not found. Create the package schema first: uv run python scripts/seed.py")
        for path in sorted(SQL_DIR.glob("*.sql")):
            stmts = statements(path.read_text())
            for stmt in stmts:
                cur.execute(stmt)
            print(f"{path.name}: {len(stmts)} statements")
        invalid = cur.execute(
            "select object_name from user_objects where object_name like 'AIM\\_%' escape '\\' and status = 'INVALID'"
        ).fetchall()
        if invalid:
            sys.exit(f"INVALID objects (package schema drift?): {[r[0] for r in invalid]}")
        for view in ("AIM_V_THREADS", "AIM_V_MESSAGES", "AIM_V_MEMORIES", "AIM_V_STORE_INFO"):
            print(f"  {view}: {cur.execute(f'select count(*) from {view}').fetchone()[0]} rows")
    pool.close()


if __name__ == "__main__":
    main()
