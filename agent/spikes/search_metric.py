"""Spike 0.1: which distance metric does search() report?

Embeds a query the way search does (is_query=True), runs search, then
recomputes each result's distance in SQL with COSINE, EUCLIDEAN and DOT.
Whichever column matches search's `distance` is the metric.

    uv run python spikes/search_metric.py
"""

from __future__ import annotations

import array
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from oracleagentmemory.core.embedders.embedder import Embedder  # noqa: E402

from aim_demo.config import load_settings  # noqa: E402
from aim_demo.db import build_memory, create_pool  # noqa: E402

QUERIES = ["Which region is the export bucket in?", "How does Alice like to be contacted?"]
METRICS = ["COSINE", "EUCLIDEAN", "EUCLIDEAN_SQUARED", "DOT"]


def main() -> None:
    settings = load_settings()
    pool = create_pool(settings)
    memory = build_memory(pool, settings)
    embedder = Embedder(model=settings.embed_model)
    worst = {m: 0.0 for m in METRICS}
    with pool.acquire() as conn:
        cur = conn.cursor()
        for q in QUERIES:
            vec = array.array("d", embedder.embed([q], is_query=True)[0].astype("float64"))  # stored as FLOAT64
            results = memory.search(q, user_id="u_alice", max_results=6)
            print(f"\n{q}")
            print(f"  {'search':>8} " + " ".join(f"{m:>17}" for m in METRICS))
            for r in results:
                cols = ", ".join(f"vector_distance(embedding, :v, {m})" for m in METRICS)
                row = cur.execute(f"select {cols} from record_chunks where source_id = :id", {"v": vec, "id": r.id}).fetchone()
                print(f"  {r.distance:8.4f} " + " ".join(f"{x:17.4f}" for x in row))
                for m, x in zip(METRICS, row):
                    worst[m] = max(worst[m], abs(x - r.distance))
    print("\nmax |sql - search| per metric:", {m: round(v, 5) for m, v in worst.items()})
    print("match:", [m for m, v in worst.items() if v < 1e-3] or "none")
    memory.close()
    pool.close()


if __name__ == "__main__":
    main()
