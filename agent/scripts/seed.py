"""Seed aim_app with every scripted conversation, one thread each.

    uv run python scripts/seed.py            # add threads to the existing store
    uv run python scripts/seed.py --reset    # DROP and recreate the managed schema first

Each conversation is replayed through the companion agent
(`companion --script ... --replay`), so seeds take the same path as real use:
search, prompt assembly, token counts, one add_messages per exchange, all
recorded by memory-inspector. Extraction is an LLM call, so the memories
differ run to run. Nothing downstream should depend on their exact content.
Conversations run in file-name order (support_03 depends on that). A memory
health check (memory-inspector check, judge = AIM_LLM_MODEL) runs last, so a
fresh seed arrives with findings; --no-check skips it.
Run apply_sql.py after --reset.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from oracleagentmemory.core.dbschemapolicy import SchemaPolicy  # noqa: E402

from memory_inspector import install  # noqa: E402
from memory_inspector.health import run_check  # noqa: E402

from aim_demo.config import REPO_DIR, SEED_USER, load_settings  # noqa: E402
from aim_demo.db import build_memory, create_pool  # noqa: E402

COMPANION = REPO_DIR / "companion"
CONVERSATIONS = COMPANION / "conversations"


def clear_run_log(pool) -> None:
    """RECREATE drops the package's threads but not our run log, which would
    then describe threads that no longer exist. Events and turns cascade.
    Check runs go too (their findings name memories that are gone); the judge
    cache stays, since it is keyed by content and still valid."""
    with pool.acquire() as conn:
        cur = conn.cursor()
        if cur.execute("select count(*) from user_tables where table_name = 'AIM_RUNS'").fetchone()[0]:
            cur.execute("delete from aim_run_events where run_id is null")
            cur.execute("delete from aim_runs")
            print(f"run log cleared ({cur.rowcount} runs)")
            if cur.execute("select count(*) from user_tables where table_name = 'AIM_CHECK_RUNS'").fetchone()[0]:
                cur.execute("delete from aim_check_runs")
                print(f"check runs cleared ({cur.rowcount})")
            conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop and recreate the managed schema (destructive)")
    parser.add_argument("--no-check", action="store_true", help="skip the memory health check at the end")
    args = parser.parse_args()

    settings = load_settings()
    if args.reset and settings.db_user != SEED_USER:
        # aim_live holds real conversations. A RECREATE there is unrecoverable.
        sys.exit(f"refusing --reset on {settings.db_user}: only {SEED_USER} may be reset")

    # The replay writes a run log and ends with a health check, so their tables
    # must exist even on a brand-new database (idempotent; independent of the
    # package schema). apply_sql.py still has to run afterwards for the views.
    pool = create_pool(settings)
    with pool.acquire() as conn:
        install(conn, grant_to="aim_web")
    pool.close()

    if args.reset:
        pool = create_pool(settings)
        build_memory(pool, settings, schema_policy=SchemaPolicy.RECREATE).close()
        print("schema recreated")
        clear_run_log(pool)
        pool.close()

    # The companion is its own uv project; don't let this project's venv leak in.
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    for path in sorted(CONVERSATIONS.glob("*.yaml")):
        subprocess.run(["uv", "run", "--project", str(COMPANION), "companion", "--script", str(path),
                        "--db-user", SEED_USER], check=True, env=env)

    if not args.no_check:
        pool = create_pool(settings)
        try:
            report = run_check(pool, judge_model=settings.llm_model)
        finally:
            pool.close()
        by_kind = report.counts["findings"]
        print(f"health check {report.check_run_id}: " + (", ".join(f"{n} {k}" for k, n in sorted(by_kind.items()))
                                                          or "no findings"))


if __name__ == "__main__":
    main()
