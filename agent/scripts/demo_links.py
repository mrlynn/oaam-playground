"""Print today's demo URLs for the seeded aim_app data.

Thread ids change on every `seed.py --reset`, so the demo guide points here
instead of at fixed links. This finds each demo moment in the current data and
says plainly when one didn't reproduce this time (extraction is an LLM, so a
seed can occasionally miss a beat).

    uv run python scripts/demo_links.py
    uv run python scripts/demo_links.py --base http://localhost:3001
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aim_demo.config import SEED_USER, load_settings  # noqa: E402
from aim_demo.db import create_pool  # noqa: E402

SEED_ALICE = "u_alice"  # the seeds' user; the labs write to aim_app too, as lab1..lab3
CORRECTION = "Actually wait"  # support_01, exchange 3
MIXED = "Which region is my export bucket in, and how should you contact me?"  # support_03


def find_turn(cur, text: str) -> tuple[str, int] | None:
    row = cur.execute(
        """select t.run_id, t.turn from aim_turns t join aim_runs r on r.run_id = t.run_id
            where r.user_id = :u and dbms_lob.instr(t.user_message, :t) > 0
            order by t.started_at desc fetch first 1 row only""", {"u": SEED_ALICE, "t": text}).fetchone()
    return (row[0], int(row[1])) if row else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:3000", help="dashboard URL")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    pool = create_pool(load_settings(SEED_USER))
    with pool.acquire() as conn:
        cur = conn.cursor()
        correction = find_turn(cur, CORRECTION)
        mixed = find_turn(cur, MIXED)
        check = cur.execute(
            """select check_run_id, json_serialize(counts) from aim_check_runs
                where judge_model is not null and scope_user_id is null
                order by check_run_id desc fetch first 1 row only""").fetchone()
        stale = None
        if check:
            # Titles cut memory text at 80 characters, so match on the stale memory itself.
            stale = cur.execute(
                """select json_value(f.evidence, '$.stale'), f.title from aim_findings f
                     join memory m on m.record_id = json_value(f.evidence, '$.stale')
                    where f.check_run_id = :r and f.kind = 'superseded' and f.user_id = :u
                      and dbms_lob.instr(m.content, 'us-east-1') > 0
                      and dbms_lob.instr(m.content, 'us-west-2') = 0
                    fetch first 1 row only""", {"r": check[0], "u": SEED_ALICE}).fetchone()
        stale_in_prompt = None
        if correction and stale:
            (retrieved,) = cur.execute("select json_serialize(retrieved) from aim_turns where run_id = :r and turn = :t",
                                       {"r": correction[0], "t": correction[1]}).fetchone()
            rows = json.loads(retrieved or "[]")
            hit = next((r for r in rows if r["record_id"] == stale[0]), None)
            stale_in_prompt = hit
    pool.close()

    print(f"Dashboard: {base}  (schema {SEED_USER.upper()}; set AIM_SCHEMA in web/.env.local to change)\n")
    print(f"  All conversations       {base}/runs")
    if correction:
        run, turn = correction
        print("\nThe stale fact (support_01)")
        print(f"  Fact created, turn {turn - 1:<3}  {base}/runs/{run}?turn={turn - 1}")
        print(f"  Correction, turn {turn:<5}    {base}/runs/{run}?turn={turn}")
        print(f"  Why the correction turn  {base}/runs/{run}?turn={turn}&view=why")
        print(f"  Lifecycle of that turn   {base}/runs/{run}/turn/{turn}")
        if stale_in_prompt:
            where = "went into the prompt" if stale_in_prompt.get("in_prompt") else "was returned but not used"
            print(f"  -> this seed: the stale us-east-1 fact ranked #{stale_in_prompt['rank']} "
                  f"(cosine {stale_in_prompt['distance']:.3f}) and {where}")
        elif stale:
            print("  -> this seed: the stale fact exists but that turn's search didn't return it; show turn 2 instead")
        else:
            print("  -> this seed: no superseded us-east-1 finding; run scripts/check.py, or reseed")
    else:
        print("\n(support_01 not found: run scripts/seed.py --reset)")
    if mixed:
        run, turn = mixed
        print("\nThe miss (support_03, the mixed question)")
        print(f"  Why that reply           {base}/runs/{run}?turn={turn}&view=why")
        print(f"  Lifecycle                {base}/runs/{run}/turn/{turn}")
    else:
        print("\n(support_03 not found: run scripts/seed.py --reset)")
    print("\nMemory health")
    if check:
        counts = json.loads(check[1] or "{}").get("findings", {})
        summary = ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "no findings"
        print(f"  Findings (check #{check[0]}: {summary})")
        print(f"                           {base}/memories")
    else:
        print("  No judged check yet: run scripts/check.py")
    print(f"  Every memory, by retrieval {base}/memories?tab=all")


if __name__ == "__main__":
    main()
