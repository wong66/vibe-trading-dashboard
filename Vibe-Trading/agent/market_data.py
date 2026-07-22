"""Market data helpers (A-share quotes, US indices, US stocks) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
import yfinance as yf

from .common import a_code_to_tencent_symbol
from .data_provider import _mootdx_batch_quote_raw as _mootdx_batch_quote


# Tencent quote field positions (calibrated 2026-05)
_TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q="
_TQ_NAME = 1
_TQ_PRICE = 3
_TQ_LAST_CLOSE = 4
_TQ_OPEN = 5
_TQ_HIGH = 33
_TQ_LOW = 34
_TQ_PE_TTM = 39
_TQ_MCAP = 45
_TQ_FLOAT_MCAP = 44
_TQ_PB = 46

_YF_INDEX_MAP = {"IXIC": "^IXIC", "GSPC": "^GSPC", "DJI": "^DJI"}
_SINA_INDEX_MAP = {"IXIC": "gb_$ixic", "GSPC": "gb_$inx", "DJI": "gb_$dji"}
_SINA_QUOTE_URL = "https://hq.sinajs.cn/list="
_US_INDEX_NAMES = {"IXIC": "纳斯达克综合指数", "GSPC": "标普500指数", "DJI": "道琼斯工业指数"}

logger = logging.getLogger(__name__)


def _tencent_symbol(code: str) -> str:
    """Map a 6-digit A-share code to a Tencent quote symbol."""
    return a_code_to_tencent_symbol(code)


def _parse_tencent_line(line: str) -> Tuple[str, Dict[str, Any]] | None:
    """Parse one ``v_sh000001="..."`` line into (code, quote_dict)."""
    m = re.search(r'v_(\w+)="(.+)"', line)
    if not m:
        return None
    symbol = m.group(1)
    code = symbol[2:]
    fields = m.group(2).split("~")
    if len(fields) < max(_TQ_NAME, _TQ_PRICE, _TQ_LAST_CLOSE, _TQ_OPEN, _TQ_HIGH, _TQ_LOW) + 1:
        return None
    try:
        price = float(fields[_TQ_PRICE])
        last_close = float(fields[_TQ_LAST_CLOSE])
        change_amt = price - last_close
        change_pct = (change_amt / last_close * 100) if last_close != 0 else 0.0
        return code, {
            "code": code,
            "name": fields[_TQ_NAME],
            "price": price,
            "change_amt": round(change_amt, 4),
            "change_pct": round(change_pct, 2),
            "open": float(fields[_TQ_OPEN]) if fields[_TQ_OPEN] else 0.0,
            "high": float(fields[_TQ_HIGH]) if fields[_TQ_HIGH] else 0.0,
            "low": float(fields[_TQ_LOW]) if fields[_TQ_LOW] else 0.0,
            "mcap": float(fields[_TQ_MCAP]) if len(fields) > _TQ_MCAP and fields[_TQ_MCAP] else 0.0,
            "float_mcap": float(fields[_TQ_FLOAT_MCAP]) if len(fields) > _TQ_FLOAT_MCAP and fields[_TQ_FLOAT_MCAP] else 0.0,
            "pe_ttm": float(fields[_TQ_PE_TTM]) if len(fields) > _TQ_PE_TTM and fields[_TQ_PE_TTM] else 0.0,
            "pb": float(fields[_TQ_PB]) if len(fields) > _TQ_PB and fields[_TQ_PB] else 0.0,
            "source": "tencent",
        }
    except (ValueError, IndexError, ZeroDivisionError):
        return None


async def _fetch_tencent_quotes(codes: list[str]) -> dict:
    """Fetch real-time quotes for A-share indices/stocks.

    Primary channel is the a-stock-data **mootdx TCP feed (port 7709)**, which is
    NOT blocked by the corporate proxy. Tencent Finance (qt.gtimg.cn) is only used
    as a fallback for any code mootdx fails to return, so the watchlist never
    hangs on the blocked Tencent endpoint (the old "数据获取失败"/slow behaviour).
    """
    if not codes:
        return {}

    # ── 1) mootdx primary (TCP 7709, reliable in corporate network)
    mootdx_result: dict = {}
    try:
        mootdx_result = await asyncio.to_thread(_mootdx_batch_quote, codes)
    except Exception as exc:
        logger.warning("mootdx quote failed: %s", exc)

    # ── 2) Tencent fallback for any missing codes only
    missing = [c for c in codes if not (mootdx_result.get(c) or {}).get("price")]
    tencent_ok: dict = {}
    if missing:
        symbols = [_tencent_symbol(c) for c in missing]
        sym_to_code = dict(zip(symbols, missing))
        url = f"{_TENCENT_QUOTE_URL}{','.join(symbols)}"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=5.0)
                resp.raise_for_status()
            text = resp.content.decode("gbk")
            for line in text.splitlines():
                parsed = _parse_tencent_line(line.strip())
                if parsed:
                    stripped_code = parsed[0]
                    quote = parsed[1]
                    m = re.search(r'v_(\w+)="', line)
                    tc = m.group(1) if m else stripped_code
                    tencent_ok[sym_to_code.get(tc, stripped_code)] = quote
        except Exception as exc:
            logger.warning("Tencent quote fallback failed: %s", exc)

    result: dict = {}
    for c in codes:
        q = mootdx_result.get(c)
        if q and q.get("price"):
            _name = q.get("name")
            result[c] = {
                "code": c,
                "name": _name if _name else c,
                "price": q["price"],
                "change_amt": q.get("change_amt", 0),
                "change_pct": q.get("change_pct", 0),
                "open": q.get("open", 0),
                "high": q.get("high", 0),
                "low": q.get("low", 0),
                "mcap": q.get("mcap_yi", 0),
                "float_mcap": q.get("float_mcap_yi", 0),
                "pe_ttm": q.get("pe_ttm", 0),
                "pb": q.get("pb", 0),
                "source": "mootdx",
            }
            continue
        t = tencent_ok.get(c)
        if t and t.get("price"):
            _name = t.get("name")
            result[c] = {
                "code": c,
                "name": t.get("name") or c,
                "price": t.get("price", 0),
                "change_amt": t.get("change_amt", 0),
                "change_pct": t.get("change_pct", 0),
                "open": t.get("open", 0),
                "high": t.get("high", 0),
                "low": t.get("low", 0),
                "mcap": t.get("mcap", 0),
                "float_mcap": t.get("float_mcap", 0),
                "pe_ttm": t.get("pe_ttm", 0),
                "pb": t.get("pb", 0),
                "source": "tencent",
            }
        else:
            result[c] = {"code": c, "name": c, "price": 0, "change_amt": 0,
                         "change_pct": 0, "source": "mootdx", "error": "数据获取失败"}
    return result


def _parse_sina_line(line: str) -> Tuple[str, Dict[str, Any]] | None:
    """Parse one Sina Finance quote line into (code, quote_dict)."""
    m = re.search(r'var hq_str_[\w$.]+="(.+)"', line)
    if not m:
        return None
    fields = m.group(1).split(",")
    if len(fields) < 5:
        return None
    try:
        name = fields[0]
        price = float(fields[1])
        change_pct = float(fields[2])
        change_amt = float(fields[4]) if len(fields) > 4 else 0.0
        return None, {
            "name": name,
            "price": price,
            "change_amt": change_amt,
            "change_pct": change_pct,
            "source": "sina",
        }
    except (ValueError, IndexError):
        return None


async def _fetch_sina_us_indices(codes: list[str]) -> dict:
    """Fetch US index quotes via Sina Finance (free, no key needed, works from China)."""
    if not codes:
        return {}
    sina_symbols = []
    code_map = {}
    for c in codes:
        sym = _SINA_INDEX_MAP.get(c)
        if sym:
            sina_symbols.append(sym)
            code_map[sym] = c
    if not sina_symbols:
        return {}
    url = f"{_SINA_QUOTE_URL}{','.join(sina_symbols)}"
    result: dict = {}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10.0,
                headers={"Referer": "https://finance.sina.com.cn"})
            resp.raise_for_status()
        text = resp.content.decode("gbk")
        for line in text.splitlines():
            parsed = _parse_sina_line(line.strip())
            if parsed and parsed[1]:
                for sym, code in code_map.items():
                    if sym in line:
                        quote = parsed[1]
                        quote["code"] = code
                        quote["name"] = _US_INDEX_NAMES.get(code, quote["name"])
                        result[code] = quote
                        break
    except Exception as exc:
        logger.warning("Sina US index fetch failed: %s", exc)
    for c in codes:
        if c not in result:
            result[c] = {"code": c, "name": _US_INDEX_NAMES.get(c, c),
                         "price": 0, "change_amt": 0, "change_pct": 0,
                         "source": "sina", "error": "数据获取失败"}
    return result


async def _fetch_us_quotes(symbols: list[str]) -> dict:
    """Fetch real-time quotes for US indices/stocks via yfinance."""
    if not symbols:
        return {}
    result: dict = {}
    for raw in symbols:
        sym = _YF_INDEX_MAP.get(raw, raw)
        if not sym.startswith("^"):
            sym = sym.replace(".US", "")
        try:
            def _fetch_one():
                ticker = yf.Ticker(sym)
                info = ticker.info or {}
                price = info.get("regularMarketPrice") or info.get("currentPrice") or 0.0
                prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose") or 0.0
                change_amt = info.get("regularMarketChange", 0.0) or 0.0
                change_pct = info.get("regularMarketChangePercent", 0.0) or 0.0
                name = info.get("shortName") or info.get("longName") or raw
                if price == 0:
                    hist = ticker.history(period="2d")
                    if not hist.empty and len(hist) >= 2:
                        price = float(hist.iloc[-1]["Close"])
                        prev_close = float(hist.iloc[-2]["Close"])
                        change_amt = price - prev_close
                        change_pct = (change_amt / prev_close * 100) if prev_close else 0.0
                    elif not hist.empty:
                        price = float(hist.iloc[-1]["Close"])
                return {
                    "code": raw, "name": name, "price": price,
                    "change_amt": round(change_amt, 4),
                    "change_pct": round(change_pct, 2),
                    "source": "yfinance",
                }
            quote = await asyncio.to_thread(_fetch_one)
            result[raw] = quote
        except Exception as exc:
            logger.warning("US quote fetch failed for %s: %s", raw, exc)
            result[raw] = {"code": raw, "name": raw, "price": 0, "change_amt": 0,
                           "change_pct": 0, "source": "yfinance",
                           "error": f"数据获取失败: {exc}"}
        await asyncio.sleep(0.5)
    return result
