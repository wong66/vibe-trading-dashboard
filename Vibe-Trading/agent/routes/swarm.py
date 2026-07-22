"""Swarm API routes for Vibe-Trading."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from ..auth import require_auth, require_event_stream_auth
from ..helpers import validate_path_param as _validate_path_param

router = APIRouter()

_swarm_runtime = None


def _get_swarm_runtime():
    global _swarm_runtime
    if _swarm_runtime is not None:
        return _swarm_runtime
    from src.config import load_swarm_agent_config
    from src.swarm.store import SwarmStore
    from src.swarm.runtime import SwarmRuntime
    swarm_dir = Path(__file__).resolve().parent.parent / ".swarm" / "runs"
    store = SwarmStore(base_dir=swarm_dir)
    agent_config = load_swarm_agent_config()
    _swarm_runtime = SwarmRuntime(store=store, agent_config=agent_config)
    return _swarm_runtime


@router.get("/swarm/presets")
async def list_swarm_presets():
    from src.swarm.presets import list_presets
    return list_presets()


@router.post("/swarm/runs", dependencies=[Depends(require_auth)])
async def create_swarm_run(payload: dict, http_request: Request):
    runtime = _get_swarm_runtime()
    preset_name = payload.get("preset_name", "")
    user_vars = payload.get("user_vars", {})
    try:
        from ..live_trading import _env_shell_tools_enabled, _is_local_client
        include_shell = _env_shell_tools_enabled() or _is_local_client(http_request)
    except ImportError:
        include_shell = False
    try:
        run = runtime.start_run(preset_name, user_vars, include_shell_tools=include_shell)
        return {"id": run.id, "status": run.status.value, "preset_name": run.preset_name}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/swarm/runs", dependencies=[Depends(require_auth)])
async def list_swarm_runs(limit: int = Query(20, ge=1, le=100)):
    runtime = _get_swarm_runtime()
    runs = runtime._store.list_runs(limit=limit)
    items = []
    for r in runs:
        reconciled = runtime._store.reconcile_run(r, write=True)
        items.append({
            "id": reconciled.id, "preset_name": reconciled.preset_name,
            "status": reconciled.status.value,
            "is_stale": runtime._store.is_run_stale(reconciled),
            "created_at": reconciled.created_at,
            "completed_at": reconciled.completed_at,
            "task_count": len(reconciled.tasks),
            "completed_count": sum(1 for t in reconciled.tasks if t.status.value == "completed"),
        })
    return items


@router.get("/swarm/runs/{run_id}", dependencies=[Depends(require_auth)])
async def get_swarm_run(run_id: str):
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    run = runtime._store.reconcile_run(loaded, write=True)
    return {
        "id": run.id, "preset_name": run.preset_name,
        "status": run.status.value,
        "is_stale": runtime._store.is_run_stale(run),
        "user_vars": run.user_vars,
        "agents": [a.model_dump() for a in run.agents],
        "tasks": [t.model_dump() for t in run.tasks],
        "created_at": run.created_at, "completed_at": run.completed_at,
        "final_report": run.final_report,
    }


@router.get("/swarm/runs/{run_id}/events", dependencies=[Depends(require_event_stream_auth)])
async def swarm_run_events(run_id: str, request: Request, last_index: int = Query(0, ge=0)):
    import asyncio
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()

    async def event_stream():
        idx = last_index
        while True:
            if await request.is_disconnected():
                break
            events = runtime._store.read_events(run_id, after_index=idx)
            for evt in events:
                idx += 1
                yield f"id: {idx}\nevent: {evt.type}\ndata: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"
            run = runtime._store.load_run(run_id)
            if run:
                reconciled = runtime._store.reconcile_run(run, write=True)
                if reconciled.status.value in ("completed", "failed", "cancelled"):
                    yield f"event: done\ndata: {{\"status\": \"{reconciled.status.value}\"}}\n\n"
                    break
            await asyncio.sleep(2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/swarm/runs/{run_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_swarm_run(run_id: str):
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    ok = runtime.cancel_run(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No active run {run_id}")
    return {"status": "cancelled"}


@router.post("/swarm/runs/{run_id}/retry", dependencies=[Depends(require_auth)])
async def retry_swarm_run(run_id: str, http_request: Request):
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    from src.swarm.models import RunStatus
    reconciled = runtime._store.reconcile_run(loaded, write=True)
    if reconciled.status == RunStatus.running:
        raise HTTPException(status_code=409, detail="Cannot retry a running run. Cancel it first.")
    try:
        from ..live_trading import _is_local_client
        include_shell = _is_local_client(http_request)
    except ImportError:
        include_shell = False
    try:
        new_run = runtime.start_run(reconciled.preset_name, reconciled.user_vars or {}, include_shell_tools=include_shell)
        return {"id": new_run.id, "status": new_run.status.value, "preset_name": new_run.preset_name}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
