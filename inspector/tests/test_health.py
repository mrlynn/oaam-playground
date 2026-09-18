"""Health checks and the judge, without a database or a model."""

import json
from datetime import datetime, timedelta

import pytest

from memory_inspector.health import checks
from memory_inspector.health.checks import PairOutcome, TurnInput
from memory_inspector.health.judge import MEMORY_VERSION, PAIR_VERSION, DictCache, Judge
from memory_inspector.health.model import Finding, Memory, Pair, Verdict, older_newer

T0 = datetime(2026, 9, 18, 3, 0)


def mem(i, content, type_="fact", minutes=0, thread="t1", user="u1", scope=None):
    return Memory(i, type_, content, user, thread, T0 + timedelta(minutes=minutes), minutes, scope)


EAST = mem("east", "Export bucket is in us-east-1.", minutes=1)
WEST = mem("west", "Export bucket is in us-west-2 (corrected from us-east-1).", minutes=2)
PREF1 = mem("p1", "User prefers email, never phone.", "preference", minutes=1)
PREF2 = mem("p2", "User prefers to be contacted by email only, never by phone, as they are in meetings all day.", "preference", minutes=3)
PREF3 = mem("p3", "User wants email, not calls.", "preference", minutes=4, thread="t2")
CAUSE = mem("cause", "Role is missing s3:PutObject.", minutes=2)
FIX = mem("fix", "Add s3:PutObject to the role and retry.", "guideline", minutes=3)
ASKED = mem("asked", "Assistant asked which region the bucket is in; awaiting reply.", "memory", minutes=1)


def pair(a, b, d):
    older, newer = older_newer(a, b)
    return Pair(older, newer, d)


def v(relation, current=None):
    return Verdict(relation, f"because {relation}", "test-model", current)


# ---- pairs -----------------------------------------------------------------

def test_superseded_names_the_stale_memory_and_how_to_delete_it():
    p = pair(EAST, WEST, 0.042)
    out = checks.check_pairs([p], {("east", "west"): v("supersedes", "newer")})
    (f,) = out.findings
    assert f.kind == "superseded" and f.severity == "high"
    assert f.evidence["stale"] == "east" and f.evidence["current"] == "west"
    assert 'memory.delete_memory("east")' in f.suggestion
    # A supersession can still leave detail only in the stale memory: say so before "delete".
    assert f.suggestion.index("update_memory") < f.suggestion.index("delete_memory")
    assert out.stale == {"east": "west"}


def test_one_stale_memory_superseded_twice_is_one_finding():
    fixed = mem("fixed", "Bucket was previously stated as us-east-1; it is us-west-2.", minutes=3)
    pairs = [pair(EAST, WEST, 0.042), pair(EAST, fixed, 0.06)]
    out = checks.check_pairs(pairs, {("east", "west"): v("supersedes", "newer"), ("east", "fixed"): v("supersedes", "newer")})
    (f,) = out.findings
    assert f.memory_ids == ["east", "west", "fixed"] and f.evidence["current"] == "west"
    assert [s["id"] for s in f.evidence["superseded_by"]] == ["west", "fixed"]
    assert "and 1 more later memory" in f.detail


def test_supersedes_the_other_way_round():
    out = checks.check_pairs([pair(EAST, WEST, 0.04)], {("east", "west"): v("supersedes", "older")})
    assert out.stale == {"west": "east"}


def test_complementary_and_unrelated_are_not_findings():
    out = checks.check_pairs([pair(CAUSE, FIX, 0.07), pair(EAST, FIX, 0.14)],
                             {("cause", "fix"): v("complementary"), ("east", "fix"): v("unrelated")})
    assert out.findings == []


def test_duplicates_cluster_into_one_finding_keeping_the_most_complete():
    pairs = [pair(PREF1, PREF2, 0.09), pair(PREF2, PREF3, 0.1), pair(PREF1, PREF3, 0.12)]
    out = checks.check_pairs(pairs, {(p.older.id, p.newer.id): v("duplicate") for p in pairs})
    (f,) = out.findings
    assert f.kind == "duplicate" and sorted(f.memory_ids) == ["p1", "p2", "p3"]
    assert f.evidence["keep"] == "p2"  # the longest
    assert 'delete_memory("p1")' in f.suggestion and 'delete_memory("p3")' in f.suggestion
    assert 'delete_memory("p2")' not in f.suggestion
    assert "across 2 threads" in f.detail
    assert len(set(out.duplicate_group.values())) == 1


def test_contradiction_and_unparsed():
    out = checks.check_pairs([pair(EAST, WEST, 0.04), pair(CAUSE, FIX, 0.07)],
                             {("east", "west"): v("contradicts"), ("cause", "fix"): v("unparsed")})
    assert sorted(f.kind for f in out.findings) == ["contradiction", "near_duplicate"]


def test_without_a_judge_only_correction_language_counts_as_superseded():
    out = checks.check_pairs([pair(EAST, WEST, 0.04), pair(PREF1, PREF2, 0.09)], {})
    kinds = {f.kind: f for f in out.findings}
    assert kinds["superseded"].method == "sql+pattern" and kinds["superseded"].evidence["pattern"] == "corrected"
    assert kinds["near_duplicate"].method == "sql"
    assert out.duplicate_group == {}


# ---- transient -----------------------------------------------------------------

def test_transient_candidates_are_pattern_matches_and_free_form_memories():
    plain = mem("m", "User is onboarding two analysts.", "memory")
    ids = [m.id for m in checks.transient_candidates([ASKED, plain, EAST])]
    assert ids == ["asked", "m"]


def test_transient_needs_the_judge_to_agree_when_there_is_one():
    plain = mem("m", "User is onboarding two analysts.", "memory")
    found = checks.check_transient([ASKED, plain], {"asked": v("transient"), "m": v("durable")})
    (f,) = found
    assert f.memory_ids == ["asked"] and f.method == "pattern+llm"
    assert "MemoryExtractionConfig(memory_extraction_custom_instructions=" in f.suggestion
    assert "corrects us-east-1" in f.suggestion


def test_transient_by_pattern_alone_says_so():
    (f,) = checks.check_transient([ASKED], {"asked": None})
    assert f.method == "pattern" and "run with a judge model" in f.detail


def test_a_pending_question_answered_later_is_reported_once_as_transient():
    out = checks.check_pairs([pair(ASKED, EAST, 0.09)], {("asked", "east"): v("supersedes", "newer")})
    transient = checks.check_transient([ASKED], {"asked": v("transient")})
    kinds = [f.kind for f in checks.drop_overlaps(out.findings + transient)]
    assert kinds == ["transient"]


# ---- crowded turns --------------------------------------------------------------

def retrieved(*ids, in_prompt=True):
    return [{"search": 1, "rank": i + 1, "record_id": r, "in_prompt": in_prompt} for i, r in enumerate(ids)]


def test_crowded_turns_are_one_finding_per_conversation():
    outcome = PairOutcome(duplicate_group={"p1": 0, "p2": 0}, stale={"east": "west"})
    existing = {"east", "west", "p1", "p2", "asked"}
    turns = [TurnInput("run1", 2, "u1", retrieved("west", "p1")),                     # clean
             TurnInput("run1", 3, "u1", retrieved("east", "west", "p1", "p2", "asked")),  # stale + 2 more
             TurnInput("run1", 4, "u1", retrieved("east", "west"))]                   # stale alone still counts
    (f,) = checks.check_crowded_turns(turns, outcome, {"asked"}, existing)
    assert f.kind == "crowded_turn" and f.turns == [{"run_id": "run1", "turn": 3}, {"run_id": "run1", "turn": 4}]
    assert "worst: turn 3, 3 of 5" in f.title and f.title.startswith("Conversation run1")
    assert f.evidence["turns"][0]["wasted"] == {"east": "stale", "p2": "duplicate", "asked": "transient"}
    assert "turns 3, 4" in f.detail


def test_a_memory_both_stale_and_transient_is_labelled_transient():
    outcome = PairOutcome(stale={"asked": "east"})
    (f,) = checks.check_crowded_turns([TurnInput("r", 1, "u1", retrieved("asked", "east", "p9"))],
                                      outcome, {"asked", "p9"}, {"asked", "east", "p9"})
    assert f.evidence["turns"][0]["wasted"] == {"asked": "transient", "p9": "transient"}


def test_one_wasted_duplicate_alone_is_not_a_crowded_turn():
    outcome = PairOutcome(duplicate_group={"p1": 0, "p2": 0})
    assert checks.check_crowded_turns([TurnInput("r", 1, "u1", retrieved("p1", "p2", "west"))],
                                      outcome, set(), {"p1", "p2", "west"}) == []


def test_results_left_out_of_the_prompt_do_not_count():
    outcome = PairOutcome(stale={"east": "west"})
    rows = retrieved("west") + [{"search": 1, "rank": 2, "record_id": "east", "in_prompt": False}]
    assert checks.check_crowded_turns([TurnInput("r", 1, "u1", rows)], outcome, set(), {"east", "west"}) == []


def test_without_prompt_reporting_everything_returned_counts_and_is_labelled():
    outcome = PairOutcome(stale={"east": "west"})
    (f,) = checks.check_crowded_turns([TurnInput("r", 1, "u1", retrieved("east", "west", in_prompt=None))],
                                      outcome, set(), {"east", "west"})
    assert f.evidence["basis"] == "returned" and "not confirmed" in f.method


def test_deleting_the_stale_memory_resolves_the_crowded_turn():
    outcome = PairOutcome(stale={"east": "west"})
    turn = TurnInput("r", 1, "u1", retrieved("east", "west"))
    assert checks.check_crowded_turns([turn], outcome, set(), {"east", "west"})
    assert checks.check_crowded_turns([turn], outcome, set(), {"west"}) == []


# ---- scope and orphans --------------------------------------------------------------

def test_scope_mismatch_is_one_finding_per_user():
    ms = [mem("a", "x", scope="user"), mem("b", "y", scope="environment"), mem("c", "z", scope="thread"),
          mem("d", "w", scope="user", thread=None), mem("e", "v", scope="user", user="u2")]
    found = {f.user_id: f for f in checks.check_scope_mismatch(ms)}
    assert sorted(found["u1"].memory_ids) == ["a", "b"] and "2 of u1's memories" in found["u1"].title
    assert found["u2"].memory_ids == ["e"]


def test_orphans():
    assert checks.check_orphans([]) == []
    (f,) = checks.check_orphans(["x", "y"])
    assert f.severity == "high" and f.evidence["count"] == 2


# ---- fingerprints ---------------------------------------------------------------------

def test_fingerprint_ignores_order_and_wording():
    a = Finding("duplicate", "medium", "t1", "d", "s", "sql", memory_ids=["b", "a"])
    b = Finding("duplicate", "medium", "other title", "other", "s", "llm", memory_ids=["a", "b"])
    c = Finding("duplicate", "medium", "t1", "d", "s", "sql", memory_ids=["a", "c"])
    assert a.fingerprint == b.fingerprint != c.fingerprint


def test_conversation_and_user_findings_keep_their_identity_as_contents_change():
    before = Finding("crowded_turn", "high", "t", "d", "s", "sql", memory_ids=["a", "b"], subject="run:r1")
    after = Finding("crowded_turn", "high", "t2", "d", "s", "sql", memory_ids=["b"], subject="run:r1")
    other = Finding("crowded_turn", "high", "t", "d", "s", "sql", memory_ids=["a", "b"], subject="run:r2")
    assert before.fingerprint == after.fingerprint != other.fingerprint


# ---- judge ------------------------------------------------------------------------

class FakeModel:
    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def __call__(self, model, prompt):
        self.prompts.append(prompt)
        return self.replies.pop(0)


def test_judge_pair_parses_and_caches():
    model = FakeModel(['Sure: {"relation": "supersedes", "current": "B", "rationale": "B corrects A"}'])
    judge = Judge("m", DictCache(), complete=model)
    first = judge.pair(EAST, WEST)
    second = judge.pair(EAST, WEST)
    assert (first.relation, first.current, first.cached) == ("supersedes", "newer", False)
    assert (second.relation, second.current, second.cached) == ("supersedes", "newer", True)
    assert judge.calls == 1 and judge.hits == 1
    assert "stored earlier" in model.prompts[0] and "us-east-1." in model.prompts[0]


def test_changed_content_or_model_is_judged_again():
    cache = DictCache()
    reply = '{"relation": "duplicate", "current": null, "rationale": "same"}'
    Judge("m", cache, complete=FakeModel([reply])).pair(PREF1, PREF2)
    again = Judge("m2", cache, complete=FakeModel([reply]))
    again.pair(PREF1, PREF2)
    edited = Judge("m", cache, complete=FakeModel([reply]))
    edited.pair(PREF1, mem("p2", PREF2.content + " Really.", "preference", minutes=3))
    assert again.calls == 1 and edited.calls == 1


@pytest.mark.parametrize("reply", ["", "no json here", '{"relation": "maybe"}', '{"relation": "supersedes", "current": null}'])
def test_bad_replies_become_unparsed_and_are_not_cached(reply):
    cache = DictCache()
    judge = Judge("m", cache, complete=FakeModel([reply]))
    assert judge.pair(EAST, WEST).relation == "unparsed"
    assert cache.data == {}


def test_judge_memory():
    judge = Judge("m", DictCache(), complete=FakeModel(['{"kind": "transient", "rationale": "a pending question"}']))
    verdict = judge.memory(ASKED)
    assert verdict.relation == "transient" and judge.memory(ASKED).cached


def test_prompt_versions_are_recorded():
    assert PAIR_VERSION.startswith("pair-") and MEMORY_VERSION.startswith("memory-")


def test_fixture_pairs_all_classify_to_a_finding_or_nothing():
    """Every hand label in the spike fixture maps onto check behaviour without error."""
    from pathlib import Path
    fixture = json.loads((Path(__file__).parent / "fixtures" / "judge_pairs.json").read_text())
    for i, fp in enumerate(fixture["pairs"]):
        older = mem(f"o{i}", fp["older"]["content"], fp["older"]["type"], minutes=1)
        newer = mem(f"n{i}", fp["newer"]["content"], fp["newer"]["type"], minutes=2)
        label = fp["accept"][0]
        verdict = v(label, fp["current"] if label == "supersedes" else None)
        out = checks.check_pairs([Pair(older, newer, fp["distance"])], {(older.id, newer.id): verdict})
        expected = {"duplicate": ["duplicate"], "supersedes": ["superseded"], "complementary": [], "unrelated": []}[label]
        assert [f.kind for f in out.findings] == expected, fp["why"]


def test_a_duplicate_never_keeps_a_transient_copy():
    # Real case: "wants to understand X" and "has asked about X again" judged duplicates, and the
    # longer, transient one was kept, so following both fixes deleted every copy.
    pairs = [pair(PREF1, PREF2, 0.09)]
    verdicts = {(p.older.id, p.newer.id): v("duplicate") for p in pairs}
    out = checks.check_pairs(pairs, verdicts, transient={"p2"})
    assert out.findings == []  # deleting the transient p2 resolves it
    assert out.duplicate_group["p1"] == out.duplicate_group["p2"]  # still counted for crowded turns

    pairs = [pair(PREF1, PREF2, 0.09), pair(PREF2, PREF3, 0.1)]
    out = checks.check_pairs(pairs, {(p.older.id, p.newer.id): v("duplicate") for p in pairs}, transient={"p2"})
    (f,) = out.findings
    assert f.evidence["keep"] != "p2" and 'delete_memory("p2")' not in f.suggestion
