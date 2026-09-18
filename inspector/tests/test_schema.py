from memory_inspector.schema import TABLES, VIEWS, bundled_scripts, split_statements


def test_split_drops_comments_and_trailing_semicolons():
    text = "-- header\nCREATE TABLE t (x NUMBER);\n/\n\n-- only a comment\n/\nSELECT 1 FROM dual\n/\n"
    assert split_statements(text) == ["CREATE TABLE t (x NUMBER)", "SELECT 1 FROM dual"]


def test_split_keeps_inline_comments():
    stmt = split_statements("CREATE TABLE t (\n  x NUMBER -- why\n)\n/\n")[0]
    assert "-- why" in stmt


def test_scripts_are_bundled_in_apply_order():
    names = [name for name, _ in bundled_scripts()]
    assert names == ["30_runlog.sql", "40_runlog_views.sql", "50_health.sql", "60_health_views.sql"]


def test_every_object_is_created_idempotently():
    stmts = [s for _, text in bundled_scripts() for s in split_statements(text)]
    for stmt in stmts:
        head = " ".join(stmt.split()[:6]).upper()
        assert "IF NOT EXISTS" in head or head.startswith("CREATE OR REPLACE"), head


def test_declared_names_match_the_sql():
    sql = " ".join(text for _, text in bundled_scripts()).upper()
    for name in TABLES:
        assert f"CREATE TABLE IF NOT EXISTS {name} " in sql
    for name in VIEWS:
        assert f"CREATE OR REPLACE VIEW {name} AS" in sql


def test_nothing_touches_package_tables():
    sql = " ".join(text for _, text in bundled_scripts()).upper()
    for package_table in ("FROM MEMORY", "FROM MESSAGE", "FROM THREAD", "RECORD_CHUNKS", "REFERENCES THREAD"):
        assert package_table not in sql
