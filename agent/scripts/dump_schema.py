"""Dump the aim_app schema to docs/schema-snapshot.md.

This file is the contract for everything downstream (views, dashboard). Rerun it
whenever the oracleagentmemory version changes and diff it in git.

    uv run python scripts/dump_schema.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from memory_inspector.config import REPO_DIR, load_settings  # noqa: E402
from memory_inspector.db import create_pool  # noqa: E402

OUT = REPO_DIR / "docs" / "schema-snapshot.md"


def rows(cur, sql: str, **binds) -> list[tuple]:
    return cur.execute(sql, binds).fetchall()


def table(headers: list[str], data: list[tuple]) -> str:
    def cell(v) -> str:
        return "" if v is None else str(v).replace("|", "\\|").replace("\n", " ")

    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(cell(v) for v in r) + " |" for r in data]
    return "\n".join(lines)


def main() -> None:
    settings = load_settings()
    pool = create_pool(settings)
    out: list[str] = []
    with pool.acquire() as conn:
        cur = conn.cursor()
        db_version = rows(cur, "select version_full from product_component_version")[0][0]
        out += [
            "# Schema snapshot",
            "",
            f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} by `agent/scripts/dump_schema.py`.",
            "",
            f"- oracleagentmemory: **{version('oracleagentmemory')}**",
            f"- oracledb (python): {version('oracledb')}",
            f"- Database: Oracle AI Database Free {db_version}",
            f"- Schema: `{settings.db_user.upper()}`",
            f"- Embedding model: `{settings.embed_model}`",
            "",
            "Do not edit by hand. Rerun after any package version bump and diff.",
            "",
        ]

        all_tables = [r[0] for r in rows(cur, "select table_name from user_tables where nested = 'NO' order by table_name")]
        # HNSW index internals are named after object ids that change on every
        # recreate; list them, but keep them out of the column/constraint detail.
        internal = [t for t in all_tables if t.startswith("VECTOR$")]
        tables = [t for t in all_tables if t not in internal]
        counts = []
        for t in tables:
            try:
                counts.append((t, rows(cur, f'select count(*) from "{t}"')[0][0]))
            except Exception as exc:
                counts.append((t, f"error: {exc}"))
        out += ["## Tables and row counts", "", table(["table", "rows"], counts), ""]
        out += [
            f"Plus {len(internal)} vector index internal tables (`VECTOR$<index>$<object ids>$HNSW_*`), omitted below.",
            "",
        ]

        if "ORACLEAGENTMEMORY_SCHEMA_META" in tables:
            meta = rows(cur, "select metadata_key, metadata_value from oracleagentmemory_schema_meta order by 1")
            out += ["## Package schema metadata", "", table(["key", "value"], meta), ""]

        for t in tables:
            cols = rows(
                cur,
                """select column_name, data_type, data_length, data_precision, data_scale,
                          nullable, data_default
                     from user_tab_columns where table_name = :t order by column_id""",
                t=t,
            )
            out += [f"### {t}", "", table(["column", "type", "length", "precision", "scale", "nullable", "default"], cols), ""]

        cons = rows(
            cur,
            """select c.table_name, c.constraint_name, c.constraint_type,
                      listagg(cc.column_name, ', ') within group (order by cc.position),
                      r.table_name, c.delete_rule, c.search_condition_vc
                 from user_constraints c
                 left join user_cons_columns cc on cc.constraint_name = c.constraint_name
                 left join user_constraints r on r.constraint_name = c.r_constraint_name
                where c.constraint_type in ('P', 'U', 'R', 'C')
                  and c.table_name not like 'VECTOR$%'
                  and not (c.constraint_type = 'C' and c.search_condition_vc like '%IS NOT NULL')
                group by c.table_name, c.constraint_name, c.constraint_type, r.table_name,
                         c.delete_rule, c.search_condition_vc
                order by c.table_name, c.constraint_type, c.constraint_name""",
        )
        out += [
            "## Constraints",
            "",
            "Type: P primary, U unique, R foreign key, C check (NOT NULL checks omitted).",
            "",
            table(["table", "constraint", "type", "columns", "references", "on delete", "condition"], cons),
            "",
        ]

        idx = rows(
            cur,
            """select i.table_name, i.index_name, i.index_type, i.index_subtype, i.ityp_name,
                      i.uniqueness,
                      listagg(ic.column_name, ', ') within group (order by ic.column_position)
                 from user_indexes i
                 left join user_ind_columns ic on ic.index_name = i.index_name
                where i.table_name not like 'VECTOR$%' and i.index_type <> 'LOB'
                group by i.table_name, i.index_name, i.index_type, i.index_subtype, i.ityp_name, i.uniqueness
                order by i.table_name, i.index_name""",
        )
        out += ["## Indexes", "", table(["table", "index", "type", "subtype", "domain type", "unique", "columns"], idx), ""]

        for title, sql, headers in [
            ("Views", "select view_name, text_length from user_views order by 1", ["view", "text length"]),
            ("Sequences", "select sequence_name, increment_by, last_number from user_sequences order by 1", ["sequence", "increment", "last"]),
            ("Triggers", "select trigger_name, table_name, triggering_event, status from user_triggers order by 1", ["trigger", "table", "event", "status"]),
            (
                "Scheduler jobs",
                "select job_name, job_type, repeat_interval, enabled, state from user_scheduler_jobs order by 1",
                ["job", "type", "repeat", "enabled", "state"],
            ),
            (
                "Other objects",
                """select object_type, object_name from user_objects
                    where object_type not in ('TABLE', 'INDEX', 'VIEW', 'SEQUENCE', 'TRIGGER', 'JOB', 'LOB', 'INDEX PARTITION', 'TABLE PARTITION', 'LOB PARTITION')
                    order by 1, 2""",
                ["type", "name"],
            ),
        ]:
            out += [f"## {title}", "", table(headers, rows(cur, sql)), ""]

    pool.close()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(out))
    print(f"wrote {OUT} ({len(tables)} tables, {len(internal)} vector index internals)")


if __name__ == "__main__":
    main()
