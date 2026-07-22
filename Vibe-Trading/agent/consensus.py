"""THS (同花顺) consensus EPS forecasts for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, List

from .common import http_client_sync

logger = logging.getLogger(__name__)


def _fetch_ths_consensus(code: str) -> dict:
    """Fetch 同花顺 institution consensus EPS data."""
    url = f"https://basic.10jqka.com.cn/new/{code}/worth.html"
    try:
        with http_client_sync() as client:
            resp = client.get(url)
            resp.raise_for_status()
            resp.encoding = "gbk"
            html = resp.text
    except Exception:
        return {"consensus_pe": None, "eps_current": None, "eps_next": None,
                "analyst_count": 0, "years": []}

    eps_current = eps_next = None
    analyst_count = 0
    years: list[str] = []

    table_pattern = re.compile(r'<table[^>]*>(.*?)</table>', re.DOTALL | re.IGNORECASE)
    row_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL | re.IGNORECASE)
    td_pattern = re.compile(r'<t[dh][^>]*>(.*?)</t[dh]>', re.DOTALL | re.IGNORECASE)
    tag_clean = re.compile(r'<[^>]+>')

    tables = table_pattern.findall(html)
    eps_table = None
    for t in tables:
        if "预测机构" in t or "每股收益" in t:
            eps_table = t
            break

    if eps_table:
        rows = row_pattern.findall(eps_table)
        data_rows: list[list[str]] = []
        for r in rows:
            cells = td_pattern.findall(r)
            cells_clean = [tag_clean.sub('', c).strip() for c in cells]
            if any(kw in c for c in cells_clean for kw in ("年度", "预测机构", "最小值")):
                continue
            if cells_clean:
                data_rows.append(cells_clean)

        for i, row in enumerate(data_rows):
            if i >= 2:
                break
            try:
                year = row[0] if len(row) > 0 else ""
                cnt = int(row[1]) if len(row) > 1 else 0
                mean_val = None
                if len(row) >= 4:
                    mean_val = float(row[3].replace(',', ''))
                elif len(row) >= 3:
                    mean_val = float(row[2].replace(',', ''))
                if mean_val is not None and mean_val > 0:
                    years.append(year)
                    if i == 0:
                        eps_current = mean_val
                        analyst_count = cnt
                    elif i == 1:
                        eps_next = mean_val
            except (ValueError, IndexError):
                continue

    return {
        "consensus_pe": None, "eps_current": eps_current, "eps_next": eps_next,
        "analyst_count": analyst_count, "years": years,
    }
