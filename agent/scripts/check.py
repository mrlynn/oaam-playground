"""Run the memory health check with the demo's settings (keys from agent/.env).

    uv run python scripts/check.py                     # aim_app, judge = AIM_LLM_MODEL
    uv run python scripts/check.py --user aim_live
    uv run python scripts/check.py --no-judge --user-id u_alice

Same as `memory-inspector check`, which needs the password and API key in the
environment; this reads them from the repo's .env files instead.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.health import run_check  # noqa: E402

from aim_demo.config import KNOWN_USERS, load_settings  # noqa: E402
from aim_demo.db import create_pool  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", default="aim_app", choices=KNOWN_USERS)
    parser.add_argument("--user-id")
    parser.add_argument("--no-judge", action="store_true")
    parser.add_argument("--threshold", type=float, default=0.15)
    args = parser.parse_args()

    settings = load_settings(args.user)
    pool = create_pool(settings)
    try:
        report = run_check(pool, user_id=args.user_id, threshold=args.threshold,
                           judge_model=None if args.no_judge else settings.llm_model)
    finally:
        pool.close()
    c = report.counts
    print(f"check run {report.check_run_id} on {args.user}: {c['memories']} memories, {c['candidate_pairs']} candidate "
          f"pairs, {c['judge_calls']} judge calls, {c['judge_cache_hits']} cached, {c['unparsed']} unparsed")
    new = {f.fingerprint for f in report.new}
    for f in report.findings:
        print(f"  {'new ' if f.fingerprint in new else '    '}{f.severity:<6} {f.kind:<15} {f.title}")
    for r in report.resolved:
        print(f"  resolved {r['kind']:<15} {r['title']}")


if __name__ == "__main__":
    main()
