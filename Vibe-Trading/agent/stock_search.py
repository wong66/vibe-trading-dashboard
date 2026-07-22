"""Stock search (EastMoney A-shares + yfinance US) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

import yfinance as yf

from .common import http_client_async

logger = logging.getLogger(__name__)

_EASTMONEY_SUGGEST_HINT_URL = "https://searchadapter.eastmoney.com/api/suggest/get"
_US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "BATS", "CBOE", "OTC"}


async def _search_a_stock(keyword: str, limit: int = 10) -> list[dict]:
    """Search A-share stocks by keyword via EastMoney suggest."""
    results: list[dict] = []
    try:
        import urllib.parse
        encoded = urllib.parse.quote(keyword)
        url = f"{_EASTMONEY_SUGGEST_HINT_URL}?input={encoded}&type=14"
        async with http_client_async() as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return results
        data = resp.json()
        qct = data.get("QuotationCodeTable") or {}
        rows = qct.get("Data") or []
        for r in rows:
            code = str(r.get("Code", "")).strip()
            name = str(r.get("Name", "")).strip()
            if not code or not name:
                continue
            if not (code.isdigit() and len(code) == 6):
                continue
            if not code.startswith(("0", "3", "4", "6", "8", "9")):
                continue
            results.append({
                "code": code,
                "name": name,
                "market": "A",
                "exchange": r.get("SecurityTypeName", ""),
            })
            if len(results) >= limit:
                break
    except Exception as exc:
        logger.warning("A-share search failed for %s: %s", keyword, exc)
    return results


async def _search_us_stock(keyword: str, limit: int = 10) -> list[dict]:
    """Search US stocks by keyword via yfinance."""
    try:
        def _search():
            ticker = yf.Ticker(keyword.upper())
            results = []
            try:
                search_results = ticker.search(keyword)
            except Exception:
                info = ticker.info or {}
                if info.get("symbol"):
                    exchange = info.get("exchange", "")
                    if exchange in _US_EXCHANGES or "." not in info.get("symbol", ""):
                        results.append({
                            "code": f"{info['symbol']}.US",
                            "name": info.get("shortName") or info.get("longName", info["symbol"]),
                            "market": "US",
                            "exchange": exchange or "US",
                        })
                return results

            if search_results is not None and hasattr(search_results, "quotes"):
                for q in search_results.quotes[:limit]:
                    exchange = getattr(q, "exchange", "") or ""
                    symbol = getattr(q, "symbol", "")
                    short_name = getattr(q, "shortname") or getattr(q, "longname") or symbol
                    if exchange in _US_EXCHANGES and symbol:
                        results.append({
                            "code": f"{symbol}.US",
                            "name": short_name,
                            "market": "US",
                            "exchange": exchange,
                        })
            return results

        return await asyncio.to_thread(_search)
    except Exception as exc:
        logger.warning("US stock search failed for %s: %s", keyword, exc)
        return []
