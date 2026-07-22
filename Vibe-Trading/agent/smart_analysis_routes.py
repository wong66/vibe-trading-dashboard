"""Smart Analysis — embed daily_stock_analysis API routes.

Wraps the daily_stock_analysis API router so its endpoints are available
under /smart-analysis in Vibe-Trading.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_DSA_DIR = Path(__file__).resolve().parent.parent / "daily_stock_analysis"

# Ensure DSA modules are importable.
# NOTE: this must be at the front so `from src.xxx` inside the DSA app resolves
# to daily_stock_analysis/src (it also has a `src` package). This shadows the
# `src` package under agent/, so agent-local code should import via
# `from agent.src.xxx` (see api_server.py) rather than bare `from src.xxx`.
if str(_DSA_DIR) not in sys.path:
    sys.path.insert(0, str(_DSA_DIR))

# Pre-load .env
from dotenv import load_dotenv  # noqa: E402
_env_path = _DSA_DIR / ".env"
_env_example = _DSA_DIR / ".env.example"
if not _env_path.exists() and _env_example.exists():
    import shutil
    shutil.copy2(str(_env_example), str(_env_path))
    logger.info("[smart_analysis] Created .env from .env.example")
load_dotenv(str(_env_path), override=True)

try:
    from fastapi import APIRouter  # noqa: E402

    smart_analysis_router = APIRouter(prefix="/smart-analysis")

    # Import each DSA endpoint submodule directly and include with prefix
    from api.v1.endpoints import (  # noqa: E402
        auth, health, analysis, history, stocks,
        backtest, system_config, agent, usage,
        portfolio, alerts, decision_signals, alphasift,
    )

    smart_analysis_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
    smart_analysis_router.include_router(agent.router, prefix="/agent", tags=["Agent"])
    smart_analysis_router.include_router(analysis.router, prefix="/analysis", tags=["Analysis"])
    smart_analysis_router.include_router(history.router, prefix="/history", tags=["History"])
    smart_analysis_router.include_router(stocks.router, prefix="/stocks", tags=["Stocks"])
    smart_analysis_router.include_router(backtest.router, prefix="/backtest", tags=["Backtest"])
    smart_analysis_router.include_router(system_config.router, prefix="/system", tags=["SystemConfig"])
    smart_analysis_router.include_router(usage.router, prefix="/usage", tags=["Usage"])
    smart_analysis_router.include_router(portfolio.router, prefix="/portfolio", tags=["Portfolio"])
    smart_analysis_router.include_router(alerts.router, prefix="/alerts", tags=["Alerts"])
    smart_analysis_router.include_router(decision_signals.router, prefix="/decision-signals", tags=["DecisionSignals"])
    smart_analysis_router.include_router(alphasift.router, prefix="/alphasift", tags=["AlphaSift"])
    smart_analysis_router.include_router(health.router, tags=["Health"])

    _SMART_ANALYSIS_READY = True
except Exception as exc:  # noqa: BLE001
    logger.warning("[smart_analysis] Failed to import daily_stock_analysis routes: %s", exc)
    smart_analysis_router = None
    _SMART_ANALYSIS_READY = False
