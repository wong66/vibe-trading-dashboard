"""K-line data fetching (A-share + US) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

import httpx

from .common import a_code_to_tencent_symbol


def _fetch_a_kline_tencent(code: str, period: str) -> list[dict]:
    """A-share daily K-line via Tencent Finance (前复权). Fallback to Baidu."""
    symbol = a_code_to_tencent_symbol(code)
    bars: list[dict] = []

    # Source 1: Tencent
    try:
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,640,qfq"
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"})
            if resp.status_code == 200:
                info = resp.json().get("info", {})
                rows = info.get("fqday") or info.get("day") or []
                for r in rows:
                    if len(r) < 6:
                        continue
                    try:
                        bars.append({
                            "time": str(r[0]), "open": float(r[1]), "close": float(r[2]),
                            "high": float(r[3]), "low": float(r[4]), "volume": float(r[5]),
                        })
                    except (TypeError, ValueError):
                        continue
    except Exception as exc:
        logger.debug("Tencent kline failed for %s: %s", code, exc)

    # Source 2: Baidu
    if not bars:
        try:
            url = "https://finance.pae.baidu.com/selfselect/getstockquotation"
            params = {
                "all": "1", "isIndex": "false", "isBk": "false", "isBlock": "false",
                "isFutures": "false", "isStock": "true", "newFormat": "1",
                "group": "quotation_kline_ab", "finClientType": "pc",
                "code": code, "ktype": "1",
            }
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/vnd.finance-web.v1+json",
                "Origin": "https://gushitong.baidu.com",
                "Referer": "https://gushitong.baidu.com/",
            }
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, params=params, headers=headers)
                if resp.status_code == 200:
                    d = resp.json()
                    result = d.get("Result", {})
                    md = result.get("newMarketData", {})
                    rows_raw = (md.get("marketData") or "").split(";")
                    for line in rows_raw:
                        if not line.strip():
                            continue
                        cells = line.split(",")
                        if len(cells) < 6:
                            continue
                        try:
                            date_str = str(cells[0])[:10]
                            if len(date_str) == 8 and date_str.isdigit():
                                date_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
                            bars.append({
                                "time": date_str, "open": float(cells[1]), "close": float(cells[2]),
                                "high": float(cells[3]), "low": float(cells[4]), "volume": float(cells[5]),
                            })
                        except (TypeError, ValueError):
                            continue
        except Exception as exc:
            logger.debug("Baidu kline failed for %s: %s", code, exc)

    period_days = {"1y": 240, "2y": 480, "3y": 720, "5y": 1200, "10y": 2400, "max": 999999}.get(period, 1200)
    if len(bars) > period_days:
        bars = bars[-period_days:]
    return bars


def _fetch_us_kline_yfinance(code: str, period: str, interval: str) -> list[dict]:
    """US stock K-line via yfinance history."""
    import yfinance as yf
    sym = code.upper().replace(".US", "")
    ticker = yf.Ticker(sym)
    df = ticker.history(period=period if period != "max" else "max", interval=interval, auto_adjust=True)
    bars: list[dict] = []
    if df is None or df.empty:
        return bars
    for idx, row in df.iterrows():
        try:
            d = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            bars.append({
                "time": d,
                "open": float(row.get("Open", 0) or 0),
                "close": float(row.get("Close", 0) or 0),
                "high": float(row.get("High", 0) or 0),
                "low": float(row.get("Low", 0) or 0),
                "volume": float(row.get("Volume", 0) or 0),
            })
        except Exception:
            continue
    return bars


def _fetch_a_mcap_history_mootdx(code: str, start_year: int = 2018) -> dict:
    """A-share historical market cap from Sina + mootdx."""
    import httpx
    from mootdx.quotes import Quotes

    client = Quotes.factory(market="std")

    # Total shares
    try:
        fin = client.finance(symbol=code)
        total_shares = float(fin.iloc[0]["zongguben"]) if fin is not None and not fin.empty else 0.0
    except Exception as exc:
        logger.debug("mootdx finance failed for %s: %s", code, exc)
        total_shares = 0.0
    total_shares_yi = total_shares / 1e8

    raw_bars: list[tuple[str, float]] = []

    # Main path: Sina getKLineData
    try:
        sina_symbol = ("sh" if code.startswith(("6", "9")) else "sz") + code
        sina_url = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
        sina_params = {"symbol": sina_symbol, "scale": "240", "ma": "no", "datalen": "10000"}
        sina_headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"}
        with httpx.Client(timeout=15.0, trust_env=False) as hclient:
            resp = hclient.get(sina_url, params=sina_params, headers=sina_headers)
            if resp.status_code == 200 and resp.text.startswith("["):
                arr = resp.json()
                if isinstance(arr, list) and arr:
                    cutoff = f"{start_year}-01-01"
                    for row in arr:
                        d = row.get("day", "")
                        c = row.get("close")
                        if not d or not c or d < cutoff:
                            continue
                        try:
                            c_f = float(c)
                        except (TypeError, ValueError):
                            continue
                        if c_f > 0:
                            raw_bars.append((d, c_f))
    except Exception as exc:
        logger.debug("sina kline failed for %s: %s", code, exc)

    # Fallback: mootdx
    if not raw_bars:
        try:
            df = client.bars(symbol=code, category=4, offset=800)
        except Exception as exc:
            logger.debug("mootdx bars failed for %s: %s", code, exc)
            df = None
        if df is not None and not df.empty:
            for idx, row in df.iterrows():
                try:
                    dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                    date_str = dt.strftime("%Y-%m-%d")
                    close = float(row.get("close") or 0)
                    if close > 0 and date_str >= f"{start_year}-01-01":
                        raw_bars.append((date_str, close))
                except Exception:
                    continue

    if not raw_bars:
        return {"code": code, "market": "A", "ts": time.time(),
                "total_shares_yi": round(total_shares_yi, 4), "weeks": []}

    # EastMoney snapshot for total shares
    try:
        secid = f"1.{code}" if code.startswith(("6", "9")) else f"0.{code}"
        url = "https://push2his.eastmoney.com/api/qt/stock/get"
        params = {"secid": secid, "fields": "f84", "fqt": "1", "klt": "1", "lmt": "1", "end": "20500101"}
        with httpx.Client(timeout=5.0) as hclient:
            r = hclient.get(url, params=params, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/"})
            if r.status_code == 200:
                d = r.json().get("data") or {}
                cur = d.get("f84")
                if cur:
                    cur_yi = float(cur) / 1e8
                    if cur_yi and abs(cur_yi - total_shares_yi) > 0.001:
                        total_shares_yi = cur_yi
    except Exception as exc:
        logger.debug("push2his total-shares snapshot failed for %s: %s", code, exc)

    # Weekly aggregation
    raw_bars.sort(key=lambda x: x[0])
    by_week: dict[tuple[int, int], tuple[str, float]] = {}
    for date_str, close in raw_bars:
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        iso = dt.isocalendar()
        key = (iso[0], iso[1])
        prev = by_week.get(key)
        if prev is None or date_str > prev[0]:
            by_week[key] = (date_str, close)

    weeks: list[dict] = []
    for (yr, wk) in sorted(by_week.keys()):
        date_str, close = by_week[(yr, wk)]
        mcap = close * total_shares_yi if total_shares_yi else 0.0
        weeks.append({
            "month": date_str, "date": date_str,
            "close": round(close, 3), "mcap_yi": round(mcap, 2),
        })
    return {
        "code": code, "market": "A", "ts": time.time(),
        "total_shares_yi": round(total_shares_yi, 4),
        "weeks": weeks, "months": weeks,
    }


def _fetch_us_mcap_history_yfinance(code: str) -> dict:
    """US: yfinance monthly history + sharesOutstanding from info."""
    import yfinance as yf
    ticker = yf.Ticker(code)
    try:
        hist = ticker.history(period="10y", interval="1mo", auto_adjust=True)
    except Exception as exc:
        logger.debug("yfinance history failed for %s: %s", code, exc)
        hist = None
    shares = 0
    try:
        info = ticker.info or {}
        shares = info.get("sharesOutstanding") or 0
    except Exception:
        shares = 0
    shares_yi = shares / 1e8 if shares else 0
    months: list[dict] = []
    if hist is not None and not hist.empty:
        for idx, row in hist.iterrows():
            try:
                dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                close = float(row.get("Close", 0) or 0)
                if close <= 0:
                    continue
                months.append({
                    "month": dt.strftime("%Y-%m"),
                    "close": round(close, 3),
                    "mcap_yi": round(close * shares_yi, 2) if shares_yi else 0.0,
                })
            except Exception:
                continue
    return {
        "code": code, "market": "US", "ts": time.time(),
        "total_shares_yi": round(shares_yi, 4), "months": months,
    }
