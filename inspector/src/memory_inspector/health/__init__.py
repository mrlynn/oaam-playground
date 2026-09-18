"""Memory health checks: find stale, duplicate and transient memories, and the
turns where they cost the agent a prompt slot.

    memory-inspector check --user aim_app --dsn localhost:1521/FREEPDB1 --judge-model anthropic/claude-sonnet-5

Candidates come from SQL (VECTOR_DISTANCE inside the database), an optional
LLM judge classifies them, and pure check functions turn both into findings.
"""

from .model import Finding, Memory, Pair, Verdict
from .runner import CheckReport, run_check

__all__ = ["CheckReport", "Finding", "Memory", "Pair", "Verdict", "run_check"]
