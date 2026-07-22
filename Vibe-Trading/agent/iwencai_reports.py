"""iWencai (爱问财) research reports for a single stock.

Uses the same X-Claw + Bearer auth flow documented in the a-stock-data skill.
Returns report items in the same shape as eastmoney_reports so the two sources
can be merged downstream, with a `source` field tagging each row.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

IWENCAI_BASE = os.environ.get("IWENCAI_BASE_URL", "https://openapi.iwencai.com")
IWENCAI_KEY = os.environ.get("IWENCAI_API_KEY", "")


def _claw_headers(call_type: str = "normal") -> Dict[str, str]:
    """SkillHub 2.0 required X-Claw auth headers."""
    return {
        "X-Claw-Call-Type": call_type,
        "X-Claw-Skill-Id": "report-search",
        "X-Claw-Skill-Version": "2.0.0",
        "X-Claw-Plugin-Id": "none",
        "X-Claw-Plugin-Version": "none",
        "X-Claw-Trace-Id": secrets.token_hex(32),
    }


def _norm_date(v: Any) -> str:
    """Normalize iwencai publish_date (str 'YYYY-MM-DD' or int ms timestamp) to 'YYYY-MM-DD'."""
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(v / 1000).strftime("%Y-%m-%d")
        except Exception:
            return ""
    s = str(v).strip()
    if len(s) >= 10:
        return s[:10]
    return ""


def _fetch_reports_iwencai(code: str, months: int = 6) -> List[Dict]:
    """Fetch research reports for a stock from iWencai semantic search.

    Returns list of dicts shaped like eastmoney_reports output, with an extra
    `source` = '爱问财' and `url` for click-through. Empty list on any failure.
    """
    if not IWENCAI_KEY:
        logger.info("iWencai disabled: IWENCAI_API_KEY not set")
        return []

    cutoff = (datetime.now() - timedelta(days=months * 30)).strftime("%Y-%m-%d")

    headers = {
        "Authorization": f"Bearer {IWENCAI_KEY}",
        "Content-Type": "application/json",
        **_claw_headers(),
    }
    payload = {
        "channels": ["report"],
        "app_id": "AIME_SKILL",
        "query": f"{code} 研报",
        "size": 50,
    }

    try:
        r = requests.post(
            f"{IWENCAI_BASE}/v1/comprehensive/search",
            json=payload, headers=headers, timeout=30,
        )
        if r.status_code != 200:
            logger.warning("iWencai HTTP %s for %s", r.status_code, code)
            return []
        data = r.json()
        if data.get("status_code", 0) != 0:
            logger.warning("iWencai error for %s: %s", code, data.get("status_msg", ""))
            return []
        articles = data.get("data") or []
    except Exception as exc:
        logger.warning("iWencai request failed for %s: %s", code, exc)
        return []

    result: List[Dict] = []
    for a in articles:
        extra = a.get("extra") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:
                extra = {}
        date = _norm_date(a.get("publish_date") or extra.get("publish_date"))
        if not date or date < cutoff:
            continue
        # Keep only articles that actually mention this stock (if stock_infos present)
        stock_infos = a.get("stock_infos") or []
        codes = [str(s.get("code", "")) for s in stock_infos if isinstance(s, dict)]
        if codes and code not in codes:
            continue
        # iWencai returns a generic mobile 10jqka page (ms.10jqka.com?duid=xxx)
        # that is useless as a per-article link.  Replace with the PC stock
        # report list page so users can find the original article.
        # Extract structured fields from iWencai response
        raw_rating = extra.get("rating", "") or ""
        # Normalize rating to eastmoney-compatible labels
        rating_map = {
            "买入": "买入", "强烈推荐": "强烈推荐", "推荐": "推荐",
            "增持": "增持", "谨慎推荐": "增持",
            "中性": "中性", "观望": "中性", "持有": "中性",
            "减持": "减持", "卖出": "卖出", "回避": "卖出",
        }
        rating = rating_map.get(raw_rating, raw_rating) if raw_rating else ""

        # Use the 10jqka stock report page (accessible) as click-through.
        # The search page (so.10jqka.com.cn/search) only renders a blank shell,
        # so we point users to the per-stock report list where the original lives.
        url = f"https://stockpage.10jqka.com.cn/{code}/report/"

        result.append({
            "title": a.get("title", ""),
            "org": extra.get("organization", "") or a.get("source", "") or "",
            "date": date,
            "rating": rating,
            "eps_this_year": None,   # iWencai has no structured EPS; summary text has unstructured forecasts
            "eps_next_year": None,
            "info_code": "",
            "url": url,
            "source": "爱问财",
            # Real report abstract returned by iWencai — display inline so users
            # never need to click a blank external link to read the content.
            "summary": (a.get("summary", "") or "").strip(),
            "target_price": None,
        })
    # Deduplicate by (title, org, date) — iWencai may return same article multiple times
    seen: set = set()
    unique: List[Dict] = []
    for item in result:
        key = (item["title"], item["org"], item["date"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique
