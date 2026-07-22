"""A股量化决策 — 融资融券概览（独立于信号引擎，避免引擎 import 失败连累此功能）。"""
from __future__ import annotations
from typing import Any, Dict
from .data_provider import eastmoney_datacenter

def margin_trading_overview(top_n: int = 10) -> Dict[str, Any]:
    """返回： """

    try:
        return _margin_trading_overview_impl(top_n)
    except Exception as e:  # 网络/结构异常 → 优雅降级
        return {"available": False, "market": {}, "top_buy": [], "error": str(e)[:120]}


def _margin_trading_overview_impl(top_n: int = 10) -> Dict[str, Any]:
    market_rows = eastmoney_datacenter(
        "RPTA_WEB_RZRQ_GGZJ",
        columns="DATE,TOTAL_RZYE,RZYE,RQYE,RZMRE,RZCHE,RQCHE,RQMLE",
        page_size=5,
        sort_columns="DATE", sort_types="-1",
    ) or []
    market = {}
    if market_rows:
        last = market_rows[0] if isinstance(market_rows[0], dict) else {}
        market = {
            "date": str(last.get("DATE", ""))[:10],
            "total_rzye_yi": round((last.get("RZYE") or 0) / 1e8, 1),   # 融资余额(亿)
            "total_rqye_yi": round((last.get("RQYE") or 0) / 1e8, 1),   # 融券余额(亿)
            "rzmre_yi": round((last.get("RZMRE") or 0) / 1e8, 1),       # 融资买入(亿)
            "rzche_yi": round((last.get("RZCHE") or 0) / 1e8, 1),       # 融资偿还(亿)
        }

    detail_rows = eastmoney_datacenter(
        "RPTA_WEB_RZRQ_GGMX",
        columns="SCODE,SNAME,DATE,RZYE,RZMRE,RZCHE,RZJME",
        page_size=top_n * 3,
        sort_columns="RZJME", sort_types="-1",
    ) or []
    top_buy = []
    seen = set()
    for row in detail_rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("SCODE", ""))
        if code in seen or not code:
            continue
        seen.add(code)
        net = (row.get("RZJME") or 0) / 1e8  # 融资净买入(亿)
        if net <= 0:
            continue
        top_buy.append({
            "code": code,
            "name": row.get("SNAME", ""),
            "date": str(row.get("DATE", ""))[:10],
            "rzye_yi": round((row.get("RZYE") or 0) / 1e8, 2),
            "net_buy_yi": round(net, 2),
        })
        if len(top_buy) >= top_n:
            break

    return {
        "available": bool(market),
        "market": market,
        "top_buy": top_buy,
    }

