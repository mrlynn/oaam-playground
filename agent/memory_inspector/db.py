"""One connection pool and one memory client, built the same way everywhere."""

from __future__ import annotations

import logging
import sys

import oracledb
from oracleagentmemory.core.dbschemapolicy import SchemaPolicy
from oracleagentmemory.core.embedders.embedder import Embedder
from oracleagentmemory.core.llms.llm import Llm
from oracleagentmemory.core.oracleagentmemory import OracleAgentMemory

from .config import Settings, load_settings

PACKAGE_LOGGER = "oracleagentmemory"


def enable_package_logging(level: int = logging.DEBUG) -> logging.Logger:
    """The package logs under `oracleagentmemory` but configures no handlers.

    M1 just prints to stderr so we can see what it considers worth saying.
    M3 replaces this with a handler that writes run log rows.
    """
    logger = logging.getLogger(PACKAGE_LOGGER)
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
    return logger


def create_pool(settings: Settings | None = None) -> oracledb.ConnectionPool:
    s = settings or load_settings()
    return oracledb.create_pool(user=s.db_user, password=s.db_password, dsn=s.db_dsn, min=1, max=4, increment=1)


def build_memory(
    pool: oracledb.ConnectionPool,
    settings: Settings | None = None,
    schema_policy: SchemaPolicy = SchemaPolicy.CREATE_IF_NECESSARY,
) -> OracleAgentMemory:
    """Build the client. The package default policy is REQUIRE_EXISTING, which
    fails on an empty schema, so first runs need CREATE_IF_NECESSARY."""
    s = settings or load_settings()
    kwargs = {}
    if s.memory_store_id:
        kwargs["memory_store_id"] = s.memory_store_id
    return OracleAgentMemory(
        connection=pool,
        embedder=Embedder(model=s.embed_model),
        llm=Llm(model=s.llm_model),
        schema_policy=schema_policy,
        **kwargs,
    )
