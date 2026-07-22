"""Live trading API routes for Vibe-Trading."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from ..auth import require_auth, require_event_stream_auth
from ..models import (
    CommitMandateRequest, LiveAuthorizeRequest, LiveHaltRequest,
    LiveRunnerControlRequest, LiveStatusResponse,
)
from ..helpers import validate_path_param as _validate_path_param

router = APIRouter()


def _get_live_trading():
    from . import live_trading as lt
    return lt


@router.post("/mandate/commit", dependencies=[Depends(require_auth)])
async def commit_mandate_endpoint(payload: CommitMandateRequest):
    lt = _get_live_trading()
    if payload.consent_ack is not True:
        raise HTTPException(status_code=400, detail="consent_ack must be true to commit a mandate")
    from src.live.mandate.commit import CommitError, commit_mandate
    broker_ceilings = lt._fetch_broker_ceilings(payload.broker)
    try:
        result = commit_mandate(
            proposal_id=payload.proposal_id, ordinal=payload.selected_ordinal,
            adjustments=payload.adjustments, consent_ack=payload.consent_ack,
            broker=payload.broker, account_ref=payload.account_ref,
            session_id=payload.session_id, ceilings_ref=broker_ceilings,
            lifetime_days=payload.lifetime_days,
        )
    except CommitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    lt._emit_live_event(payload.session_id, "mandate.committed", result)
    lt._emit_live_event(payload.session_id, "live.action",
                        {"kind": "mandate_committed", "broker": result["broker"], "mandate_id": result["mandate_id"]})
    return result


@router.post("/live/halt", dependencies=[Depends(require_auth)])
async def halt_live_endpoint(payload: LiveHaltRequest):
    lt = _get_live_trading()
    from src.live.halt import trip_halt
    try:
        path = trip_halt(by="frontend", reason=payload.reason, broker=payload.broker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = {"halted": True, "broker": payload.broker, "reason": payload.reason, "sentinel": str(path)}
    lt._emit_live_event(payload.session_id, "live.halted", result)
    lt._emit_live_event(payload.session_id, "live.action",
                        {"kind": "halt_tripped", "broker": payload.broker, "reason": payload.reason})
    return result


@router.post("/live/resume", dependencies=[Depends(require_auth)])
async def resume_live_endpoint(payload: LiveHaltRequest):
    lt = _get_live_trading()
    from src.live.halt import clear_halt
    try:
        cleared = clear_halt(broker=payload.broker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = {"halted": False, "broker": payload.broker, "cleared": cleared}
    lt._emit_live_event(payload.session_id, "live.resumed", result)
    lt._emit_live_event(payload.session_id, "live.action",
                        {"kind": "halt_cleared", "broker": payload.broker, "cleared": cleared})
    return result


@router.get("/live/status", response_model=LiveStatusResponse, dependencies=[Depends(require_auth)])
async def live_status_endpoint(broker: Optional[str] = Query(None, max_length=64)):
    lt = _get_live_trading()
    status_dict = lt.build_live_status(broker)
    from ..models import BrokerAuthState, LiveBrokerStatus, RunnerLivenessState, ActiveMandateState, MandateLimits
    brokers = []
    for b in status_dict["brokers"]:
        auth = BrokerAuthState(**b["auth"])
        mandate = ActiveMandateState(**b["mandate"]) if b["mandate"] else None
        runner = RunnerLivenessState(**b["runner"])
        brokers.append(LiveBrokerStatus(auth=auth, mandate=mandate, runner=runner, halted=b["halted"]))
    return LiveStatusResponse(global_halted=status_dict["global_halted"], brokers=brokers)


@router.post("/live/authorize", dependencies=[Depends(require_auth)])
async def live_authorize_endpoint(payload: LiveAuthorizeRequest):
    lt = _get_live_trading()
    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    if broker not in set(lt._known_live_brokers()):
        raise HTTPException(status_code=400, detail=f"unknown live broker: {broker}")
    from src.trading.service import connector_profile_id_for_broker
    connector_profile = connector_profile_id_for_broker(broker)
    return {
        "broker": broker, "connector_profile": connector_profile,
        "oauth_token_present": lt._oauth_token_present(broker),
        "instruction": (
            f"Run `vibe-trading connector authorize {connector_profile}` "
            "from the device that will hold the broker session. This opens the "
            "broker's own OAuth consent flow; Vibe-Trading never holds funds and "
            "only relays intent once you authorize."
        ),
        "note": (
            "The live channel stays read-only until the OAuth token is present AND a "
            "mandate is committed AND order tools are explicitly enabled."
        ),
    }


@router.post("/live/runner/start", dependencies=[Depends(require_auth)])
async def start_runner_endpoint(payload: LiveRunnerControlRequest):
    lt = _get_live_trading()
    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    from src.trading.service import broker_supports_live_runner
    if not broker_supports_live_runner(broker):
        raise HTTPException(status_code=400, detail=f"live runner is not supported for {broker}")
    existing = lt._runner_tasks.get(broker)
    if existing is not None and not existing.done():
        return {"broker": broker, "started": False, "already_running": True}
    mandate = lt._active_mandate_state(broker)
    if mandate is None:
        raise HTTPException(status_code=409, detail=f"no committed mandate for {broker}")
    if mandate.expired:
        raise HTTPException(status_code=409, detail=f"mandate for {broker} has expired; re-authorize first")
    from src.live.halt import halt_flag_set
    if halt_flag_set(broker=broker) or halt_flag_set(broker=None):
        raise HTTPException(status_code=409, detail="kill switch is tripped; resume before starting the runner")
    try:
        runner = lt._build_live_runner(broker)
    except lt.LiveRunnerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"could not construct runner: {exc}") from exc
    import asyncio
    task = asyncio.ensure_future(lt._drive_runner(runner))
    lt._runner_tasks[broker] = task
    task.add_done_callback(lambda t, b=broker: lt._runner_tasks.pop(b, None) if lt._runner_tasks.get(b) is t else None)
    lt._emit_live_event(payload.session_id, "live.action", {"kind": "runner_started", "broker": broker})
    return {"broker": broker, "started": True, "already_running": False}


@router.post("/live/runner/stop", dependencies=[Depends(require_auth)])
async def stop_runner_endpoint(payload: LiveRunnerControlRequest):
    lt = _get_live_trading()
    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    from src.trading.service import broker_supports_live_runner
    if not broker_supports_live_runner(broker):
        raise HTTPException(status_code=400, detail=f"live runner is not supported for {broker}")
    task = lt._runner_tasks.pop(broker, None)
    if task is None or task.done():
        return {"broker": broker, "stopped": False, "was_running": False}
    task.cancel()
    lt._emit_live_event(payload.session_id, "live.action", {"kind": "runner_stopped", "broker": broker})
    return {"broker": broker, "stopped": True, "was_running": True}
