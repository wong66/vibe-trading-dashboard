#!/usr/bin/env python3
"""Vibe-Trading API Server — thin aggregator.

All business logic lives in modular files:
  - common.py      — shared utilities (safe_float, code mapping, HTTP clients)
  - auth.py        — auth helpers (require_auth, require_local_or_auth, …)
  - routes/        — FastAPI route modules (market, settings, runs, system)
  - models.py, settings.py, helpers.py, … — domain modules
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from rich.console import Console

from .auth import require_auth, require_event_stream_auth, require_local_or_auth
from .routes import (  # noqa: E402
    live_router, market_router, runs_router, session_router,
    settings_router, swarm_router, system_extra_router, system_router,
)

# UTF-8 on Windows
for _s in ("stdout", "stderr"):
    _r = getattr(getattr(sys, _s, None), "reconfigure", None)
    if callable(_r):
        _r(encoding="utf-8", errors="replace")

RUNS_DIR = Path(__file__).resolve().parent / "runs"
SESSIONS_DIR = Path(__file__).resolve().parent / "sessions"
AGENT_DIR = Path(__file__).resolve().parent
ENV_PATH = AGENT_DIR / ".env"

# Ensure the `src` package (agent/src) is importable when launched via
# `python -m agent.api_server` — otherwise sys.path[0] is the project root and
# top-level `from src.xxx` imports fail with ModuleNotFoundError.
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

console = Console()
logger = logging.getLogger(__name__)

# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="Vibe-Trading API",
    description="Vibe-Trading API: natural-language finance research, backtesting, and swarm workflows",
    version="5.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000", "http://localhost:5173", "http://localhost:8000",
    "http://127.0.0.1:3000", "http://127.0.0.1:5173", "http://127.0.0.1:8000",
    "https://vibe-trading-dashboard-awi.pages.dev",
]


def _parse_cors_origins(raw: Optional[str]) -> List[str]:
    if raw is None or not raw.strip():
        return list(_DEFAULT_CORS_ORIGINS)
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if "*" in origins:
        raise RuntimeError(
            "CORS_ORIGINS='*' is not allowed while credentials are enabled; "
            "configure explicit Web UI origins instead."
        )
    return origins


_CORS_ORIGINS = _parse_cors_origins(os.getenv("CORS_ORIGINS"))
app.add_middleware(
    CORSMiddleware, allow_origins=_CORS_ORIGINS, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# Smart Analysis (daily_stock_analysis)
from .smart_analysis_routes import smart_analysis_router  # noqa: E402
if smart_analysis_router is not None:
    app.include_router(smart_analysis_router)

# A股量化决策路由
from .aquant_routes import router as aquant_router  # noqa: E402
app.include_router(aquant_router, prefix="")

# New modular routes
app.include_router(market_router, prefix="")
app.include_router(settings_router, prefix="")
app.include_router(runs_router, prefix="")
app.include_router(system_router, prefix="")
app.include_router(live_router, prefix="")
app.include_router(session_router, prefix="")
app.include_router(swarm_router, prefix="")
app.include_router(system_extra_router, prefix="")

# ============================================================================
# PEG 估值反向代理  (/peg-api/* -> 本地 astock-peg :3000 /api/*)
# 让 PEG 页面复用主隧道 vt-backend，无需额外隧道进程。
# 前端 PEG_API="/peg-api"（相对路径），直连隧道时同源打到本路由，
# 本路由在 Mac 本地把请求转发给 127.0.0.1:3000，绕过公网与自环限制。
# ============================================================================
_PEG_BACKEND = os.getenv("PEG_BACKEND_URL", "http://127.0.0.1:3000")
_peg_client: Optional[httpx.AsyncClient] = None


def _get_peg_client() -> httpx.AsyncClient:
    global _peg_client
    if _peg_client is None:
        _peg_client = httpx.AsyncClient(timeout=30.0)
    return _peg_client


@app.api_route(
    "/peg-api/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy_peg_api(full_path: str, request: Request):
    target = f"{_PEG_BACKEND}/api/{full_path}"
    _skip_req = {"host", "content-length", "connection",
                 "transfer-encoding", "upgrade", "accept-encoding"}
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in _skip_req}
    body = await request.body() if request.method in ("POST", "PUT", "PATCH") else None
    client = _get_peg_client()
    upstream = await client.request(
        request.method, target,
        params=request.url.query,
        headers=headers,
        content=body,
    )
    _skip_resp = {"content-length", "content-encoding",
                  "transfer-encoding", "connection"}
    resp_headers = {k: v for k, v in upstream.headers.items()
                    if k.lower() not in _skip_resp}
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
    )


# ============================================================================
# SPA deep-link fallback
# ============================================================================

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_SPA_HTML_EXACT_PATHS: frozenset[str] = frozenset({"/correlation"})
_SPA_HTML_PATH_REGEX: tuple = (
    re.compile(r"^/runs/[^/]+/?$"),
)


def _is_spa_html_route(path: str) -> bool:
    if path in _SPA_HTML_EXACT_PATHS:
        return True
    return any(p.match(path) for p in _SPA_HTML_PATH_REGEX)


@app.middleware("http")
async def _spa_html_deep_link_fallback(request: Request, call_next):
    if request.method == "GET":
        accept = request.headers.get("accept", "")
        if "text/html" in accept and _is_spa_html_route(request.url.path):
            index = _FRONTEND_DIST / "index.html"
            if index.exists():
                return FileResponse(str(index))
    return await call_next(request)


async def _sector_cache_refresh_loop() -> None:
    """后台周期刷新板块缓存：网络可用时拉取全部板块，断网时尽早退出避免空耗。"""
    from .sector_data import SECTOR_BOARD_MAP, get_sector_data
    await asyncio.sleep(20)
    while True:
        boards = list(dict.fromkeys(SECTOR_BOARD_MAP.values()))
        refreshed = 0
        for board in boards:
            name = next((k for k, v in SECTOR_BOARD_MAP.items() if v == board), board)
            try:
                res = await get_sector_data(name)
            except Exception as _e:  # noqa: BLE001
                logger.warning("板块缓存刷新中断(异常): %s", _e)
                break
            if res.get("error"):
                # 网络不可用：后续板块大概率同样失败，结束本轮，稍后重试
                break
            refreshed += 1
            await asyncio.sleep(0.15)
        logger.info("板块缓存刷新：本轮成功 %d/%d", refreshed, len(boards))
        await asyncio.sleep(600)


@app.on_event("startup")
async def _run_startup_preflight() -> None:
    try:
        from agent.src.preflight import run_preflight
    except Exception as _pf_imp_err:  # noqa: BLE001
        logger.warning("preflight module unavailable: %s", _pf_imp_err)
        return
    try:
        asyncio.get_event_loop().run_in_executor(None, run_preflight, console)
    except Exception as _pf_err:
        console.print(f"[yellow]Preflight check warning: {_pf_err}[/yellow]")
    # 板块数据预拉取 + 周期刷新（公司代理间歇可用，提前建缓存确保切换板块即为真实数据）
    asyncio.create_task(_sector_cache_refresh_loop())

# Legacy alpha routes (src package — keep register pattern)
try:
    from agent.src.api.alpha_routes import register_alpha_routes  # noqa: E402
    register_alpha_routes(
        app, require_auth=require_auth, require_event_stream_auth=require_event_stream_auth,
    )
except Exception as _alpha_err:  # noqa: BLE001
    logger.warning("alpha routes skipped: %s", _alpha_err)

# ============================================================================
# Main Entry Point
# ============================================================================

def serve_main(argv: list[str] | None = None) -> int:
    """Start the API server from CLI-style arguments."""
    import argparse
    import subprocess
    import uvicorn
    from fastapi import status
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope: Dict[str, Any]):
            try:
                resp = await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != status.HTTP_404_NOT_FOUND:
                    raise
                resp = await super().get_response("index.html", scope)
            # 入口 index.html 不缓存，强制每次重新校验 → 避免浏览器长期缓存旧 JS 块
            if path in ("", "/", "index.html"):
                resp.headers.update(
                    {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}
                )
            return resp

    parser = argparse.ArgumentParser(description="Vibe-Trading Server")
    parser.add_argument("--port", type=int, default=8000, help="Listen port (default 8000)")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--dev", action="store_true", help="Dev mode: spawn Vite on :5173")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 2

    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    frontend_root = Path(__file__).resolve().parent.parent / "frontend"

    vite_proc = None
    if args.dev and frontend_root.exists():
        print("[dev] Starting Vite dev server on :5173 ...")
        vite_proc = subprocess.Popen(
            ["npx", "vite", "--host", "0.0.0.0"],
            cwd=str(frontend_root),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        print(f"[dev] Vite PID={vite_proc.pid}")
        print("[dev] Frontend: http://localhost:5173")
        print(f"[dev] API: http://localhost:{args.port}")
    elif frontend_dist.exists():
        if not any(route.path == "/" for route in app.routes):
            app.mount("/", SPAStaticFiles(directory=str(frontend_dist), html=True), name="frontend")
        print(f"[prod] Frontend served from {frontend_dist}")
    else:
        print(f"[warn] No frontend build found at {frontend_dist}")
        print("[warn] Run: cd frontend && npm run build")

    print("=" * 50)
    print("  Vibe-Trading Server")
    print(f"  http://127.0.0.1:{args.port}")
    print("=" * 50)

    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    finally:
        if vite_proc:
            vite_proc.terminate()
            print("[dev] Vite stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(serve_main())
