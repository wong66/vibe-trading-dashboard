"""Run routes for Vibe-Trading API."""
from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import require_auth
from ..helpers import _build_response_from_run_dir, validate_path_param
from ..models import RunInfo, RunResponse
from ..run_list import list_runs_helper

router = APIRouter()

RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"


@router.get("/runs/{run_id}/code", dependencies=[Depends(require_auth)])
async def get_run_code(run_id: str):
    validate_path_param(run_id, "run_id")
    run_dir = RUNS_DIR / run_id / "code"
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Code directory for run {run_id} not found")
    result = {}
    for f in ["signal_engine.py"]:
        p = run_dir / f
        if p.exists():
            result[f] = p.read_text(encoding="utf-8")
    return result


@router.get("/runs/{run_id}/pine", dependencies=[Depends(require_auth)])
async def get_run_pine(run_id: str):
    validate_path_param(run_id, "run_id")
    pine_path = RUNS_DIR / run_id / "artifacts" / "strategy.pine"
    if not pine_path.exists():
        return {"exists": False, "content": None}
    return {"exists": True, "content": pine_path.read_text(encoding="utf-8")}


@router.get("/runs/{run_id}", response_model=RunResponse, dependencies=[Depends(require_auth)])
async def get_run_result(run_id: str):
    validate_path_param(run_id, "run_id")
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")
    return _build_response_from_run_dir(run_dir, elapsed=0.0, include_analysis=True)


@router.get("/runs", response_model=List[RunInfo], dependencies=[Depends(require_auth)])
async def list_runs(limit: int = 20):
    return list_runs_helper(RUNS_DIR, limit=limit)
