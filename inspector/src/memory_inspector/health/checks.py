"""The checks. Pure functions from gathered inputs (and judge verdicts) to findings.

Each finding says what is wrong, shows the evidence, and suggests a fix the
agent can apply in code. The dashboard only ever displays them.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from .model import Finding, Memory, Pair, Verdict, quote

TRANSIENT_PATTERN = re.compile(
    r"\b(asked|awaiting|waiting for|has not yet|not yet (confirmed|decided)|will (check|follow up)|pending)\b", re.I)
CORRECTION_PATTERN = re.compile(
    r"\b(correct(s|ed|ing|ion)|previously|no longer|instead of|changed (from|to)|updated from|replac(es|ed))\b", re.I)

# Tested in agent/spikes/custom_instructions.py: removed every transient memory
# in three trials. It cannot stop stale ones; extraction only appends.
EXTRACTION_INSTRUCTIONS = (
    "Store only durable information: facts about the user, their systems and their work; their preferences; "
    "and guidelines worth following next time. Never store what the assistant asked, is waiting for, or is about "
    "to do, and never store the state of the conversation itself. When the user corrects something they said "
    "earlier, store the corrected fact and say what it corrects, e.g. 'bucket is in us-west-2 (corrects us-east-1)'."
)

SEVERITY = {
    "superseded": "high", "contradiction": "high", "crowded_turn": "high", "orphan_chunks": "high",
    "duplicate": "medium", "transient": "medium",
    "near_duplicate": "low", "scope_mismatch": "low",
}


@dataclass(frozen=True)
class TurnInput:
    run_id: str
    turn: int
    user_id: str | None
    retrieved: list[dict[str, Any]]


@dataclass
class PairOutcome:
    findings: list[Finding] = field(default_factory=list)
    duplicate_group: dict[str, int] = field(default_factory=dict)  # memory id -> cluster number
    stale: dict[str, str] = field(default_factory=dict)  # stale memory id -> the id that supersedes it


def _finding(kind: str, **kw: Any) -> Finding:
    return Finding(kind=kind, severity=SEVERITY[kind], **kw)


def _delete(ids: list[str]) -> str:
    return "\n".join(f'memory.delete_memory("{i}")' for i in ids)


# ---- pairs: superseded, contradiction, duplicate, near_duplicate -------------------

def check_pairs(pairs: list[Pair], verdicts: dict[tuple[str, str], Verdict | None]) -> PairOutcome:
    out = PairOutcome()
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    dup_pairs: list[tuple[Pair, Verdict]] = []
    for p in pairs:
        v = verdicts.get((p.older.id, p.newer.id))
        base = {"distance": round(p.distance, 4)}
        if v is None:  # no judge: a correction phrase is the only signal we trust
            if CORRECTION_PATTERN.search(p.newer.content):
                out.findings.append(_superseded(p, stale=p.older, current=p.newer, method="sql+pattern",
                                                evidence={**base, "pattern": CORRECTION_PATTERN.search(p.newer.content)[0]}))
                out.stale[p.older.id] = p.newer.id
            else:
                out.findings.append(_near_duplicate(p, base, "not judged (run with a judge model to classify)"))
            continue
        evidence = {**base, "judge": {"relation": v.relation, "current": v.current, "rationale": v.rationale,
                                      "model": v.model}}
        if v.relation == "supersedes":
            stale, current = (p.older, p.newer) if v.current == "newer" else (p.newer, p.older)
            out.findings.append(_superseded(p, stale=stale, current=current, method="sql+llm", evidence=evidence))
            out.stale[stale.id] = current.id
        elif v.relation == "contradicts":
            out.findings.append(_finding(
                "contradiction", user_id=p.older.user_id, memory_ids=[p.older.id, p.newer.id],
                title=f"Two memories disagree: {quote(p.older.content, 60)} vs {quote(p.newer.content, 60)}",
                detail=("Both are stored and both can be retrieved, and nothing in either says which is current. "
                        f"Search ranks them almost equally (cosine distance {p.distance:.3f} apart)."),
                suggestion="Confirm which is true with the user, then delete the other:\n" + _delete([p.older.id]),
                method="sql+llm", evidence=evidence))
        elif v.relation == "duplicate":
            dup_pairs.append((p, v))
            find(p.older.id), find(p.newer.id)
            parent[find(p.older.id)] = find(p.newer.id)
        elif v.relation == "unparsed":
            out.findings.append(_near_duplicate(p, evidence, "the judge's reply could not be read"))
        # complementary and unrelated: nothing to report

    clusters: dict[str, list[Memory]] = defaultdict(list)
    judged: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p, v in dup_pairs:
        root = find(p.older.id)
        for m in (p.older, p.newer):
            if m not in clusters[root]:
                clusters[root].append(m)
        judged[root].append({"ids": [p.older.id, p.newer.id], "distance": round(p.distance, 4),
                             "rationale": v.rationale, "model": v.model})
    for n, (root, members) in enumerate(clusters.items()):
        keep = max(members, key=lambda m: (len(m.content), m.created_at))
        drop = [m.id for m in members if m.id != keep.id]
        for m in members:
            out.duplicate_group[m.id] = n
        out.findings.append(_finding(
            "duplicate", user_id=keep.user_id, memory_ids=[m.id for m in members],
            title=f"The same {'fact' if keep.type == 'fact' else keep.type} is stored {len(members)} times: {quote(keep.content, 70)}",
            detail=(f"{len(members)} memories say the same thing"
                    f"{' across ' + str(len({m.thread_id for m in members})) + ' threads' if len({m.thread_id for m in members}) > 1 else ''}. "
                    "Each copy can take a prompt slot that another memory needed; nothing dedups across writes."),
            suggestion=f"Keep the most complete copy ({keep.id}) and delete the rest:\n" + _delete(drop),
            method="sql+llm", evidence={"keep": keep.id, "pairs": judged[root]}))
    return out


def _superseded(p: Pair, *, stale: Memory, current: Memory, method: str, evidence: dict[str, Any]) -> Finding:
    return _finding(
        "superseded", user_id=stale.user_id, memory_ids=[stale.id, current.id],
        title=f"Stale memory still stored: {quote(stale.content, 80)}",
        detail=(f"It was superseded by {quote(current.content, 110)}, but both are stored and both can be retrieved: "
                f"they sit {p.distance:.3f} apart (cosine), so a search for one usually returns the other. "
                "Extraction appends corrections instead of revising the earlier memory."),
        suggestion="Delete the stale memory:\n" + _delete([stale.id]),
        method=method, evidence={**evidence, "stale": stale.id, "current": current.id})


def _near_duplicate(p: Pair, evidence: dict[str, Any], why: str) -> Finding:
    return _finding(
        "near_duplicate", user_id=p.older.user_id, memory_ids=[p.older.id, p.newer.id],
        title=f"Two memories are nearly identical in meaning: {quote(p.older.content, 60)} and {quote(p.newer.content, 60)}",
        detail=f"Cosine distance {p.distance:.3f}. Unclassified: {why}.",
        suggestion="Read both; if one repeats or replaces the other, delete it.",
        method="sql", evidence=evidence)


# ---- single memories: transient ------------------------------------------------

def transient_candidates(memories: list[Memory]) -> list[Memory]:
    """Worth judging: anything matching the pattern, plus every free-form "memory"
    (the type the extractor uses for conversation state)."""
    return [m for m in memories if TRANSIENT_PATTERN.search(m.content) or m.type == "memory"]


def check_transient(memories: list[Memory], verdicts: dict[str, Verdict | None]) -> list[Finding]:
    out = []
    for m in memories:
        v = verdicts.get(m.id)
        match = TRANSIENT_PATTERN.search(m.content)
        if v is None:
            if not match:
                continue
            method, evidence = "pattern", {"pattern": match[0], "judge": None}
        elif v.relation == "transient":
            method = "pattern+llm" if match else "llm"
            evidence = {"pattern": match[0] if match else None,
                        "judge": {"kind": v.relation, "rationale": v.rationale, "model": v.model}}
        else:
            continue
        out.append(_finding(
            "transient", user_id=m.user_id, memory_ids=[m.id],
            title=f"Conversation state stored as durable memory: {quote(m.content, 80)}",
            detail=("This records what was happening in one conversation, not something worth knowing in the next. "
                    "It will be retrieved in later sessions and can take a prompt slot."
                    + (" (Pattern match only; run with a judge model to confirm.)" if v is None else "")),
            suggestion=("Delete it:\n" + _delete([m.id]) + "\n\nTo stop new ones, pass "
                        "memory_extraction_custom_instructions when creating threads:\n" + EXTRACTION_INSTRUCTIONS),
            method=method, evidence=evidence))
    return out


# ---- turns: crowded_turn -------------------------------------------------------------

def check_crowded_turns(turns: list[TurnInput], outcome: PairOutcome, transient_ids: set[str],
                        existing: set[str]) -> list[Finding]:
    """Recorded turns whose prompt carried stale, duplicate or transient memories
    that still exist, reported once per conversation (run).

    A turn counts when a stale memory reached the prompt, or when two or more
    slots went to memories that shouldn't be there; one duplicate on its own is
    the duplicate finding's business. Uses the results the agent said it put in
    the prompt; when it didn't say (no record_prompt), everything search returned.
    """
    by_run: dict[str, list[tuple[TurnInput, dict[str, str], int, bool]]] = defaultdict(list)
    for t in turns:
        rows = sorted(t.retrieved, key=lambda r: (r.get("search", 1), r.get("rank", 0)))
        reported = any(r.get("in_prompt") is not None for r in rows)
        used = [r for r in rows if (r.get("in_prompt") is True) or not reported]
        ids = list(dict.fromkeys(r["record_id"] for r in used if r["record_id"] in existing))
        wasted: dict[str, str] = {}
        seen_groups: set[int] = set()
        for i in ids:
            if i in outcome.stale:
                wasted[i] = "stale"
            elif i in transient_ids:
                wasted[i] = "transient"
            elif i in outcome.duplicate_group:
                g = outcome.duplicate_group[i]
                if g in seen_groups:
                    wasted[i] = "duplicate"
                seen_groups.add(g)
        if "stale" in wasted.values() or len(wasted) >= 2:
            by_run[t.run_id].append((t, wasted, len(ids), reported))

    out = []
    for run_id, hits in by_run.items():
        worst_turn, worst, slots, _ = max(hits, key=lambda h: (len(h[1]), -h[0].turn))
        reported = all(h[3] for h in hits)
        stale_turns = [h[0].turn for h in hits if "stale" in h[1].values()]
        why = Counter(k for _, w, _, _ in hits for k in w.values())
        basis = "in the prompt" if reported else "returned by search (the agent didn't report its prompt)"
        out.append(_finding(
            "crowded_turn", user_id=hits[0][0].user_id, subject=f"run:{run_id}",
            memory_ids=list(dict.fromkeys(i for _, w, _, _ in hits for i in w)),
            turns=[{"run_id": run_id, "turn": h[0].turn} for h in hits],
            title=(f"Conversation {run_id[:8]}: {len(hits)} turn{'s' if len(hits) > 1 else ''} spent prompt slots on "
                   f"memories that shouldn't be there (worst: turn {worst_turn.turn}, {len(worst)} of {slots})"),
            detail=(f"Memories {basis} that were stale, duplicated or transient: "
                    + ", ".join(f"{n} {k}" for k, n in why.most_common()) + " slot"
                    + ("s" if sum(why.values()) > 1 else "") + " across these turns."
                    + (f" A stale memory reached the model at turn{'s' if len(stale_turns) > 1 else ''} "
                       + ", ".join(map(str, stale_turns)) + "." if stale_turns else "")
                    + " Fixing the linked superseded, duplicate and transient findings frees them."),
            suggestion="Resolve the superseded, duplicate and transient findings for these memories, then ask again.",
            method="sql" if reported else "sql (returned, not confirmed in prompt)",
            evidence={"turns": [{"turn": h[0].turn, "wasted": h[1], "slots": h[2]} for h in hits],
                      "basis": "in_prompt" if reported else "returned"}))
    return out


# ---- store: scope_mismatch, orphan_chunks ----------------------------------------

def check_scope_mismatch(memories: list[Memory]) -> list[Finding]:
    by_user: dict[str | None, list[Memory]] = defaultdict(list)
    for m in memories:
        if m.thread_id and m.scope_label and m.scope_label != "thread":
            by_user[m.user_id].append(m)
    out = []
    for user, ms in by_user.items():
        labels = Counter(m.scope_label for m in ms)
        out.append(_finding(
            "scope_mismatch", user_id=user, subject=f"user:{user}", memory_ids=[m.id for m in ms[:100]],
            title=(f"{len(ms)} of {user or 'an unnamed user'}'s memories are labelled broader than one conversation "
                   "but will be deleted with their thread"),
            detail=("The extractor labelled these as broader than one conversation, but each is stored on a thread, "
                    "and deleting that thread cascades to them. A user's preferences can vanish when an old "
                    "support thread is cleaned up."),
            suggestion=("Before deleting a thread, copy the memories you want to keep to user level:\n"
                        'memory.add_memory(content, user_id="…", memory_type="preference")  # no thread_id'),
            method="sql", evidence={"labels": dict(labels), "count": len(ms)}))
    return out


def check_orphans(orphan_ids: list[str]) -> list[Finding]:
    if not orphan_ids:
        return []
    return [_finding(
        "orphan_chunks", subject="store", memory_ids=orphan_ids[:100],
        title=f"{len(orphan_ids)} embedded chunks point at records that no longer exist",
        detail=("The chunk table has no foreign key to the records it embeds; the package deletes chunks itself. "
                "These survived a delete, and search can still return them."),
        suggestion="Find what deleted the source records outside the package's API, then remove the chunks by id.",
        method="sql", evidence={"count": len(orphan_ids)})]


def drop_overlaps(findings: list[Finding]) -> list[Finding]:
    """A pending question answered later is both "superseded" and "transient";
    report it once, as transient, whose fix (delete it, stop new ones) covers both."""
    transient = {f.memory_ids[0] for f in findings if f.kind == "transient"}
    return [f for f in findings if not (f.kind == "superseded" and f.evidence.get("stale") in transient)]
