"""Vibe-Trading routes package."""
from .market import router as market_router
from .runs import router as runs_router
from .settings import router as settings_router
from .system import router as system_router
from .live import router as live_router
from .session import router as session_router
from .swarm import router as swarm_router
from .system_extra import router as system_extra_router

__all__ = ["market_router", "runs_router", "settings_router", "system_router",
           "live_router", "session_router", "swarm_router", "system_extra_router"]
