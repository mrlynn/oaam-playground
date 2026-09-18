from memory_inspector.diff import MemoryRow, diff_memories


def row(i, content, type_="fact", thread="t1"):
    return MemoryRow(i, type_, content, thread)


def test_created_updated_deleted():
    before = {"a": row("a", "bucket in us-east-1"), "b": row("b", "email only", "preference")}
    after = {"a": row("a", "bucket in us-west-2"), "c": row("c", "prefers dark mode", "preference")}
    d = diff_memories(before, after)
    assert [m["id"] for m in d["created"]] == ["c"]
    assert d["updated"] == [{"id": "a", "type": "fact", "before": "bucket in us-east-1", "after": "bucket in us-west-2"}]
    assert [m["id"] for m in d["deleted"]] == ["b"]
    assert d["deleted"][0]["content"] == "email only"


def test_unchanged_and_reordered_is_empty():
    before = {"a": row("a", "x"), "b": row("b", "y")}
    after = {"b": row("b", "y"), "a": row("a", "x")}
    assert diff_memories(before, after) == {"created": [], "updated": [], "deleted": []}


def test_type_change_counts_as_update():
    d = diff_memories({"a": row("a", "x", "memory")}, {"a": row("a", "x", "fact")})
    assert [m["id"] for m in d["updated"]] == ["a"]
