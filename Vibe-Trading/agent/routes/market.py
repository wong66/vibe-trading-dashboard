"""Market data routes for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Dict, List

logger = logging.getLogger(__name__)

# ── 研报 AI 总结缓存（按 code 缓存，避免重复选同一只股票反复烧 token） ──
_SUMMARY_CACHE: Dict[str, dict] = {}  # {code: {summary, model, ts}}
_SUMMARY_TTL = 86400.0  # 24 小时（研报日更，一天内无需重新总结）

from fastapi import APIRouter, HTTPException, Query

from ..auth import require_auth
from ..common import safe_float
from ..consensus import _fetch_ths_consensus
from ..eastmoney_reports import _fetch_reports_eastmoney
from ..iwencai_reports import _fetch_reports_iwencai
from ..fundamentals import (
    _apply_ttm_margins,
    _build_business_segments_a,
    _build_fundamentals_from_statements,
    _build_ttm_yoy,
    _fetch_a_fundamentals_sina,
    _fetch_deducted_profit_eastmoney,
    _fetch_us_fundamentals_yfinance,
)
from ..industry_reports import _fetch_industry_reports, _INDUSTRY_RULES
from ..kline_data import (
    _fetch_a_kline_tencent,
    _fetch_a_mcap_history_mootdx,
    _fetch_us_kline_yfinance,
    _fetch_us_mcap_history_yfinance,
)
from ..market_data import (
    _fetch_sina_us_indices,
    _fetch_tencent_quotes,
    _fetch_us_quotes,
    _SINA_INDEX_MAP,
    _SINA_QUOTE_URL,
    _TENCENT_QUOTE_URL,
    _US_INDEX_NAMES,
    _YF_INDEX_MAP,
)
from ..sector_data import get_sector_data
from ..stock_search import _search_a_stock, _search_us_stock

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Market data
# ============================================================================

@router.get("/market-data")
async def get_market_data(
    indices: str = Query("", description="Comma-separated index codes"),
    stocks_a: str = Query("", description="Comma-separated A-share stock codes"),
    stocks_us: str = Query("", description="Comma-separated US stock codes"),
):
    idx_codes = [c.strip() for c in indices.split(",") if c.strip()]
    a_codes = [c.strip() for c in stocks_a.split(",") if c.strip()]
    us_codes = [c.strip() for c in stocks_us.split(",") if c.strip()]

    def _is_tencent(code: str) -> bool:
        return code.isdigit() or code.startswith(("sh", "sz", "bj"))

    tencent_codes = [c for c in idx_codes if _is_tencent(c)] + a_codes
    sina_idx = [c for c in idx_codes if not _is_tencent(c)]
    yf_stocks = us_codes

    tencent_task = _fetch_tencent_quotes(tencent_codes) if tencent_codes else None
    sina_task = _fetch_sina_us_indices(sina_idx) if sina_idx else None
    yf_task = _fetch_us_quotes(yf_stocks) if yf_stocks else None

    tasks: list = []
    task_keys: list[str] = []
    if tencent_task:
        tasks.append(tencent_task); task_keys.append("tencent")
    if sina_task:
        tasks.append(sina_task); task_keys.append("sina")
    if yf_task:
        tasks.append(yf_task); task_keys.append("yf")

    raw_results = await asyncio.gather(*tasks) if tasks else []
    results_by_key = dict(zip(task_keys, raw_results))

    tencent_result = results_by_key.get("tencent", {})
    sina_result = results_by_key.get("sina", {})
    yf_result = results_by_key.get("yf", {})

    idx_result = {}
    for c in idx_codes:
        idx_result[c] = tencent_result.get(c) or sina_result.get(c) or {
            "code": c, "name": c, "price": 0, "change_amt": 0, "change_pct": 0,
            "source": "unknown", "error": "数据获取失败"}

    return {
        "indices": idx_result,
        "stocks_a": {c: tencent_result.get(c, {"code": c, "name": c, "price": 0,
                  "change_pct": 0, "source": "tencent", "error": "数据获取失败"})
                  for c in a_codes},
        "stocks_us": yf_result,
        "ts": time.time(),
    }


# ============================================================================
# Stock search
# ============================================================================

@router.get("/stock-search")
async def search_stocks(q: str = Query(..., min_length=1, description="Search keyword")):
    keyword = q.strip()
    a_results, us_results = await asyncio.gather(
        _search_a_stock(keyword, limit=10), _search_us_stock(keyword, limit=10))
    return {"q": keyword, "results": a_results + us_results}


# ============================================================================
# Industry reports
# ============================================================================

@router.get("/industry-reports")
async def get_industry_reports(industry: str = Query("robot", description="Industry group: robot | ai-compute")):
    if industry not in _INDUSTRY_RULES:
        industry = "robot"
    try:
        reports = await _fetch_industry_reports(industry)
        return {"reports": reports, "total": len(reports), "ts": time.time()}
    except Exception as e:
        logger.error("industry-reports failed: %s", e)
        return {"reports": [], "total": 0, "ts": time.time(), "error": str(e)}


# ============================================================================
# Correlation
# ============================================================================

@router.get("/correlation")
async def get_correlation_matrix(
    codes: str = Query(..., description="Comma-separated asset codes"),
    days: int = Query(90, description="Lookback window in days", ge=7, le=365),
    method: str = Query("pearson", description="Correlation method: pearson or spearman"),
):
    from backtest.correlation import compute_correlation_matrix
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if len(code_list) < 2:
        raise HTTPException(status_code=400, detail="At least 2 asset codes required")
    if len(code_list) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 assets per request")
    if method not in ("pearson", "spearman"):
        raise HTTPException(status_code=400, detail="method must be 'pearson' or 'spearman'")
    try:
        raw = await asyncio.get_event_loop().run_in_executor(
            None, lambda: compute_correlation_matrix(codes=code_list, days=days, method=method))
        matrix = [[float(v) for v in row] for row in raw["matrix"]]
        return {**raw, "matrix": matrix}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correlation computation failed: {exc}")


# ============================================================================
# Stock K-line
# ============================================================================

@router.get("/stock-kline")
async def get_stock_kline(
    code: str = Query(..., description="Stock code: A-share (688017) or US (AAPL)"),
    market: str = Query("A", description="Market: A or US"),
    period: str = Query("5y", description="Lookback: 1y/2y/3y/5y/10y/max"),
    interval: str = Query("1d", description="Bar interval: 1d/1wk/1mo"),
):
    code = code.strip(); market = market.strip().upper(); period = period.strip().lower()
    if market not in ("A", "US"):
        raise HTTPException(status_code=400, detail="market must be A or US")
    try:
        if market == "A":
            bars = await asyncio.to_thread(_fetch_a_kline_tencent, code, period)
        else:
            bars = await asyncio.to_thread(_fetch_us_kline_yfinance, code, period, interval)
        return {"code": code, "market": market, "period": period, "bars": bars, "ts": time.time()}
    except Exception as exc:
        logger.warning("stock-kline failed for %s (%s): %s", code, market, exc)
        return {"code": code, "market": market, "period": period, "bars": [], "ts": time.time(), "error": str(exc)}


# ============================================================================
# Sector data
# ============================================================================

@router.get("/sector-data")
async def get_sector_data_endpoint(q: str = Query("半导体", description="Sector name or keyword")):
    q = q.strip()
    try:
        return await get_sector_data(q)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("sector-data failed for %s: %s", q, exc)
        return {"sector": q, "boardCode": "", "dashboard": None, "kline": [],
                "stocks": [], "ts": time.time(), "error": str(exc)}


# ============================================================================
# Stock market cap history
# ============================================================================

@router.get("/stock-mcap-history")
async def get_stock_mcap_history(
    code: str = Query(..., description="Stock code (A-share 6 digits)"),
    market: str = Query("A", description="Market: A or US"),
    start_year: int = Query(2018, description="Earliest year to fetch"),
):
    code = code.strip(); market = market.strip().upper()
    if market not in ("A", "US"):
        raise HTTPException(status_code=400, detail="market must be A or US")
    try:
        if market == "A":
            return await asyncio.to_thread(_fetch_a_mcap_history_mootdx, code, start_year)
        else:
            return await asyncio.to_thread(_fetch_us_mcap_history_yfinance, code)
    except Exception as exc:
        logger.warning("stock-mcap-history failed for %s (%s): %s", code, market, exc)
        return {"code": code, "market": market, "months": [], "total_shares_yi": 0, "ts": time.time(), "error": str(exc)}


# ============================================================================
# Stock fundamentals
# ============================================================================

@router.get("/stock-fundamentals")
async def get_stock_fundamentals(
    code: str = Query(..., description="Stock code: A-share or US"),
    market: str = Query("A", description="Market: A or US"),
    num_periods: int = Query(34, description="Number of quarterly periods"),
    seg_period: str | None = Query(None, description="Business segments period YYYY-MM-DD"),
):
    code = code.strip(); market = market.strip().upper()
    if market not in ("A", "US"):
        raise HTTPException(status_code=400, detail="market must be A or US")
    try:
        if market == "A":
            stmts = await _fetch_a_fundamentals_sina(code, num_periods=num_periods)
            # EastMoney endpoints are blocked by the corporate proxy → run each
            # with a short timeout and degrade gracefully so the main path
            # (Sina 三表) returns fast instead of timing out the whole panel.
            try:
                deduct_idx = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_deducted_profit_eastmoney, code, num_periods), timeout=3.0)
            except Exception:
                deduct_idx = {}
            periods = _build_fundamentals_from_statements(
                stmts.get("lrb", []), stmts.get("fzb", []), stmts.get("llb", []), deduct_idx=deduct_idx)
            periods = _build_ttm_yoy(periods)
            periods = _apply_ttm_margins(periods)
            try:
                segs = await asyncio.wait_for(
                    asyncio.to_thread(_build_business_segments_a, code, seg_period), timeout=3.0)
            except Exception:
                segs = {"periods": [], "current": "", "by_industry": [], "by_product": [],
                        "by_region": [], "by_region_series": []}
        else:
            us = await asyncio.to_thread(_fetch_us_fundamentals_yfinance, code)
            periods = us.get("periods", [])
            periods = _build_ttm_yoy(periods) if periods and "revenue" in periods[0] else periods
            periods = _apply_ttm_margins(periods) if periods and "revenue" in periods[0] else periods
            segs = {"by_product": [], "by_region": []}
        return {"code": code, "market": market, "periods": periods, "segments": segs, "ts": time.time()}
    except Exception as exc:
        logger.warning("stock-fundamentals failed for %s (%s): %s", code, market, exc)
        return {"code": code, "market": market, "periods": [], "segments": {}, "ts": time.time(), "error": str(exc)}


# ============================================================================
# Stock consensus
# ============================================================================

@router.get("/stock-consensus")
async def get_stock_consensus(
    code: str = Query(..., description="Stock code: A-share"),
    price: float = Query(0, description="Current stock price for PE calculation"),
):
    code = code.strip()
    try:
        data = await asyncio.to_thread(_fetch_ths_consensus, code)
        if price > 0 and data.get("eps_current"):
            data["consensus_pe"] = round(price / data["eps_current"], 2)
        return {"code": code, **data, "ts": time.time()}
    except Exception as exc:
        logger.warning("stock-consensus failed for %s: %s", code, exc)
        return {"code": code, "consensus_pe": None, "eps_current": None,
                "eps_next": None, "analyst_count": 0, "years": [], "ts": time.time(), "error": str(exc)}


# ============================================================================
# Stock reports
# ============================================================================

@router.get("/stock-reports")
async def get_stock_reports(
    code: str = Query(..., description="Stock code (A-share)"),
    months: int = Query(6, description="Lookback months for reports"),
):
    code = code.strip()
    try:
        # Fetch from EastMoney (primary) + iWencai (爱问财), then merge & dedup.
        em_reports = await asyncio.to_thread(_fetch_reports_eastmoney, code, months)
        iw_reports = await asyncio.to_thread(_fetch_reports_iwencai, code, months)
        for r in em_reports:
            r["source"] = "东财"
        merged = []
        seen = set()
        for r in em_reports + iw_reports:
            key = (r.get("title", ""), r.get("date", ""))
            if key in seen:
                continue
            seen.add(key)
            merged.append(r)
        merged.sort(key=lambda x: x.get("date", ""), reverse=True)
        return {"code": code, "reports": merged, "count": len(merged), "ts": time.time()}
    except Exception as exc:
        logger.warning("stock-reports failed for %s: %s", code, exc)
        return {"code": code, "reports": [], "count": 0, "ts": time.time(), "error": str(exc)}


def _build_report_context(code: str, em_reports: list, iw_reports: list) -> str:
    """Assemble a compact context string from both sources for the LLM."""
    pieces: list[str] = []
    for r in iw_reports:
        summary = (r.get("summary") or "").strip()
        if summary:
            pieces.append(
                f"【爱问财 · {r.get('org','')} · {r.get('date','')} · 评级{r.get('rating','')}】\n{summary[:900]}"
            )
    for r in em_reports:
        org = r.get("org", "")
        date = r.get("date", "")
        rating = r.get("rating", "")
        tp = r.get("target_price")
        eps = r.get("eps_this_year")
        parts = [f"【东财 · {org} · {date} · 评级{rating}"]
        if tp not in (None, "", "0", 0):
            try:
                parts.append(f"目标价{float(tp):.2f}元")
            except (TypeError, ValueError):
                pass
        if eps not in (None, "", 0):
            try:
                parts.append(f"当年EPS预测{float(eps):.2f}元")
            except (TypeError, ValueError):
                pass
        parts.append("】")
        pieces.append("".join(parts))
    # Cap to most recent ~12 reports to stay within prompt limits.
    return "\n\n".join(pieces[:12])


def _ai_summarize_reports(code: str, context: str) -> str:
    """Use the project's configured LLM (DeepSeek by default) to summarize reports.

    Returns the summary string, or "" on any failure (graceful degradation).
    """
    try:
        # NOTE: 必须用 agent.src.providers 绝对导入，不能用 `from src.providers`。
        # daily_stock_analysis 集成后其自带的 src 包会抢占 sys.path，导致
        # `import src` 解析到 daily_stock_analysis/src（无 providers 子包）→
        # ModuleNotFoundError: No module named 'src.providers'。
        from agent.src.providers.llm import build_llm
        llm = build_llm()
        prompt = (
            f"你是A股投研助手。以下是股票（代码 {code}）近期券商研报的核心信息，"
            "请用中文提炼 3-5 条要点，覆盖：\n"
            "1) 机构一致预期的评级与倾向（增持/买入等）；\n"
            "2) 目标价或估值观点；\n"
            "3) 核心看多或看空逻辑；\n"
            "4) 主要风险。\n"
            "每条一行，简洁客观，严格基于给定信息，不要编造数据。\n\n"
            f"{context}"
        )
        resp = llm.invoke(prompt)
        text = getattr(resp, "content", None)
        if text is None and isinstance(resp, str):
            text = resp
        return (text or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai summarize reports failed for %s: %s", code, exc)
        return ""


@router.get("/stock-reports-summary")
async def get_stock_reports_summary(
    code: str = Query(..., description="Stock code (A-share)"),
    months: int = Query(6, description="Lookback months for reports"),
):
    """AI-generated Chinese summary of a stock's recent research reports.

    Aggregates iWencai abstracts + EastMoney structured highlights, then asks the
    configured LLM (DeepSeek) to condense them into bullet points.
    """
    code = code.strip()
    # ── 检查缓存（同一只股票 24h 内不重复调用 LLM） ──
    cached = _SUMMARY_CACHE.get(code)
    if cached and (time.time() - cached.get("ts", 0)) < _SUMMARY_TTL:
        return {**cached, "ts": time.time(), "cached": True}
    try:
        em_reports = await asyncio.to_thread(_fetch_reports_eastmoney, code, months)
        iw_reports = await asyncio.to_thread(_fetch_reports_iwencai, code, months)
        context = _build_report_context(code, em_reports, iw_reports)
        if not context.strip():
            return {"code": code, "summary": "", "model": "",
                    "ts": time.time(), "error": "暂无研报数据可总结"}
        summary = await asyncio.to_thread(_ai_summarize_reports, code, context)
        model = os.getenv("LANGCHAIN_MODEL_NAME", "")
        if not summary:
            return {"code": code, "summary": "", "model": model,
                    "ts": time.time(), "error": "AI 总结生成失败（模型不可用或未配置）"}
        # 写入缓存（下次同一只股票直接返回，不烧 token）
        _SUMMARY_CACHE[code] = {"code": code, "summary": summary, "model": model, "ts": time.time()}
        return {"code": code, "summary": summary, "model": model, "ts": time.time()}
    except Exception as exc:  # noqa: BLE001
        logger.warning("stock-reports-summary failed for %s: %s", code, exc)
        return {"code": code, "summary": "", "ts": time.time(), "error": str(exc)}
