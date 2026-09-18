"""Install the run log tables and views into the connected schema.

Everything is idempotent (IF NOT EXISTS, CREATE OR REPLACE, GRANT), so
`install` is safe to call on every start. It never touches package objects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from importlib.resources import files

VIEWS = ("AIM_V_RUNS", "AIM_V_TURNS", "AIM_V_RUN_EVENTS", "AIM_V_MEMORY_RETRIEVALS")
TABLES = ("AIM_RUNS", "AIM_TURNS", "AIM_RUN_EVENTS")

_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")


def split_statements(text: str) -> list[str]:
    """Split SQL*Plus-style scripts on lines holding only "/"; drop comment-only chunks."""
    parts = re.split(r"^\s*/\s*$", text, flags=re.MULTILINE)
    out = []
    for part in parts:
        body = "\n".join(line for line in part.splitlines() if not line.strip().startswith("--")).strip()
        if body:
            out.append(body.rstrip(";"))
    return out


def bundled_scripts() -> list[tuple[str, str]]:
    """(name, text) for each bundled .sql file, in apply order."""
    sql_dir = files("memory_inspector") / "sql"
    scripts = sorted((p for p in sql_dir.iterdir() if p.name.endswith(".sql")), key=lambda p: p.name)
    return [(p.name, p.read_text(encoding="utf-8")) for p in scripts]


@dataclass
class InstallReport:
    schema: str
    statements: dict[str, int] = field(default_factory=dict)
    granted_to: str | None = None


def install(conn, grant_to: str | None = None) -> InstallReport:
    """Create the run log in the connection's current schema.

    `grant_to` gets SELECT on the AIM_V_* run log views and nothing else.
    Raises RuntimeError if any run log object is left INVALID.
    """
    if grant_to is not None and not _IDENTIFIER.match(grant_to):
        raise ValueError(f"grant_to is not a valid Oracle identifier: {grant_to!r}")
    cur = conn.cursor()
    report = InstallReport(schema=cur.execute("select sys_context('userenv', 'current_schema') from dual").fetchone()[0])
    for name, text in bundled_scripts():
        stmts = split_statements(text)
        for stmt in stmts:
            cur.execute(stmt)
        report.statements[name] = len(stmts)
    if grant_to:
        for view in VIEWS:
            cur.execute(f"GRANT SELECT ON {view} TO {grant_to}")
        report.granted_to = grant_to.upper()
    names = ", ".join(f"'{n}'" for n in VIEWS + TABLES)
    invalid = [r[0] for r in cur.execute(
        f"select object_name from user_objects where object_name in ({names}) and status = 'INVALID'"
    )]
    if invalid:
        raise RuntimeError(f"run log objects are INVALID after install: {invalid}")
    return report
