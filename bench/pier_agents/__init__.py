"""Pier custom agents shipped by ``@tangle-network/agent-bench``."""

from typing import TYPE_CHECKING, Any


if TYPE_CHECKING:
    from .tangle_candidate import TangleCandidateAgent

__all__ = ["TangleCandidateAgent"]


def __getattr__(name: str) -> Any:
    """Load Pier only when callers request the custom agent."""
    if name != "TangleCandidateAgent":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from .tangle_candidate import TangleCandidateAgent

    return TangleCandidateAgent
