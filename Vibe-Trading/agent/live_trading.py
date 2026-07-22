"""Live trading channel helpers — mandate, halt, runner, status.

No FastAPI endpoints live here; they are registered in api_server.py.
This module provides pure functions and data helpers only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

logger = logging.getLogger(__name__)
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .common import env_flag_enabled, is_local_client

_AGENT_DIR = Path(__file__).resolve().parent
_SESSIONS_DIR = _AGENT_DIR / "sessions"
_RUNS_DIR = _AGENT_DIR / "runs"

_shell_tools_env = "VIBE_TRADING_ENABLE_SHELL_TOOLS"
_PROPOSAL_TOOL_NAME = "propose_mandate_profiles"
_PROPOSAL_ID_RE = re.compile(r'"proposal_id"\s*:\s*"(mp_[0-9a-zA-Z]+)"')
_LIVE_ACTION_ID_RE = re.compile(r'"audit_id"\s*:\s*"(la_[0-9a-zA-Z]+)"')


def _env_shell_tools_enabled() -> bool:
    """Return whether server-side shell tools are explicitly enabled."""
    return env_flag_enabled(_shell_tools_env)


def _is_local_client(request: Request) -> bool:
    """Return whether the request originates from a loopback client."""
    return is_local_client(request)
_session_service = None  # type: ignore[assignment]
_runner_tasks: Dict[str, "asyncio.Task[Any]"] = {}
_runner_factory: Optional[Any] = None


class LiveRunnerUnavailable(RuntimeError):
    """Raised when a live runner cannot be wired."""


# ── Session service accessor ──────────────────────────────────────────

def _get_session_service():
    """Lazy-init session service (shared with session_routes)."""
    global _session_service
    if _session_service is not None:
        return _session_service
    if os.getenv("ENABLE_SESSION_RUNTIME", "true").lower() != "true":
        return None
    import asyncio
    from agent.src.session.store import SessionStore
    from agent.src.session.events import EventBus
    from agent.src.session.service import SessionService
    store = SessionStore(base_dir=_SESSIONS_DIR)
    event_bus = EventBus()
    try:
        loop = asyncio.get_event_loop()
        event_bus.set_loop(loop)
    except RuntimeError:
        pass
    _session_service = SessionService(store=store, event_bus=event_bus, runs_dir=_RUNS_DIR)
    return _session_service


# ── Event emission ────────────────────────────────────────────────────

def _emit_live_event(session_id: Optional[str], event_type: str, data: Dict[str, Any]) -> None:
    """Best-effort relay of a live-channel event through the existing bus."""
    if not session_id:
        return
    try:
        svc = _get_session_service()
        if svc and svc.get_session(session_id):
            svc.event_bus.emit(session_id, event_type, data)
    except Exception:
        logger.debug("live event relay failed for %s/%s", session_id, event_type, exc_info=True)


# ── SSE frame builders ────────────────────────────────────────────────

def _load_full_proposal(proposal_id: str) -> Optional[Dict[str, Any]]:
    """Reload a persisted mandate.proposal payload by id."""
    try:
        from src.live.paths import live_root
        for proposal_path in live_root().glob(f"*/proposals/{proposal_id}.json"):
            try:
                data = json.loads(proposal_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("type") == "mandate.proposal":
                return data
    except Exception:
        logger.debug("mandate.proposal reload failed for %s", proposal_id, exc_info=True)
    return None


def mandate_proposal_frame_from_tool_result(event: Any) -> Optional[str]:
    """Build a mandate.proposal SSE frame from a propose-tool tool_result."""
    data = getattr(event, "data", None)
    if getattr(event, "event_type", None) != "tool_result" or not isinstance(data, dict):
        return None
    if data.get("tool") != _PROPOSAL_TOOL_NAME or data.get("status") != "ok":
        return None
    match = _PROPOSAL_ID_RE.search(str(data.get("preview") or ""))
    if not match:
        return None
    proposal = _load_full_proposal(match.group(1))
    if proposal is None:
        return None
    from agent.src.session.events import SSEEvent
    frame = SSEEvent(event_type="mandate.proposal", data=proposal,
                     session_id=getattr(event, "session_id", "") or "")
    return frame.to_sse()


def _load_live_action_record(audit_id: str) -> Optional[Dict[str, Any]]:
    """Reload a redacted live-action record from the ledger by audit_id."""
    try:
        from src.live.paths import live_root
        ledger = live_root() / "audit.jsonl"
        if not ledger.exists():
            return None
        for line in reversed(ledger.read_text(encoding="utf-8").splitlines()):
            if audit_id not in line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("audit_id") == audit_id:
                return record
    except Exception:
        logger.debug("live.action reload failed for %s", audit_id, exc_info=True)
    return None


def live_action_frame_from_tool_result(event: Any) -> Optional[str]:
    """Build a live.action SSE frame from an order-guard tool_result."""
    data = getattr(event, "data", None)
    if getattr(event, "event_type", None) != "tool_result" or not isinstance(data, dict):
        return None
    preview = str(data.get("preview") or "")
    if '"live_action"' not in preview:
        return None
    match = _LIVE_ACTION_ID_RE.search(preview)
    if not match:
        return None
    record = _load_live_action_record(match.group(1))
    if record is None:
        return None
    from agent.src.session.events import SSEEvent
    frame = SSEEvent(event_type="live.action", data=record,
                     session_id=getattr(event, "session_id", "") or "")
    return frame.to_sse()


# ── Broker adapters ───────────────────────────────────────────────────

def _live_broker_adapter(broker: str) -> Any:
    """Build an MCPServerAdapter for a live broker."""
    from src.config.loader import load_agent_config
    from src.tools.mcp import MCPServerAdapter
    try:
        from src.config.schema import is_live_broker_entry
    except Exception:
        is_live_broker_entry = None
    cfg = load_agent_config()
    servers = getattr(cfg, "mcp_servers", {}) or {}
    for name, server_cfg in servers.items():
        is_match = name == broker
        if not is_match and is_live_broker_entry is not None and broker == "robinhood":
            try:
                is_match = is_live_broker_entry(name, server_cfg)
            except Exception:
                is_match = False
        if is_match:
            return MCPServerAdapter(name, server_cfg)
    raise LiveRunnerUnavailable(f"no MCP server configured for live broker {broker!r}")


def _fetch_broker_ceilings(broker: str) -> Optional[Dict[str, Any]]:
    """Best-effort fetch of broker-side account ceilings for the commit re-check."""
    try:
        adapter = _live_broker_adapter(broker)
    except LiveRunnerUnavailable:
        return None
    try:
        result = adapter.call_tool("get_account", {})
    except Exception:
        logger.debug("broker ceiling fetch failed for %s", broker, exc_info=True)
        return None
    if not isinstance(result, dict) or result.get("status") == "error":
        return None
    payload = result.get("result") if isinstance(result.get("result"), dict) else result
    funding: Optional[float] = None
    for key in ("account_funding_usd", "buying_power", "cash", "portfolio_value", "equity"):
        raw = payload.get(key) if isinstance(payload, dict) else None
        try:
            if raw is not None:
                funding = float(raw)
                break
        except (TypeError, ValueError):
            continue
    if funding is None or funding <= 0:
        return None
    return {"account_funding_usd": funding, "max_order_notional_usd": funding,
            "max_total_exposure_usd": funding}


# ── Status helpers ────────────────────────────────────────────────────

def _known_live_brokers() -> List[str]:
    """Return the recognized live-broker keys."""
    from src.config.schema import LIVE_BROKER_SERVER_KEYS
    return sorted(LIVE_BROKER_SERVER_KEYS)


def _oauth_token_present(broker: str) -> bool:
    """Return whether an OAuth token cache exists for a broker."""
    try:
        from src.live.paths import broker_dir
        oauth_dir = broker_dir(broker) / "oauth"
        return oauth_dir.is_dir() and any(oauth_dir.iterdir())
    except Exception:
        logger.debug("oauth presence check failed for %s", broker, exc_info=True)
        return False


def _active_mandate_state(broker: str) -> Optional[Any]:
    """Build the active-mandate snapshot for a broker."""
    from src.live.mandate.store import load_mandate
    mandate = load_mandate(broker)
    if mandate is None:
        return None
    consent = mandate.consent; caps = mandate.hard_caps
    expires_in: Optional[int] = None; expired = False
    try:
        expires_dt = datetime.fromisoformat(consent.expires_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        delta = expires_dt - now
        expires_in = int(delta.total_seconds())
        expired = expires_in <= 0
    except (ValueError, AttributeError):
        logger.debug("could not parse expires_at for %s mandate", broker, exc_info=True)
    from .models import ActiveMandateState, MandateLimits
    return ActiveMandateState(
        broker=broker, account_ref=consent.account_ref,
        created_at=consent.created_at, expires_at=consent.expires_at,
        expires_in_seconds=expires_in, expired=expired,
        limits=MandateLimits(
            max_order_notional_usd=caps.max_order_notional_usd,
            max_total_exposure_usd=caps.max_total_exposure_usd,
            max_leverage=caps.max_leverage,
            max_trades_per_day=caps.max_trades_per_day,
            allowed_instruments=[str(getattr(i, "value", i)) for i in caps.allowed_instruments],
            account_funding_usd=caps.account_funding_usd,
        ),
    )


def _runner_liveness_state(broker: str) -> Any:
    """Build the runner-liveness snapshot for a broker."""
    from .models import RunnerLivenessState
    alive = False; tick: Optional[float] = None; age: Optional[float] = None
    try:
        from src.live.runtime import liveness
        alive = bool(liveness.is_runner_alive(broker))
        raw_tick = liveness.last_tick(broker)
        if raw_tick is not None:
            tick = float(raw_tick)
            age = max(0.0, time.time() - tick)
    except Exception:
        logger.debug("runner liveness lookup failed for %s", broker, exc_info=True)
    return RunnerLivenessState(broker=broker, alive=alive, last_tick=tick, last_tick_age_seconds=age)


# ── Runner construction ───────────────────────────────────────────────

def _build_live_runner(broker: str) -> Any:
    """Construct a fully-wired LiveRunner for a broker."""
    if _runner_factory is not None:
        return _runner_factory(broker)
    from src.live.audit import write_live_action
    from src.live.runtime.reconcile import reconcile
    from src.live.runtime.runner import LiveRunner
    from src.live.runtime.scheduler import Scheduler
    from src.live.runtime.triggers import Trigger
    from src.trading.service import runner_tool_name

    def _tool(operation: str) -> str:
        remote_tool = runner_tool_name(broker, operation)
        if remote_tool is None:
            raise LiveRunnerUnavailable(f"live runner for {broker!r} does not define remote tool {operation!r}")
        return remote_tool

    adapter = _live_broker_adapter(broker)
    positions_tool = _tool("positions")
    balance_tool = _tool("account")
    open_orders_tool = _tool("orders")
    submit_order_tool = _tool("submit_order")
    cancel_order_tool = _tool("cancel_order")

    def _read(remote_tool: str):
        return lambda: adapter.call_tool(remote_tool, {})

    def _submit(order: Dict[str, Any]) -> Dict[str, Any]:
        if order.get("action") == "cancel":
            return adapter.call_tool(cancel_order_tool, order)
        return adapter.call_tool(submit_order_tool, order)

    svc = _get_session_service()
    session = svc.create_session(title=f"live-runner:{broker}")
    session_id = session.session_id

    async def _agent_caller(sid: str, prompt: str) -> Dict[str, Any]:
        return await svc.send_message(sid, prompt)

    def _audit_with_bus(event: Any) -> Dict[str, Any]:
        return write_live_action(
            event,
            event_callback=lambda etype, record: svc.event_bus.emit(session_id, etype, record),
        )

    runner_holder: Dict[str, Any] = {}
    async def _on_fire(_job: Any) -> None:
        runner = runner_holder.get("runner")
        if runner is not None:
            await runner.run_once()

    scheduler = Scheduler(_on_fire)
    runner = LiveRunner(
        broker, agent_caller=_agent_caller, reconcile_fn=reconcile,
        read_positions=_read(positions_tool), read_balance=_read(balance_tool),
        read_open_orders=_read(open_orders_tool), submit_fn=_submit,
        write_audit_fn=_audit_with_bus, scheduler=scheduler,
        triggers=[Trigger.market("us_equity")], session_id=session_id,
    )
    runner_holder["runner"] = runner
    return runner


async def _drive_runner(runner: Any) -> None:
    """Run a runner's run_loop to completion, sync or async."""
    result = runner.run_loop()
    if asyncio.iscoroutine(result):
        await result
    else:
        await asyncio.get_running_loop().run_in_executor(None, lambda: result)


# ── Live status builder ───────────────────────────────────────────────

def build_live_status(broker: Optional[str] = None) -> Dict[str, Any]:
    """Build the live status response dict."""
    from src.live.halt import halt_flag_set
    if broker is not None:
        target = broker.strip().lower()
        if not target:
            raise ValueError("broker must not be blank")
        brokers = [target]
    else:
        brokers = _known_live_brokers()
    known = set(_known_live_brokers())
    statuses = []
    for key in brokers:
        mand = _active_mandate_state(key)
        run_state = _runner_liveness_state(key)
        statuses.append({
            "auth": {
                "broker": key,
                "oauth_token_present": _oauth_token_present(key),
                "is_live_broker": key in known,
            },
            "mandate": mand.__dict__ if mand else None,
            "runner": {"broker": key, "alive": run_state.alive,
                       "last_tick": run_state.last_tick,
                       "last_tick_age_seconds": run_state.last_tick_age_seconds},
            "halted": halt_flag_set(broker=key),
        })
    return {"global_halted": halt_flag_set(broker=None), "brokers": statuses}
