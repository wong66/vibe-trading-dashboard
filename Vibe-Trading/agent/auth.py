"""Auth helpers for Vibe-Trading API."""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import HTTPException, Query, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .common import is_local_client

_security = HTTPBearer(auto_error=False)
_API_KEY = os.getenv("API_AUTH_KEY")


def configured_api_key() -> str:
    """Return the configured API auth key."""
    return os.getenv("API_AUTH_KEY") or _API_KEY or ""


async def require_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Require valid API key for non-local requests."""
    _validate_api_auth(request=request, cred=cred)


async def require_event_stream_auth(
    request: Request,
    api_key: Optional[str] = Query(None),
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Allow API key via query param for SSE streams."""
    _validate_api_auth(request=request, cred=cred, query_api_key=api_key, allow_query=True)


def _auth_cred_from_header_or_query(cred, query_api_key, *, allow_query: bool) -> str:
    if cred and cred.credentials:
        return cred.credentials
    if allow_query and query_api_key:
        return query_api_key
    return ""


def _validate_api_auth(*, request: Request, cred, query_api_key=None, allow_query: bool = False) -> None:
    if is_local_client(request):
        return
    api_key = configured_api_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API_AUTH_KEY is required for non-local API access"
        )
    token = _auth_cred_from_header_or_query(cred, query_api_key, allow_query=allow_query)
    if not token or not hmac.compare_digest(token, api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


async def require_local_or_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Require local client OR valid API key."""
    if configured_api_key():
        await require_auth(request, cred)
        return
    if not is_local_client(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Settings access requires API_AUTH_KEY or a local loopback client",
        )
