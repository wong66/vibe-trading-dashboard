"""System routes for Vibe-Trading API."""
from __future__ import annotations

import logging
import os
import signal
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, status

from ..auth import require_auth
from ..models import HealthResponse
from ..upload import upload_file

router = APIRouter()

logger = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(status="healthy", service="Vibe-Trading API", timestamp=datetime.now().isoformat())


@router.get("/api")
async def api_info():
    return {"service": "Vibe-Trading API", "version": "5.0.0", "docs": "/docs", "health": "/health"}


def _terminate_current_process() -> None:
    time.sleep(0.25)
    os.kill(os.getpid(), signal.SIGTERM)


@router.post("/system/shutdown", dependencies=[Depends(require_auth)])
async def shutdown_local_api(background_tasks: BackgroundTasks, request: Request):
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Local access only")
    background_tasks.add_task(_terminate_current_process)
    return {"status": "shutting-down", "service": "Vibe-Trading API", "timestamp": datetime.now().isoformat()}


@router.post("/upload", dependencies=[Depends(require_auth)])
async def upload_endpoint(file: UploadFile):
    return await upload_file(file)
