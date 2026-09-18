"""Agent memory inspector: see what an Oracle AI Agent Memory agent remembers and why.

    from memory_inspector import inspect
    memory = inspect(OracleAgentMemory(connection=pool, ...), pool=pool)
"""

from .inspector import Inspector, Turn
from .schema import install
from .wrapper import InspectedMemory, InspectedThread, inspect

__all__ = ["inspect", "install", "Inspector", "InspectedMemory", "InspectedThread", "Turn"]
__version__ = "0.1.0"
