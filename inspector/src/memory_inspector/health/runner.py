"""Run every check once and record the result as one check run.

Findings are written in one transaction with their check run. Judge verdicts
are committed to the cache as they arrive, so an interrupted run keeps what it
paid for.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from typing import Any

import oracledb

from . import checks
from .gather import Tables, candidate_pairs, load_memories, orphan_chunks, recorded_turns
from .judge import MEMORY_VERSION, PAIR_VERSION, Judge
from .model import Finding

DEFAULT_THRESHOLD = 0.15  # cosine; tuned on 34 seed memories, re-checked on real data


class DbCache:
    """Judge cache in AIM_JUDGMENTS, on its own connection so every verdict commits."""

    def __init__(self, pool) -> None:
        self.pool = pool

    def get(self, key: str) -> dict[str, Any] | None:
        with self.pool.acquire() as conn:
            row = conn.cursor().execute(
                "select verdict, current_side, rationale from aim_judgments where cache_key = :k", {"k": key}).fetchone()
        return None if row is None else {"relation": row[0], "current": row[1], "rationale": row[2] or ""}

    def put(self, key: str, kind: str, value: dict[str, Any], model: str, version: str) -> None:
        with self.pool.acquire() as conn:
            try:
                conn.cursor().execute(
                    """insert into aim_judgments (cache_key, kind, verdict, current_side, rationale, model, judge_version)
                       values (:k, :kind, :v, :c, :r, :m, :jv)""",
                    {"k": key, "kind": kind, "v": value["relation"], "c": value.get("current"),
                     "r": value.get("rationale"), "m": model, "jv": version})
                conn.commit()
            except oracledb.IntegrityError:
                pass  # another run cached it first


@dataclass
class CheckReport:
    check_run_id: int
    findings: list[Finding]
    counts: dict[str, Any]
    new: list[Finding] = field(default_factory=list)
    resolved: list[dict[str, Any]] = field(default_factory=list)  # {fingerprint, kind, title} from the previous run


def gather_and_check(conn, *, tables: Tables, user_id: str | None, threshold: float,
                     judge: Judge | None) -> tuple[list[Finding], dict[str, Any]]:
    memories = load_memories(conn, tables, user_id)
    pairs = candidate_pairs(conn, tables, memories, threshold, user_id)
    pair_verdicts = {(p.older.id, p.newer.id): judge.pair(p.older, p.newer) if judge else None for p in pairs}
    to_judge = checks.transient_candidates(list(memories.values()))
    memory_verdicts = {m.id: judge.memory(m) if judge else None for m in to_judge}

    transient = checks.check_transient(to_judge, memory_verdicts)
    transient_ids = {f.memory_ids[0] for f in transient}
    outcome = checks.check_pairs(pairs, pair_verdicts, transient_ids)
    findings = checks.drop_overlaps(outcome.findings + transient)
    findings += checks.check_crowded_turns(recorded_turns(conn, user_id), outcome, transient_ids, set(memories))
    findings += checks.check_scope_mismatch(list(memories.values()))
    findings += checks.check_orphans(orphan_chunks(conn, tables))

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order[f.severity], f.kind, f.title))
    counts = {
        "memories": len(memories), "candidate_pairs": len(pairs), "judged_memories": len(to_judge),
        "findings": dict(Counter(f.kind for f in findings)),
        "judge_calls": judge.calls if judge else 0, "judge_cache_hits": judge.hits if judge else 0,
        "unparsed": sum(1 for v in [*pair_verdicts.values(), *memory_verdicts.values()] if v and v.relation == "unparsed"),
    }
    return findings, counts


def run_check(pool, *, user_id: str | None = None, threshold: float = DEFAULT_THRESHOLD,
              judge_model: str | None = None, tables: Tables = Tables(), complete=None) -> CheckReport:
    """Run the checks and write one check run. `complete` overrides the LLM call (tests)."""
    judge = None
    if judge_model:
        judge = Judge(judge_model, DbCache(pool), **({"complete": complete} if complete else {}))
    params = {"threshold": threshold, "judge_versions": [PAIR_VERSION, MEMORY_VERSION] if judge else None,
              "transient_pattern": checks.TRANSIENT_PATTERN.pattern,
              "correction_pattern": checks.CORRECTION_PATTERN.pattern,
              "tables": {"memory": tables.memory, "chunks": tables.chunks, "message": tables.message}}
    try:
        package_version = version("oracleagentmemory")
    except PackageNotFoundError:
        package_version = None

    with pool.acquire() as conn:
        findings, counts = gather_and_check(conn, tables=tables, user_id=user_id, threshold=threshold, judge=judge)
        cur = conn.cursor()
        previous = cur.execute(
            """select max(check_run_id) from aim_check_runs
                where finished_at is not null
                  and decode(scope_user_id, :u, 1, 0) = 1
                  and decode(judge_model, :m, 1, 0) = 1""",  # compare like with like: same scope, same judge
            {"u": user_id, "m": judge_model}).fetchone()[0]
        run_id = cur.var(oracledb.NUMBER)
        cur.setinputsizes(p=oracledb.DB_TYPE_JSON, c=oracledb.DB_TYPE_JSON)
        cur.execute(
            """insert into aim_check_runs (scope_user_id, params, counts, judge_model, package_version, finished_at)
               values (:u, :p, :c, :m, :v, systimestamp) returning check_run_id into :id""",
            {"u": user_id, "p": params, "c": counts, "m": judge_model, "v": package_version, "id": run_id})
        check_run_id = int(run_id.getvalue()[0])
        if findings:
            cur.setinputsizes(ids=oracledb.DB_TYPE_JSON, turns=oracledb.DB_TYPE_JSON, ev=oracledb.DB_TYPE_JSON)
            cur.executemany(
                """insert into aim_findings (check_run_id, fingerprint, kind, severity, user_id, memory_ids, turns,
                                            title, detail, suggestion, evidence, method)
                   values (:run, :fp, :kind, :sev, :u, :ids, :turns, :title, :detail, :sugg, :ev, :method)""",
                [{"run": check_run_id, "fp": f.fingerprint, "kind": f.kind, "sev": f.severity, "u": f.user_id,
                  "ids": f.memory_ids, "turns": f.turns, "title": f.title[:400], "detail": f.detail[:4000],
                  "sugg": f.suggestion[:4000], "ev": json.loads(json.dumps(f.evidence, default=str)),
                  "method": f.method} for f in findings])
        before: list[tuple[str, str, str]] = []
        if previous is not None:
            before = cur.execute("select fingerprint, kind, title from aim_findings where check_run_id = :r",
                                 {"r": previous}).fetchall()
        conn.commit()

    now = {f.fingerprint for f in findings}
    was = {fp for fp, _, _ in before}
    return CheckReport(
        check_run_id=check_run_id, findings=findings, counts=counts,
        new=[f for f in findings if f.fingerprint not in was] if previous is not None else list(findings),
        resolved=[{"fingerprint": fp, "kind": k, "title": t} for fp, k, t in before if fp not in now])
