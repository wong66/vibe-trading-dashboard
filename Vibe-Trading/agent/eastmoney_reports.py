"""EastMoney research reports for a single stock."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from .common import http_client_sync

logger = logging.getLogger(__name__)


def _fetch_reports_eastmoney(code: str, months: int = 6) -> list[dict]:
    """Fetch research reports from EastMoney reportapi, filtered by publishDate."""
    cutoff = (datetime.now() - timedelta(days=months * 30)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")

    REPORT_API = "https://reportapi.eastmoney.com/report/list"
    all_records = []
    try:
        with http_client_sync() as client:
            for page in range(1, 4):
                params = {
                    "industryCode": "*", "pageSize": "100", "industry": "*",
                    "rating": "*", "ratingChange": "*",
                    "beginTime": cutoff, "endTime": today,
                    "pageNo": str(page), "fields": "", "qType": "0",
                    "orgCode": "", "code": code, "rcode": "",
                    "p": str(page), "pageNum": str(page), "pageNumber": str(page),
                }
                resp = client.get(REPORT_API, params=params)
                resp.raise_for_status()
                d = resp.json()
                rows = d.get("data") or []
                if not rows:
                    break
                all_records.extend(rows)
                total_pages = d.get("TotalPage", 1) or 1
                if page >= total_pages:
                    break
    except Exception:
        pass

    result = []
    for r in all_records:
        result.append({
            "title": r.get("title", ""),
            "org": r.get("orgSName", ""),
            "date": (r.get("publishDate", "") or "")[:10],
            "rating": r.get("emRatingName", ""),
            "eps_this_year": r.get("predictThisYearEps"),
            "eps_next_year": r.get("predictNextYearEps"),
            "info_code": r.get("infoCode", ""),
            # EastMoney list API has no prose abstract; surface the structured
            # highlights (target price / rating) so the UI can render a core view
            # without scraping the JS-rendered detail page.
            "summary": "",
            "target_price": r.get("indvAimPriceT"),
        })
    return result
