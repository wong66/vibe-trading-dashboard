"""Industry reports (EastMoney reportapi) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .common import http_client_async

logger = logging.getLogger(__name__)

_EASTMONEY_REPORT_URL = "https://reportapi.eastmoney.com/report/list"

_REPORT_SECTOR_RULES: list[tuple[list[str], str]] = [
    (["灵巧手", "末端执行", "夹爪"], "灵巧手"),
    (["减速器", "谐波"], "减速器"),
    (["滚柱丝杠", "行星滚柱", "滚珠丝杠", "丝杠"], "丝杠"),
    (["执行器"], "执行器"),
    (["人形机器人", "人行机器人", "机器人"], "机器人"),
]

_AI_COMPUTE_REPORT_RULES: list[tuple[list[str], str]] = [
    (["玻璃基板", "玻璃中介层", "玻璃通孔", "TGV"], "玻璃基板"),
    (["MLCC", "多层陶瓷电容", "被动元件", "片式电容"], "MLCC"),
    (["液冷", "液冷散热", "冷板", "浸没式液冷", "数据中心散热"], "液冷散热"),
    (["交换芯片", "交换机芯片", "网络交换"], "交换芯片"),
    (["PCB", "印制电路板", "高多层板", "HDI", "载板"], "PCB"),
    (["光模块", "光引擎", "硅光", "CPO", "LPO", "800G", "1.6T"], "光模块"),
    (["HBM", "高带宽内存", "高带宽存储", "HBM3", "HBM4"], "HBM"),
    (["算力芯片", "GPU", "AI芯片", "算力卡", "训练芯片", "推理芯片", "寒武纪", "英伟达"], "算力芯片"),
    (["AI算力", "AI 算力", "智算中心", "算力基础设施", "算力基建", "AIDC", "东数西算"], "AI算力"),
]

_INDUSTRY_RULES: dict[str, list[tuple[list[str], str]]] = {
    "robot": _REPORT_SECTOR_RULES,
    "ai-compute": _AI_COMPUTE_REPORT_RULES,
}


def _classify_report(title: str, industry: str = "robot") -> str | None:
    """Return sector label if title matches any keyword, else None."""
    rules = _INDUSTRY_RULES.get(industry, _REPORT_SECTOR_RULES)
    for keywords, sector in rules:
        if any(kw in title for kw in keywords):
            return sector
    return None


async def _fetch_industry_reports(industry: str = "robot") -> list[dict]:
    """Fetch industry reports (qType=1) from EastMoney, filtered by sector keywords."""
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    all_reports: list[dict] = []
    seen_codes: set[str] = set()
    max_pages = 15

    async with http_client_async() as client:
        for page in range(1, max_pages + 1):
            params = {
                "industryCode": "*", "pageSize": "100", "industry": "*",
                "rating": "*", "ratingChange": "*",
                "beginTime": start_date, "endTime": end_date,
                "pageNo": str(page), "fields": "", "qType": "1",
                "orgCode": "", "code": "", "rcode": "",
                "p": str(page), "pageNum": str(page), "pageNumber": str(page),
            }
            try:
                resp = await client.get(_EASTMONEY_REPORT_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
            except Exception:
                break

            if not data.get("success") and not data.get("data"):
                break

            records = data.get("data") or []
            if not records:
                break

            for rec in records:
                title = rec.get("title", "")
                sector = _classify_report(title, industry)
                if sector is None:
                    continue

                info_code = rec.get("infoCode", "")
                if not info_code or info_code in seen_codes:
                    continue
                seen_codes.add(info_code)

                all_reports.append({
                    "title": title,
                    "publishDate": rec.get("publishDate", "")[:10],
                    "orgSName": rec.get("orgSName", ""),
                    "sector": sector,
                    "infoCode": info_code,
                    "industryName": rec.get("indvInduName", ""),
                })

            await asyncio.sleep(0.35)

            total_pages = data.get("TotalPage", 1)
            if page >= total_pages:
                break

    all_reports.sort(key=lambda r: r["publishDate"], reverse=True)
    return all_reports
