"""memory-inspector command line.

    memory-inspector init --user aim_app --dsn localhost:1521/FREEPDB1 --grant-to aim_web
    memory-inspector check --user aim_app --dsn localhost:1521/FREEPDB1 --judge-model anthropic/claude-sonnet-5

The password comes from $MEMORY_INSPECTOR_DB_PASSWORD, or a prompt. It is
never taken as an argument, so it stays out of shell history.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys

import oracledb

from .schema import install

PASSWORD_ENV = "MEMORY_INSPECTOR_DB_PASSWORD"
JUDGE_ENV = "MEMORY_INSPECTOR_JUDGE_MODEL"


def _init(args: argparse.Namespace) -> int:
    password = os.environ.get(PASSWORD_ENV) or getpass.getpass(f"password for {args.user}: ")
    with oracledb.connect(user=args.user, password=password, dsn=args.dsn) as conn:
        report = install(conn, grant_to=args.grant_to)
    for name, count in report.statements.items():
        print(f"{name}: {count} statements")
    print(f"run log installed in {report.schema}" + (f"; views granted to {report.granted_to}" if report.granted_to else ""))
    return 0


def _check(args: argparse.Namespace) -> int:
    from .health import run_check
    from .health.gather import Tables

    password = os.environ.get(PASSWORD_ENV) or getpass.getpass(f"password for {args.user}: ")
    judge_model = None if args.no_judge else (args.judge_model or os.environ.get(JUDGE_ENV))
    if not judge_model and not args.no_judge:
        print(f"no judge model (--judge-model or ${JUDGE_ENV}); running without one: candidate pairs are reported "
              "unclassified and transient memories by pattern only")
    pool = oracledb.create_pool(user=args.user, password=password, dsn=args.dsn, min=1, max=2, increment=1)
    try:
        report = run_check(pool, user_id=args.user_id, threshold=args.threshold, judge_model=judge_model,
                           tables=Tables(args.memory_table, args.chunk_table, args.message_table))
    finally:
        pool.close()
    c = report.counts
    print(f"check run {report.check_run_id}: {c['memories']} memories, {c['candidate_pairs']} candidate pairs, "
          f"judge {judge_model or 'off'} ({c['judge_calls']} calls, {c['judge_cache_hits']} cached"
          f"{', ' + str(c['unparsed']) + ' unparsed' if c['unparsed'] else ''})")
    new = {f.fingerprint for f in report.new}
    for f in report.findings:
        mark = "new " if f.fingerprint in new else "    "
        print(f"  {mark}{f.severity:<6} {f.kind:<15} {f.title}")
    for r in report.resolved:
        print(f"  resolved {r['kind']:<15} {r['title']}")
    if not report.findings:
        print("  no findings")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="memory-inspector", description="Agent memory inspector")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="create the run log tables and views in a schema (idempotent)")
    init.add_argument("--user", required=True, help="schema owner; the same user your agent's memory client connects as")
    init.add_argument("--dsn", required=True, help="e.g. localhost:1521/FREEPDB1")
    init.add_argument("--grant-to", help="read-only dashboard user to receive SELECT on the views")
    init.set_defaults(func=_init)
    check = sub.add_parser("check", help="find stale, duplicate and transient memories (writes AIM_FINDINGS)")
    check.add_argument("--user", required=True, help="schema owner, as for init")
    check.add_argument("--dsn", required=True)
    check.add_argument("--user-id", help="check one memory user only (default: everyone in the store)")
    check.add_argument("--judge-model", help=f"LiteLLM model id for the judge (default: ${JUDGE_ENV})")
    check.add_argument("--no-judge", action="store_true", help="deterministic checks only; no model calls")
    check.add_argument("--threshold", type=float, default=0.15, help="cosine distance for candidate pairs")
    check.add_argument("--memory-table", default="MEMORY")
    check.add_argument("--chunk-table", default="RECORD_CHUNKS")
    check.add_argument("--message-table", default="MESSAGE")
    check.set_defaults(func=_check)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (oracledb.Error, RuntimeError, ValueError) as exc:
        print(f"memory-inspector: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
