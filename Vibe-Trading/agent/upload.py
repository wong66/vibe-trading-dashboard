"""File upload handling for Vibe-Trading API."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

AGENT_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = AGENT_DIR / "uploads"

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
_UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MB

_BLOCKED_UPLOAD_EXT = {
    ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".app", ".dmg",
    ".so", ".dll", ".dylib",
    ".py", ".pyw", ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".yaml", ".yml", ".j2", ".jinja", ".jinja2", ".template",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
}

_BLOCKED_UPLOAD_NAMES = {"dockerfile", "containerfile"}


async def upload_file(file: UploadFile) -> dict:
    """Upload any document or data file (max 50MB)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    filename = Path(file.filename).name
    ext = Path(filename).suffix.lower()
    if ext in _BLOCKED_UPLOAD_EXT or filename.lower() in _BLOCKED_UPLOAD_NAMES:
        raise HTTPException(status_code=400, detail="This file type is not allowed for upload.")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / safe_name
    total_size = 0

    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as handle:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    handle.close()
                    if dest.exists():
                        dest.unlink()
                    raise HTTPException(status_code=413, detail=f"File too large (limit {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)")
                handle.write(chunk)
    except HTTPException:
        raise
    except OSError as exc:
        if dest.exists():
            dest.unlink()
        raise HTTPException(
            status_code=500,
            detail="Upload failed while storing the file. Please retry or choose a different file.",
        ) from exc
    finally:
        await file.close()

    return {"status": "ok", "file_path": f"uploads/{safe_name}", "filename": filename}
