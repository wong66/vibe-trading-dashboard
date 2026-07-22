"""Session API routes for Vibe-Trading."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from ..auth import require_auth, require_event_stream_auth
from ..helpers import validate_path_param as _validate_path_param
from ..models import (
    AddGoalEvidenceRequest, AddGoalEvidenceResponse, CreateGoalRequest, CreateSessionRequest,
    GoalAuditRowRequest, GoalSnapshotResponse, MessageResponse, SendMessageRequest,
    SessionResponse, UpdateGoalRequest, UpdateGoalResponse, UpdateGoalStatusRequest,
    UpdateGoalStatusResponse, UpdateSessionRequest,
)

router = APIRouter()

# Share session service with live_trading to avoid duplicate init
from ..live_trading import _get_session_service as _get_session_service_shared

_goal_store = None


def _get_goal_store():
    global _goal_store
    if _goal_store is None:
        from src.goal import GoalStore
        _goal_store = GoalStore()
    return _goal_store


def _get_existing_session_or_404(session_id: str):
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return svc, session


# ── Session routes ──────────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_auth)])
async def create_session(request: CreateSessionRequest):
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.create_session(title=request.title, config=request.config)
    return SessionResponse(
        session_id=session.session_id, title=session.title,
        status=session.status.value, created_at=session.created_at,
        updated_at=session.updated_at, last_attempt_id=session.last_attempt_id,
    )


@router.get("/sessions", response_model=List[SessionResponse], dependencies=[Depends(require_auth)])
async def list_sessions(limit: int = Query(50, ge=1, le=200)):
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    sessions = svc.list_sessions(limit=limit)
    return [
        SessionResponse(session_id=s.session_id, title=s.title, status=s.status.value,
                        created_at=s.created_at, updated_at=s.updated_at,
                        last_attempt_id=s.last_attempt_id)
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=SessionResponse, dependencies=[Depends(require_auth)])
async def get_session(session_id: str):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return SessionResponse(
        session_id=session.session_id, title=session.title,
        status=session.status.value, created_at=session.created_at,
        updated_at=session.updated_at, last_attempt_id=session.last_attempt_id,
    )


@router.delete("/sessions/{session_id}", dependencies=[Depends(require_auth)])
async def delete_session(session_id: str):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    deleted = svc.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    _get_goal_store().delete_session_goals(session_id)
    return {"status": "deleted", "session_id": session_id}


@router.patch("/sessions/{session_id}", dependencies=[Depends(require_auth)])
async def update_session(session_id: str, req: UpdateSessionRequest):
    from datetime import datetime
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    if req.title is not None:
        session.title = req.title
    session.updated_at = datetime.now().isoformat()
    svc.store.update_session(session)
    return {"status": "updated", "session_id": session_id}


@router.post("/sessions/{session_id}/messages", dependencies=[Depends(require_auth)])
async def send_message(session_id: str, payload: SendMessageRequest, http_request: Request):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    try:
        from ..live_trading import _env_shell_tools_enabled, _is_local_client
        include_shell = _env_shell_tools_enabled() or _is_local_client(http_request)
    except ImportError:
        include_shell = False
    try:
        result = await svc.send_message(session_id=session_id, content=payload.content, include_shell_tools=include_shell)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/sessions/{session_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_session(session_id: str):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    cancelled = svc.cancel_current(session_id)
    if not cancelled:
        return {"status": "no_active_loop"}
    return {"status": "cancelled"}


@router.get("/sessions/{session_id}/messages", response_model=List[MessageResponse], dependencies=[Depends(require_auth)])
async def get_messages(session_id: str, limit: int = Query(100, ge=1, le=1000)):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    messages = svc.get_messages(session_id, limit=limit)
    return [
        MessageResponse(message_id=m.message_id, session_id=m.session_id, role=m.role,
                        content=m.content, created_at=m.created_at,
                        linked_attempt_id=m.linked_attempt_id,
                        metadata=m.metadata if m.metadata else None)
        for m in messages
    ]


@router.get("/sessions/{session_id}/events", dependencies=[Depends(require_event_stream_auth)])
async def session_events(
    session_id: str, request: Request,
    last_event_id: Optional[str] = Query(None, alias="Last-Event-ID"),
    replay: Optional[str] = Query(None),
):
    _validate_path_param(session_id, "session_id")
    svc = _get_session_service_shared()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    header_id = request.headers.get("Last-Event-ID")
    event_id = header_id or last_event_id
    replay_active = (replay or "").lower() == "active"
    replay_all = False
    if replay_active and not event_id and session.last_attempt_id:
        attempt = svc.store.get_attempt(session_id, session.last_attempt_id)
        attempt_status = getattr(attempt.status, "value", attempt.status) if attempt else None
        replay_all = attempt_status == "running"

    async def event_generator():
        async for event in svc.event_bus.subscribe(session_id, last_event_id=event_id, replay_all=replay_all):
            if await request.is_disconnected():
                break
            yield event.to_sse()
            from ..live_trading import mandate_proposal_frame_from_tool_result, live_action_frame_from_tool_result
            rel = mandate_proposal_frame_from_tool_result(event)
            if rel is not None:
                yield rel
            la = live_action_frame_from_tool_result(event)
            if la is not None:
                yield la

    return StreamingResponse(
        event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ── Goal routes ──────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/goal", response_model=GoalSnapshotResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_auth)])
async def create_session_goal(session_id: str, req: CreateGoalRequest):
    _validate_path_param(session_id, "session_id")
    svc, _session = _get_existing_session_or_404(session_id)
    from src.goal import RiskTier, default_goal_criteria
    criteria = [item.strip() for item in req.criteria if item.strip()]
    if not criteria:
        criteria = default_goal_criteria()
    try:
        risk_tier = RiskTier(req.risk_tier)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid risk_tier: {req.risk_tier}") from exc
    if risk_tier is RiskTier.LIVE_TRADING_OR_EXECUTION:
        raise HTTPException(status_code=400, detail="live trading or execution goals are not supported")
    goal_store = _get_goal_store()
    try:
        goal = goal_store.replace_goal(
            session_id=session_id, objective=req.objective, criteria=criteria,
            ui_summary=req.ui_summary, source="api", protocol=req.protocol,
            risk_tier=risk_tier, token_budget=req.token_budget,
            turn_budget=req.turn_budget, time_budget_seconds=req.time_budget_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal created but could not be reloaded")
    svc.event_bus.emit(session_id, "goal.created", {"goal": snapshot["goal"]})
    return snapshot


@router.get("/sessions/{session_id}/goal", response_model=GoalSnapshotResponse, dependencies=[Depends(require_auth)])
async def get_session_goal(session_id: str):
    _validate_path_param(session_id, "session_id")
    _get_existing_session_or_404(session_id)
    snapshot = _get_goal_store().get_current_snapshot(session_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No current goal")
    return snapshot


@router.patch("/sessions/{session_id}/goal", response_model=UpdateGoalResponse, dependencies=[Depends(require_auth)])
async def update_session_goal(session_id: str, req: UpdateGoalRequest):
    _validate_path_param(session_id, "session_id")
    svc, _session = _get_existing_session_or_404(session_id)
    from src.goal import StaleGoalError
    if req.objective is None and req.ui_summary is None:
        raise HTTPException(status_code=400, detail="objective or ui_summary is required")
    goal_store = _get_goal_store()
    try:
        goal = goal_store.update_goal(
            session_id=session_id, goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id, objective=req.objective,
            ui_summary=req.ui_summary,
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(session_id, "goal.updated", {"goal": snapshot["goal"], "snapshot": snapshot})
    return {"goal": snapshot["goal"], "snapshot": snapshot}


@router.post("/sessions/{session_id}/goal/evidence", response_model=AddGoalEvidenceResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_auth)])
async def add_session_goal_evidence(session_id: str, req: AddGoalEvidenceRequest):
    _validate_path_param(session_id, "session_id")
    svc, _session = _get_existing_session_or_404(session_id)
    from dataclasses import asdict
    from src.goal import EvidenceInput, StaleGoalError
    goal_store = _get_goal_store()
    try:
        evidence = goal_store.append_evidence(
            session_id=session_id, goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id,
            evidence=EvidenceInput(
                criterion_id=req.criterion_id, claim_id=req.claim_id,
                evidence_type=req.evidence_type, text=req.text,
                tool_call_id=req.tool_call_id, run_id=req.run_id,
                source_provider=req.source_provider, source_type=req.source_type,
                source_uri=req.source_uri, symbol_universe=req.symbol_universe,
                benchmark=req.benchmark, timeframe=req.timeframe,
                method=req.method, assumptions=req.assumptions,
                artifact_path=req.artifact_path, artifact_hash=req.artifact_hash,
                data_as_of=req.data_as_of, confidence=req.confidence,
                caveat=req.caveat, contradicts_claim_ids=req.contradicts_claim_ids,
            ),
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = goal_store.get_goal_snapshot(req.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(session_id, "goal.evidence", {"evidence": asdict(evidence), "goal_id": req.goal_id})
    return {"evidence": asdict(evidence), "snapshot": snapshot}


@router.patch("/sessions/{session_id}/goal/status", response_model=UpdateGoalStatusResponse, dependencies=[Depends(require_auth)])
async def update_session_goal_status(session_id: str, req: UpdateGoalStatusRequest):
    _validate_path_param(session_id, "session_id")
    svc, _session = _get_existing_session_or_404(session_id)
    from src.goal import AuditRow, GoalStatus, StaleGoalError
    try:
        next_status = GoalStatus(req.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid goal status: {req.status}") from exc
    goal_store = _get_goal_store()
    try:
        goal = goal_store.update_status(
            session_id=session_id, goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id, status=next_status,
            audit=[
                AuditRow(criterion_id=row.criterion_id, result=row.result,
                         evidence_ids=row.evidence_ids, notes=row.notes)
                for row in req.audit
            ],
            recap=req.recap,
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(session_id, "goal.updated", {"goal": snapshot["goal"], "snapshot": snapshot})
    return {"goal": snapshot["goal"], "snapshot": snapshot}
