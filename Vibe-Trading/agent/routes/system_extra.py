"""Shadow reports, system shutdown, and skills routes for Vibe-Trading."""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse

from ..auth import require_auth

router = APIRouter()

_SHADOW_ID_RE = re.compile(r"^shadow_[0-9a-f]{8}$")
AGENT_DIR = Path(__file__).resolve().parent.parent


@router.get("/shadow-reports/{shadow_id}", dependencies=[Depends(require_auth)])
async def get_shadow_report(shadow_id: str, format: str = "html"):
    """Serve a rendered Shadow Account report (HTML by default, PDF if available)."""
    if not _SHADOW_ID_RE.match(shadow_id):
        raise HTTPException(status_code=400, detail="invalid shadow_id")
    if format not in ("html", "pdf"):
        raise HTTPException(status_code=400, detail="format must be html or pdf")
    reports_dir = Path.home() / ".vibe-trading" / "shadow_reports"
    path = reports_dir / f"{shadow_id}.{format}"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Shadow report not found: {shadow_id}.{format}")
    media_type = "text/html; charset=utf-8" if format == "html" else "application/pdf"
    return FileResponse(
        path, media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{shadow_id}.{format}"'},
    )


@router.get("/skills")
async def list_skills():
    """List registered skills (name and description)."""
    from src.agent.skills import SkillsLoader
    loader = SkillsLoader()
    return [{"name": s.name, "description": s.description} for s in loader.skills]
