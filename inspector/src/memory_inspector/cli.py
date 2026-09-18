"""memory-inspector command line.

    memory-inspector init --user aim_app --dsn localhost:1521/FREEPDB1 --grant-to aim_web

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


def _init(args: argparse.Namespace) -> int:
    password = os.environ.get(PASSWORD_ENV) or getpass.getpass(f"password for {args.user}: ")
    with oracledb.connect(user=args.user, password=password, dsn=args.dsn) as conn:
        report = install(conn, grant_to=args.grant_to)
    for name, count in report.statements.items():
        print(f"{name}: {count} statements")
    print(f"run log installed in {report.schema}" + (f"; views granted to {report.granted_to}" if report.granted_to else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="memory-inspector", description="Agent memory inspector")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="create the run log tables and views in a schema (idempotent)")
    init.add_argument("--user", required=True, help="schema owner; the same user your agent's memory client connects as")
    init.add_argument("--dsn", required=True, help="e.g. localhost:1521/FREEPDB1")
    init.add_argument("--grant-to", help="read-only dashboard user to receive SELECT on the views")
    init.set_defaults(func=_init)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (oracledb.Error, RuntimeError, ValueError) as exc:
        print(f"memory-inspector: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
