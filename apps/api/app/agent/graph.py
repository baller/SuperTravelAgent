"""Compatibility import for the dynamic SuperTravel Agent Loop.

The former fixed, field-by-field graph has intentionally been removed. New
code should import :func:`build_graph` from ``app.agent.loop`` directly.
"""

from app.agent.loop import build_graph

__all__ = ["build_graph"]
