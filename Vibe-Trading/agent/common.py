"""Shared utilities for Vibe-Trading backend."""
from __future__ import annotations

import ipaddress
import os
from typing import Any, Optional

import httpx


def safe_float(v, default: float = 0.0) -> float:
    """Safely convert a value to float, handling None, '', '--', commas, %."""
    if v in (None, "", "--"):
        return default
    try:
        s = str(v).replace(",", "").replace("%", "")
        return float(s)
    except (TypeError, ValueError):
        return default


def env_flag_enabled(name: str) -> bool:
    """Check if an environment variable flag is explicitly enabled."""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def is_local_client(request) -> bool:
    """Return whether the request originates from a loopback or trusted client."""
    host = request.client.host if request.client else ""
    if host in {"localhost", "testclient"}:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return _trusted_docker_loopback_ip(ip)


def _default_gateway_ips() -> set:
    """Read default gateway IPs from /proc/net/route for Docker loopback detection."""
    gateways: set[ipaddress.IPv4Address] = set()
    try:
        lines = __import__("pathlib").Path("/proc/net/route").read_text(encoding="utf-8").splitlines()
    except OSError:
        return gateways
    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 3 or fields[1] != "00000000":
            continue
        try:
            raw = int(fields[2], 16).to_bytes(4, byteorder="little")
            gateways.add(ipaddress.IPv4Address(raw))
        except ValueError:
            continue
    return gateways


def _trusted_docker_loopback_ip(ip) -> bool:
    """Check if an IP is a trusted Docker gateway loopback."""
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    if not env_flag_enabled("VIBE_TRADING_TRUST_DOCKER_LOOPBACK"):
        return False
    return ip in _default_gateway_ips()


def a_code_to_exchange(code: str) -> str:
    """Map A-share 6-digit code to exchange prefix: sh/sz/bj."""
    if code.startswith(("6", "9")):
        return "sh"
    elif code.startswith(("4", "8")):
        return "bj"
    else:
        return "sz"


def a_code_to_tencent_symbol(code: str) -> str:
    """Map A-share code to Tencent quote symbol (e.g., sh601138)."""
    if code.startswith(("sh", "sz", "bj")):
        return code
    return f"{a_code_to_exchange(code)}{code}"


_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}


def http_client_sync(**kwargs) -> httpx.Client:
    """Create a standard synchronous HTTP client with default headers."""
    headers = dict(_DEFAULT_HEADERS)
    headers.update(kwargs.pop("headers", {}))
    return httpx.Client(headers=headers, **kwargs)


def http_client_async(**kwargs) -> httpx.AsyncClient:
    """Create a standard async HTTP client with default headers."""
    headers = dict(_DEFAULT_HEADERS)
    headers.update(kwargs.pop("headers", {}))
    return httpx.AsyncClient(headers=headers, **kwargs)
