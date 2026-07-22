"""Run list helpers for Vibe-Trading API."""
from __future__ import annotations

import csv
import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

from .models import RunInfo


def list_runs_helper(runs_dir: Path, limit: int = 20) -> List[RunInfo]:
    """List recent runs with summary fields. Extracted from the original endpoint."""
    from src.ui_services import load_run_context

    limit = min(max(1, limit), 100)
    if not runs_dir.exists():
        return []

    run_dirs = sorted(
        [d for d in runs_dir.iterdir() if d.is_dir()],
        key=lambda x: x.name, reverse=True,
    )

    results = []
    for d in run_dirs[:limit]:
        run_id = d.name
        status_val = _resolve_run_status(d)
        created_at = _resolve_run_created_at(d, run_id)
        prompt = _resolve_run_prompt(d)
        total_return, sharpe = _resolve_run_metrics(d)
        run_context = load_run_context(d)
        results.append(RunInfo(
            run_id=run_id, status=status_val, created_at=created_at,
            prompt=prompt or "Manual Analysis",
            total_return=total_return, sharpe=sharpe,
            codes=run_context.get("codes") or [],
            start_date=run_context.get("start_date"),
            end_date=run_context.get("end_date"),
        ))
    return results


def _resolve_run_status(d: Path) -> str:
    """Determine run status from persisted files."""
    state_file = _load_json(d / "state.json")
    if state_file:
        return str(state_file.get("status") or "unknown").lower()
    if (d / "artifacts" / "equity.csv").exists():
        return "success"
    if (d / "review_report.json").exists():
        return "success"
    return "unknown"


def _resolve_run_created_at(d: Path, run_id: str) -> str:
    """Parse created_at from run_id or fall back to mtime."""
    if run_id.startswith("run_"):
        parts = run_id.split('_')
        if len(parts) >= 3:
            d_str, t_str = parts[1], parts[2]
            if len(d_str) == 8 and len(t_str) == 6:
                return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]} {t_str[:2]}:{t_str[2:4]}:{t_str[4:6]}"
    elif "_" in run_id:
        parts = run_id.split('_')
        if len(parts) >= 2:
            d_str, t_str = parts[0], parts[1]
            if len(d_str) == 8 and len(t_str) == 6:
                return f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]} {t_str[:2]}:{t_str[2:4]}:{t_str[4:6]}"
    mtime = datetime.fromtimestamp(d.stat().st_mtime)
    return mtime.strftime("%Y-%m-%d %H:%M:%S")


def _resolve_run_prompt(d: Path) -> Optional[str]:
    """Try req.json → planner_output.json → user_prompt.txt."""
    req_file = d / "req.json"
    if req_file.exists():
        try:
            req_data = json.loads(req_file.read_text(encoding="utf-8"))
            if req_data.get("prompt"):
                return req_data["prompt"]
        except (json.JSONDecodeError, OSError):
            pass

    planner_file = d / "planner_output.json"
    if planner_file.exists():
        try:
            planner_data = json.loads(planner_file.read_text(encoding="utf-8"))
            if planner_data.get("user_goal") or planner_data.get("goal"):
                return planner_data.get("user_goal") or planner_data.get("goal")
        except (json.JSONDecodeError, OSError):
            pass

    prompt_file = d / "user_prompt.txt"
    if prompt_file.exists():
        return prompt_file.read_text(encoding="utf-8").strip()
    return None


def _resolve_run_metrics(d: Path) -> tuple[Optional[float], Optional[float]]:
    """Read total_return and sharpe from metrics.csv."""
    metrics_file = d / "artifacts" / "metrics.csv"
    if metrics_file.exists():
        try:
            with open(metrics_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    return (
                        float(row.get('total_return', 0) or 0),
                        float(row.get('sharpe', 0) or 0),
                    )
        except (OSError, ValueError):
            pass
    return None, None


from .helpers import _load_json_file as _load_json  # noqa: F401
