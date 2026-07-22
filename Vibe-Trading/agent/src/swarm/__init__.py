"""Swarm multi-agent system — package entry point."""

from __future__ import annotations

from agent.src.swarm.models import (
    RunStatus,
    SwarmAgentSpec,
    SwarmEvent,
    SwarmRun,
    SwarmTask,
    TaskStatus,
    WorkerResult,
)
from agent.src.swarm.presets import build_run_from_preset, inspect_preset, list_presets, load_preset
from agent.src.swarm.runtime import SwarmRuntime
from agent.src.swarm.store import SwarmStore
from agent.src.swarm.worker import run_worker

__all__ = [
    "RunStatus",
    "SwarmAgentSpec",
    "SwarmEvent",
    "SwarmRun",
    "SwarmRuntime",
    "SwarmStore",
    "SwarmTask",
    "TaskStatus",
    "WorkerResult",
    "build_run_from_preset",
    "inspect_preset",
    "list_presets",
    "load_preset",
    "run_worker",
]
