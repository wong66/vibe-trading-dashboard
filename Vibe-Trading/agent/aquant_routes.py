"""A股量化决策 — 后端 API 路由

四个模块：主线决策 / 交易计划 / 复盘雷达 / 交割单复盘
数据持久化到项目根目录 A股量化决策/ 下的 JSON 文件。

数据源：a-stock-data 七大层（行情/研报/信号/资金/新闻/基础数据/公告）
信号引擎：signal_engine.py — 多因子扫描 + 评分 + 信号生成
市场状态：market_state.py — 温度计 + 风格检测 + 板块热度
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import uuid
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, UploadFile, File, Query, Body
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

# ── 信号引擎 & 市场状态 ──────────────────────────────────────────────
try:
    from .signal_engine import (
        SignalPipeline, get_stock_pool, STOCK_POOLS,
        industry_comparison, daily_dragon_tiger, ths_hot_reason,
    )
    from .signal_margin import margin_trading_overview
    from .portfolio import PortfolioAllocator, PortfolioPlan  # P4 组合定仓风控
    from .market_state import (
        MarketStateEngine, get_style_trend, get_sector_heatmap,
        get_full_market_state, MarketTemperature as MSTemp,
        get_index_quotes, get_northbound_flow, get_market_breadth,
        get_northbound_trend, get_temperature_trend,
    )
    SIGNAL_ENGINE_READY = True
except ImportError:
    SIGNAL_ENGINE_READY = False
    print("[aquant_routes] signal_engine.py 未找到，信号生成将返回示例数据")

# 复盘雷达面板（含策略信号合成）独立导入——不依赖 signal_engine / market_state，
# 避免信号引擎 import 失败连累复盘路由整体不可用。
try:
    from .review_panels import build_review_panels
    REVIEW_PANELS_READY = True
except ImportError:
    REVIEW_PANELS_READY = False
    build_review_panels = None  # type: ignore
    print("[aquant_routes] review_panels 未找到，复盘雷达将不可用")

# ── 数据目录（相对于 Vibe-Trading 项目根） ──────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent  # agent/ → Vibe-Trading/
DATA_DIR = PROJECT_ROOT / "A股量化决策"

SIGNALS_DIR = DATA_DIR / "signals"
PLANS_DIR = DATA_DIR / "plans"
REVIEWS_DIR = DATA_DIR / "reviews"
MATCH_CACHE_DIR = DATA_DIR / "match_cache"

for d in (SIGNALS_DIR, PLANS_DIR, REVIEWS_DIR, MATCH_CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/aquant", tags=["A股量化决策"])


# ============================================================================
# Pydantic Models
# ============================================================================

class SignalFactor(BaseModel):
    pe_ttm: Optional[float] = None          # PE(TTM) 真实倍数
    pe_percentile: Optional[float] = None   # PE历史百分位 (%)
    pb: Optional[float] = None              # PB 真实倍数
    pb_percentile: Optional[float] = None   # PB历史百分位 (%)
    roe: Optional[float] = None            # ROE (%)
    revenue_growth: Optional[float] = None  # 营收同比增速 (%)
    net_profit_growth: Optional[float] = None  # 净利润同比增速 (%)
    gross_margin_change: Optional[float] = None  # 毛利率环比变化 (pp)
    market_cap_yi: Optional[float] = None     # 总市值(亿)
    is_st: Optional[bool] = False             # 是否ST
    # 扩展因子（V2新增）
    main_flow_20d: Optional[float] = None     # 近20日主力净流入(亿)
    dragon_tiger_signal: Optional[int] = None # 龙虎榜信号(1净买/0无/-1净卖)
    ret_20d: Optional[float] = None           # 20日涨跌幅(%)
    vol_ratio: Optional[float] = None         # 量比
    debt_ratio: Optional[float] = None        # 资产负债率(%)
    margin_change_pct: Optional[float] = None # 融资余额环比(%)
    net_margin: Optional[float] = None        # 净利率(%)
    gross_margin: Optional[float] = None      # 毛利率(%)
    # 当日行情（V3新增）
    price: Optional[float] = None             # 最新价
    change_pct: Optional[float] = None        # 当日涨跌幅(%)
    change_amount: Optional[float] = None     # 当日涨跌额


class SignalSectorScore(BaseModel):
    signal_density: float = 0.0     # 板块内信号集中度
    capital_flow: float = 0.0       # 资金流向分数
    leader_effect: float = 0.0      # 龙头带动分数
    total: float = 0.0              # 综合分数


class SignalRecord(BaseModel):
    signal_id: str
    date: str
    stock_code: str
    stock_name: str
    score: float                    # 综合评分
    factors: SignalFactor
    sector: str                     # 所属行业
    sector_score: Optional[SignalSectorScore] = None
    ai_suggestion: Optional[str] = None
    suggested_weight: Optional[float] = None  # 组合建议仓位(%)，P4 定仓风控
    main_line_sector: Optional[str] = None    # 主线板块(P3 择时注入)，供前端聚合展示
    data_coverage: Optional[float] = None     # 有效因子覆盖率(0-100，诚实度指标)


class DailySignalsResponse(BaseModel):
    date: str
    total_signals: int
    signals: List[SignalRecord]


class PlanField(BaseModel):
    buy_range_low: Optional[float] = None   # 买入区间下限
    buy_range_high: Optional[float] = None  # 买入区间上限
    position_pct: Optional[float] = None    # 仓位比例 (%)
    stop_loss_price: Optional[float] = None # 止损价
    target_price: Optional[float] = None    # 目标价
    hold_period: Optional[str] = None       # 持有周期(如"2-4周")
    reason: Optional[str] = None            # 买入理由


class TradePlan(BaseModel):
    trade_id: str
    signal_id: str
    stock_code: str
    stock_name: str
    system_score: Optional[float] = None
    fields: PlanField
    status: str = "未执行"  # 未执行 / 已执行 / 已完成 / 已放弃
    created_at: str
    executed_at: Optional[str] = None
    completed_at: Optional[str] = None


class TradePlanResponse(BaseModel):
    plans: List[TradePlan]


class HitRateStat(BaseModel):
    signal_id: str
    stock_code: str
    score: float
    threshold: float              # 用户设定的命中率阈值
    window_days: int              # 观察窗口(交易日)
    actual_return: Optional[float] = None  # 实际涨幅(%)
    hit: Optional[bool] = None    # 是否命中


class ReviewStats(BaseModel):
    total_signals: int            # 总信号数
    evaluated: int                # 已评估数(过了窗口期)
    hit_count: int                # 命中数
    hit_rate: float               # 命中率 (%)
    avg_return: Optional[float] = None
    by_window: Dict[int, Dict[str, float]] = Field(default_factory=dict)  # 窗口→统计


class MarketTemperature(BaseModel):
    value: int                    # 0-100
    label: str                    # 一句话描述
    style: str                    # 价值 / 成长 / 题材 / 震荡
    capital_flow: str             # 资金流向描述


class SectorHeatRow(BaseModel):
    sector: str
    heat: float                   # 热度分数 0-100
    signal_count: int             # 板块内信号数
    capital_inflow: Optional[float] = None  # 资金流入(亿)
    change_pct: Optional[float] = None      # 板块涨跌幅(%)
    up_count: Optional[int] = None
    down_count: Optional[int] = None
    leader: Optional[str] = None            # 领涨股


class IndustryRankRow(BaseModel):
    """行业板块涨跌排名（东财行业层实时数据）"""
    rank: int
    name: str
    code: str
    change_pct: float
    up_count: int
    down_count: int
    leader: str


class DragonTigerRow(BaseModel):
    """龙虎榜个股（东财 datacenter-web 实时数据）"""
    code: str
    name: str
    reason: str                   # 上榜理由
    change_pct: float
    net_buy_wan: float            # 龙虎榜净买额(万)


class HotThemeItem(BaseModel):
    """同花顺热点题材（信号层实时数据）"""
    theme: str
    count: int                    # 该题材强势股数量
    sample_stocks: List[str] = [] # 代表个股


class MarginOverview(BaseModel):
    """融资融券市场概况（a-stock-data 资金面层）"""
    available: bool = False
    derived: bool = False                   # True=由量化信号派生（实时两融不可达）
    date: Optional[str] = None
    total_rzye_yi: Optional[float] = None   # 融资余额(亿)
    total_rqye_yi: Optional[float] = None   # 融券余额(亿)
    rzmre_yi: Optional[float] = None        # 融资买入(亿)
    rzche_yi: Optional[float] = None        # 融资偿还(亿)
    top_buy: List[Dict[str, Any]] = []      # 融资净买入 TOP


class TempTrendPoint(BaseModel):
    """市场温度趋势真实数据点"""
    date: str
    value: int
    breadth_temp: int
    fund_temp: int
    sentiment_temp: int


class ReviewDashboardResponse(BaseModel):
    temperature: MarketTemperature
    hit_rate: ReviewStats
    sector_heat: List[SectorHeatRow]
    style_trend: List[Dict[str, Any]]     # 过去N天风格得分
    # ── 新增多维数据（a-stock-data 七大层） ──
    industry_rank: List[IndustryRankRow] = []          # 行业涨跌排名
    dragon_tiger: List[DragonTigerRow] = []            # 龙虎榜
    hot_themes: List[HotThemeItem] = []                # 同花顺热点题材
    margin: Optional[MarginOverview] = None            # 融资融券概况
    temp_trend: List[TempTrendPoint] = []              # 真实市场温度趋势
    northbound_trend: List[Dict[str, Any]] = []        # 北向资金历史趋势


class CsvImportResult(BaseModel):
    total_rows: int
    matched: int
    unmatched: int
    samples: List[Dict[str, Any]]


class MatchStats(BaseModel):
    signal_count: int             # 系统推送的信号总数
    adopted_count: int            # 用户实际买入的数量(有匹配到的)
    adoption_rate: float          # 采纳率 (%)
    win_count: int                # 盈利的数量
    loss_count: int               # 亏损的数量
    win_rate: float               # 胜率 (%)


class DeliveryReviewResponse(BaseModel):
    match_stats: MatchStats
    trades: List[Dict[str, Any]]  # 逐笔交易明细


# ============================================================================
# 工具函数
# ============================================================================

def _generate_signal_id(date_str: str) -> str:
    """生成信号ID: SIG-YYYYMMDD-XXXX"""
    suffix = uuid.uuid4().hex[:4].upper()
    return f"SIG-{date_str}-{suffix}"


def _generate_trade_id(date_str: str) -> str:
    """生成交易ID: TRD-YYYYMMDD-XXXX"""
    suffix = uuid.uuid4().hex[:4].upper()
    return f"TRD-{date_str}-{suffix}"


def _list_signal_dates() -> List[str]:
    """列出所有已保存的信号日期"""
    if not SIGNALS_DIR.exists():
        return []
    return sorted([f.stem for f in SIGNALS_DIR.glob("*.json")])


def _get_latest_non_empty_date() -> Optional[str]:
    """获取最近一个有意义的日期。

    规则：最新日期优先——只要它带信号【或】带重构后的 market_state/portfolio，
    就直接用最新日期（这样前端能展示择时总览/组合定仓方案两张新卡片，
    即使今日信号为空也如实呈现，而非回退到旧格式空壳）。
    仅当最新日期两者皆无（旧空壳）时，才回退到更早的有内容日期。
    """
    dates = _list_signal_dates()
    if not dates:
        return None
    latest = dates[-1]
    latest_sigs = _load_signal_date(latest) or []
    latest_meta = _load_signal_meta(latest)
    if latest_sigs or latest_meta.get("market_state") or latest_meta.get("portfolio"):
        return latest
    # 最新日期是旧空壳 → 回退到更早的、带信号或带择时/组合数据的日期
    for d in reversed(dates[:-1]):
        sigs = _load_signal_date(d) or []
        meta = _load_signal_meta(d)
        if sigs or meta.get("market_state") or meta.get("portfolio"):
            return d
    return latest


def _load_signal_date(date_str: str) -> Optional[List[SignalRecord]]:
    """加载某一天的信号"""
    path = SIGNALS_DIR / f"{date_str}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return [SignalRecord(**s) for s in data.get("signals", [])]


def _save_signal_date(date_str: str, signals: List[SignalRecord],
                      market_state: Any = None, portfolio: Any = None) -> str:
    """保存某一天的信号（含市场状态与组合定仓方案，供前端持久化展示）"""
    path = SIGNALS_DIR / f"{date_str}.json"
    payload = {
        "date": date_str,
        "signals": [s.model_dump() for s in signals],
        "market_state": market_state,
        "portfolio": portfolio,
        "generated_at": datetime.now().isoformat(),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def _load_signal_meta(date_str: str) -> Dict[str, Any]:
    """加载某天的市场状态与组合定仓方案（generate 时落盘，供 latest 返回）"""
    path = SIGNALS_DIR / f"{date_str}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "market_state": data.get("market_state"),
        "portfolio": data.get("portfolio"),
    }


def _list_plans() -> List[TradePlan]:
    """列出所有交易计划"""
    plans: List[TradePlan] = []
    if not PLANS_DIR.exists():
        return plans
    for f in sorted(PLANS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if isinstance(data, list):
            plans.extend(TradePlan(**p) for p in data)
        elif isinstance(data, dict):
            plans.append(TradePlan(**data))
    return plans


def _save_plan(plan: TradePlan) -> str:
    """保存单条交易计划"""
    # 按日期分文件
    date_str = datetime.now().strftime("%Y%m%d")
    path = PLANS_DIR / f"{date_str}.json"
    existing: List[dict] = []
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(existing, list):
        existing = [existing] if existing else []
    existing.append(plan.model_dump())
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)


def _update_plan_status(trade_id: str, new_status: str) -> Optional[TradePlan]:
    """更新交易计划状态"""
    for f in sorted(PLANS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            continue
        for i, p in enumerate(data):
            if p.get("trade_id") == trade_id:
                p["status"] = new_status
                if new_status == "已执行":
                    p["executed_at"] = datetime.now().isoformat()
                elif new_status == "已完成":
                    p["completed_at"] = datetime.now().isoformat()
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                return TradePlan(**data[i])
    return None


def _match_delivery_to_signals(trades: List[dict]) -> List[Dict[str, Any]]:
    """将交割单交易与信号自动匹配"""
    results = []
    all_dates = _list_signal_dates()

    for trade in trades:
        code = trade.get("stock_code", "")
        trade_date = trade.get("trade_date", "")

        if not code or not trade_date:
            results.append({**trade, "matched_signal_id": None, "match_method": None})
            continue

        # 从交易日前推3天内找信号
        try:
            td = datetime.strptime(trade_date, "%Y-%m-%d")
        except ValueError:
            results.append({**trade, "matched_signal_id": None, "match_method": None})
            continue

        best_match = None
        best_diff = None

        for date_str in all_dates:
            try:
                sig_date = datetime.strptime(date_str, "%Y%m%d")
            except ValueError:
                continue

            diff = abs((td - sig_date).days)
            if diff > 3:
                continue

            sigs = _load_signal_date(date_str)
            if not sigs:
                continue

            for sig in sigs:
                if sig.stock_code == code or code.lstrip("0") in sig.stock_code or sig.stock_code.lstrip("0") in code:
                    if best_diff is None or diff < best_diff:
                        best_match = sig
                        best_diff = diff

        if best_match:
            results.append({
                **trade,
                "matched_signal_id": best_match.signal_id,
                "match_method": "auto",
                "match_confidence": "high" if best_diff <= 1 else "medium",
            })
        else:
            results.append({**trade, "matched_signal_id": None, "match_method": "unmatched"})

    return results


# ============================================================================
# 主线决策 API
# ============================================================================

@router.get("/signals/dates")
async def list_signal_dates() -> List[str]:
    """列出所有已保存的信号日期"""
    return _list_signal_dates()


@router.get("/signals/latest")
async def get_latest_signals(
    limit: int = Query(10, ge=1, le=200, description="返回信号数量"),
    view_mode: str = Query("score", description="排序模式: score/sector/new/factor"),
    date: Optional[str] = Query(None, description="指定日期, 不传则取最新"),
):
    """获取最新信号列表（自动回退到最近非空日期）"""
    target_date = date or _get_latest_non_empty_date()
    if not target_date:
        return {"date": None, "total_signals": 0, "signals": []}

    # Convert YYYYMMDD -> YYYY-MM-DD for frontend display
    display_date = target_date[:4] + "-" + target_date[4:6] + "-" + target_date[6:8] if len(target_date) == 8 else target_date

    signals = _load_signal_date(target_date)
    if not signals:
        # 即使当日信号为空（数据源降级），也要把重构后的择时/组合数据一并返回，
        # 否则前端两张新卡片（择时总览 / 组合定仓方案）永远不会出现。
        meta = _load_signal_meta(target_date)
        return {
            "date": display_date,
            "total_signals": 0,
            "signals": [],
            "market_state": meta.get("market_state"),
            "portfolio": meta.get("portfolio"),
        }

    # 排序
    if view_mode == "sector":
        sorted_signals = sorted(signals, key=lambda s: (s.sector or "", -s.score))
    elif view_mode == "new":
        # 新信号：这里简化处理，实际应对比前一天
        sorted_signals = sorted(signals, key=lambda s: -s.score)
    elif view_mode == "factor":
        sorted_signals = sorted(signals, key=lambda s: -(s.factors.pe_percentile or 0))
    else:
        sorted_signals = sorted(signals, key=lambda s: -s.score)

    meta = _load_signal_meta(target_date)
    return {
        "date": display_date,
        "total_signals": len(signals),
        "signals": [s.model_dump() for s in sorted_signals[:limit]],
        "market_state": meta.get("market_state"),
        "portfolio": meta.get("portfolio"),
    }


@router.post("/signals/generate")
async def generate_signals(
    force: bool = Query(False, description="强制重新生成"),
    pool: str = Query("watchlist", description="选股池: watchlist/hs300/zz500/custom"),
    top_n: int = Query(20, ge=1, le=100, description="返回信号数"),
) -> Dict[str, Any]:
    """生成今日信号（a-stock-data 实时数据 + 多因子扫描 + 主线市场状态）

    调用 signal_engine.SignalPipeline 执行完整流水线：
      1. 腾讯财经批量行情（PE/PB/市值/换手率）
      2. mootdx 财务快照（ROE/净利率）
      3. 同花顺热点归因（强势股+题材标签）
      4. 新浪历史财报（营收/净利/EPS 同比 → 成长因子）
      5. mootdx 真实日线（动量因子 ret_20d/ret_60d）
      6. market_state 市场状态（温度/风格/主线板块 → 择时 + 权重tilt）
      7. 多因子加权评分 + 主线板块加成 + 排序
    """
    today = datetime.now().strftime("%Y%m%d")

    if not SIGNAL_ENGINE_READY:
        return {
            "status": "warning",
            "date": today,
            "message": "信号引擎未加载，返回示例数据",
            "note": "请确保 signal_engine.py 和 market_state.py 在 agent/ 目录下",
        }

    try:
        # 获取选股池
        stock_pool = get_stock_pool(pool)

        # 执行信号扫描
        pipeline = SignalPipeline(
            pool=stock_pool,
            data_dir=DATA_DIR,
        )
        signals = pipeline.run(date_str=today, top_n=top_n)

        # P4：构建组合定仓方案（纯逻辑，无网络）
        portfolio_plan = pipeline.build_portfolio(signals)

        # 持久化
        signal_records = []
        for sig in signals:
            record = SignalRecord(
                signal_id=sig.signal_id,
                date=sig.date,
                stock_code=sig.stock_code,
                stock_name=sig.stock_name,
                score=sig.score,
                factors=SignalFactor(**sig.factors),
                sector=sig.sector,
                sector_score=SignalSectorScore(**sig.sector_score) if sig.sector_score else None,
                ai_suggestion=sig.ai_suggestion,
                suggested_weight=sig.suggested_weight,
                main_line_sector=sig.main_line_sector,
                data_coverage=sig.data_coverage,
            )
            signal_records.append(record)

        # 主线市场状态总览（供前端展示择时/风格/仓位）
        mstate_out = None
        if pipeline.last_market_state is not None:
            try:
                from dataclasses import asdict
                mstate_out = asdict(pipeline.last_market_state)
            except Exception:
                mstate_out = None

        saved_path = _save_signal_date(
            today, signal_records,
            market_state=mstate_out, portfolio=portfolio_plan.model_dump(),
        )

        return {
            "status": "success",
            "date": today,
            "total_signals": len(signals),
            "pool": pool,
            "pool_size": len(stock_pool),
            "saved_to": saved_path,
            "signals": [s.model_dump() for s in signal_records],
            "market_state": mstate_out,
            "portfolio": portfolio_plan.model_dump(),
            "generated_at": datetime.now().isoformat(),
        }

    except Exception as e:
        traceback.print_exc()
        return {
            "status": "error",
            "date": today,
            "message": f"信号生成失败: {str(e)}",
            "traceback": traceback.format_exc()[:500],
        }


# ═══════════════════════════════════════════════════════════════════════
# 因子库 API
# ═══════════════════════════════════════════════════════════════════════

@router.get("/factors")
async def get_factor_library() -> Dict[str, Any]:
    """获取因子库定义（评分权重 + 因子说明）"""
    try:
        from .signal_engine import DEFAULT_WEIGHTS, FACTOR_DIRECTION
    except ImportError:
        DEFAULT_WEIGHTS = {}
        FACTOR_DIRECTION = {}

    factor_defs = [
        {
            "category": "估值",
            "factors": [
                {"name": "pe_percentile", "label": "PE历史百分位", "direction": "正向",
                 "desc": "PE在历史分位越低，估值越便宜", "weight": DEFAULT_WEIGHTS.get("pe_percentile", 12.5)},
                {"name": "pb_percentile", "label": "PB历史百分位", "direction": "正向",
                 "desc": "PB在历史分位越低，估值越便宜", "weight": DEFAULT_WEIGHTS.get("pb_percentile", 12.5)},
            ],
        },
        {
            "category": "质量",
            "factors": [
                {"name": "roe", "label": "ROE", "direction": "正向",
                 "desc": "净资产收益率，反映盈利能力", "weight": DEFAULT_WEIGHTS.get("roe", 15)},
                {"name": "gross_margin", "label": "毛利率", "direction": "正向",
                 "desc": "毛利/营收，反映产品竞争力", "weight": DEFAULT_WEIGHTS.get("gross_margin", 5)},
                {"name": "net_margin", "label": "净利率", "direction": "正向",
                 "desc": "净利/营收，反映综合盈利能力", "weight": DEFAULT_WEIGHTS.get("net_margin", 5)},
            ],
        },
        {
            "category": "成长",
            "factors": [
                {"name": "revenue_yoy", "label": "营收增速", "direction": "正向",
                 "desc": "营收同比增速，反映业务扩张", "weight": DEFAULT_WEIGHTS.get("revenue_yoy", 10)},
                {"name": "net_profit_yoy", "label": "净利增速", "direction": "正向",
                 "desc": "净利润同比增速", "weight": DEFAULT_WEIGHTS.get("net_profit_yoy", 10)},
                {"name": "eps_cagr_3y", "label": "EPS 3年CAGR", "direction": "正向",
                 "desc": "每股收益3年复合增速", "weight": DEFAULT_WEIGHTS.get("eps_cagr_3y", 5)},
            ],
        },
        {
            "category": "动量",
            "factors": [
                {"name": "ret_20d", "label": "20日涨跌", "direction": "正向",
                 "desc": "近20个交易日涨跌幅", "weight": DEFAULT_WEIGHTS.get("ret_20d", 5)},
                {"name": "ret_60d", "label": "60日涨跌", "direction": "正向",
                 "desc": "近60个交易日涨跌幅", "weight": DEFAULT_WEIGHTS.get("ret_60d", 5)},
                {"name": "price_position", "label": "价格位置", "direction": "反向",
                 "desc": "当前价在60日区间位置，越低越好", "weight": DEFAULT_WEIGHTS.get("price_position", 5)},
            ],
        },
        {
            "category": "资金/情绪",
            "factors": [
                {"name": "main_flow_20d", "label": "主力资金流", "direction": "正向",
                 "desc": "近20日主力净流入(亿)", "weight": DEFAULT_WEIGHTS.get("main_flow_20d", 5)},
                {"name": "dragon_tiger_signal", "label": "龙虎榜信号", "direction": "正向",
                 "desc": "最近龙虎榜净买卖方向", "weight": DEFAULT_WEIGHTS.get("dragon_tiger_signal", 3)},
                {"name": "margin_change_pct", "label": "融资变化", "direction": "正向",
                 "desc": "融资余额环比变化", "weight": DEFAULT_WEIGHTS.get("margin_change_pct", 2)},
            ],
        },
    ]
    return {
        "total_categories": len(factor_defs),
        "total_factors": sum(len(c["factors"]) for c in factor_defs),
        "categories": factor_defs,
        "data_sources": {
            "行情": "腾讯财经(PE/PB/市值/换手率) + mootdx(K线)",
            "财务": "通达信mootdx财务快照(ROE/净利/营收)",
            "资金": "东财push2/push2his(主力资金流) + 同花顺hsgtApi(北向)",
            "情绪": "同花顺热点(强势股归因) + 东财龙虎榜 + 东财融资融券",
            "行业": "东财行业板块排名",
        },
    }


# ═══════════════════════════════════════════════════════════════════════
# 选股池 API
# ═══════════════════════════════════════════════════════════════════════

@router.get("/pool")
async def list_stock_pools() -> Dict[str, Any]:
    """列出可用选股池"""
    pools = {
        "watchlist": {
            "name": "默认关注",
            "count": len(STOCK_POOLS.get("watchlist", [])),
            "stocks": STOCK_POOLS.get("watchlist", []),
            "editable": True,
        },
    }
    return {"pools": pools}


@router.post("/pool/{pool_name}")
async def update_stock_pool(
    pool_name: str,
    stocks: List[str],
    action: str = Query("set", description="set=替换 add=追加 remove=移除"),
) -> Dict[str, Any]:
    """更新选股池（watchlist/custom）"""
    if pool_name not in STOCK_POOLS:
        STOCK_POOLS[pool_name] = []

    if action == "set":
        STOCK_POOLS[pool_name] = stocks
    elif action == "add":
        for s in stocks:
            if s not in STOCK_POOLS[pool_name]:
                STOCK_POOLS[pool_name].append(s)
    elif action == "remove":
        STOCK_POOLS[pool_name] = [s for s in STOCK_POOLS[pool_name] if s not in stocks]

    return {
        "status": "ok",
        "pool": pool_name,
        "count": len(STOCK_POOLS[pool_name]),
        "stocks": STOCK_POOLS[pool_name],
    }


# ============================================================================
# 交易计划 API
# ============================================================================

@router.get("/plans")
async def list_plans() -> TradePlanResponse:
    """获取所有交易计划"""
    return TradePlanResponse(plans=_list_plans())


@router.post("/plans")
async def create_plan(plan: TradePlan) -> TradePlan:
    """创建交易计划"""
    _save_plan(plan)
    return plan


@router.patch("/plans/{trade_id}")
async def update_plan(trade_id: str, status: str = Query(..., description="新状态")) -> Optional[TradePlan]:
    """更新交易计划状态"""
    return _update_plan_status(trade_id, status)


@router.delete("/plans/{trade_id}")
async def delete_plan(trade_id: str) -> Dict[str, str]:
    """删除交易计划"""
    for f in sorted(PLANS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            continue
        before = len(data)
        data = [p for p in data if p.get("trade_id") != trade_id]
        if len(data) < before:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"status": "deleted"}
    return {"status": "not_found"}


# ============================================================================
# 复盘雷达 API
# ============================================================================

@router.get("/review/dashboard")
async def get_review_dashboard(
    date: str = Query(None, description="日期 YYYY-MM-DD，默认今天"),
    force_refresh: int = Query(0, description="设为 1 时强制重新调用 LLM 刷新 AI 分析（消耗 token），默认走缓存"),
) -> Dict[str, Any]:
    """复盘雷达 — 4 面板（行业轮动 / 题材归因 / 涨停归因 / 涨停打板）

    数据全部来自 a-stock-data：
      - 行业轮动：industry_comparison（东财行业涨跌）+ 板块资金流 f62/f184
      - 题材归因：ths_hot_reason（同花顺 getharden 涨停/强势股题材标签）
      - 涨停归因：getharden + 近 N 日连板推导（几天几板）
      - 涨停打板：涨停家数 + 最高连板 + 炸板率（估算）
    """
    from fastapi.concurrency import run_in_threadpool

    if build_review_panels is None:
        return {
            "date": date or datetime.now().strftime("%Y-%m-%d"),
            "error": "复盘雷达模块（review_panels）未能加载",
            "sector_rotation": {"available": False, "top_gain": [], "capital_inflow": [], "total_industries": 0},
            "theme_attribution": {"available": False, "themes": [], "stocks": [], "note": ""},
            "limitup_attribution": {"available": False, "stocks": [], "theme_summary": [], "max_board": 0},
            "limitup_board": {"available": False, "limitup_count": 0, "max_board": 0, "blast_count": None, "blast_rate": None, "board_ladder": [], "note": ""},
            "market_sentiment": {},
            "short_term_emotion": {},
        }

    try:
        result = await run_in_threadpool(build_review_panels, date, bool(force_refresh))
        # 追加 VS 每日复盘同款：市场情绪 + 短线情绪（涨停/跌停/封板率/炸板率/晋级率）
        from .review_sentiment import get_market_sentiment, get_short_term_emotion
        result["market_sentiment"] = get_market_sentiment()
        try:
            result["short_term_emotion"] = get_short_term_emotion()
        except Exception:
            result["short_term_emotion"] = {}
        return result
    except Exception as e:  # 兜底：绝不给假数据
        return {
            "date": date or datetime.now().strftime("%Y-%m-%d"),
            "error": f"复盘数据装配失败: {e}",
            "sector_rotation": {"available": False, "top_gain": [], "capital_inflow": [], "total_industries": 0},
            "theme_attribution": {"available": False, "themes": [], "stocks": [], "note": ""},
            "limitup_attribution": {"available": False, "stocks": [], "theme_summary": [], "max_board": 0},
            "limitup_board": {"available": False, "limitup_count": 0, "max_board": 0, "blast_count": None, "blast_rate": None, "board_ladder": [], "note": ""},
            "market_sentiment": {},
            "short_term_emotion": {},
        }


def _compute_hit_rate(
    signals: List[SignalRecord],
    threshold: float,
    window_days: int,
):
    """计算信号命中率（基于窗口期真实后验收益）

    对每个历史信号，用 mootdx 真实日线取「信号日收盘价」与「信号日 + window_days
    交易日后收盘价」的区间收益，>= threshold 记为命中。

    无法获取真实行情（网络/缓存缺失）的信号，actual_return / hit 诚实置 None，
    绝不编造后验收益。返回 (ReviewStats 汇总, List[HitRateStat])。
    """
    import pandas as pd
    from datetime import datetime as _dt
    from .signal_engine import fetch_daily_bars

    empty = ReviewStats(
        total_signals=len(signals), evaluated=0, hit_count=0, hit_rate=0.0,
    )
    if not signals:
        return empty, []

    # 按 code 聚合，批量拉真实日线（a-stock-data：mootdx 通道）
    by_code: Dict[str, List[SignalRecord]] = {}
    for sig in signals:
        by_code.setdefault(sig.stock_code, []).append(sig)

    evaluated = 0
    hit_count = 0
    returns = []
    stats: List[HitRateStat] = []

    for code, sigs in by_code.items():
        # 观察窗口：[最早信号日, 最晚信号日 + window_days 留足交易日余量]
        sdates = []
        for s in sigs:
            try:
                sdates.append(_dt.strptime(s.date, "%Y-%m-%d"))
            except Exception:
                continue
        if not sdates:
            continue
        end_s = (max(sdates) + timedelta(days=window_days * 2 + 10)).strftime("%Y-%m-%d")

        # a-stock-data 日线（mootdx，不封IP）；失败则本 code 全部诚实降级
        df = fetch_daily_bars(code, start=None, end=end_s)
        if df is None or df.empty:
            print(f"[hit-rate] {code} 日线不可用，诚实降级")

        for s in sigs:
            actual = None
            try:
                sd = _dt.strptime(s.date, "%Y-%m-%d")
            except Exception:
                sd = None
            if df is not None and not df.empty and sd is not None:
                sub = df.loc[df.index >= pd.Timestamp(sd)]
                if not sub.empty:
                    entry_close = float(sub["close"].iloc[0])
                    exit_pos = min(window_days, len(sub) - 1)
                    exit_close = float(sub["close"].iloc[exit_pos])
                    if entry_close:
                        actual = (exit_close / entry_close - 1) * 100
            hit = (actual >= threshold) if actual is not None else None
            stats.append(HitRateStat(
                signal_id=s.signal_id,
                stock_code=s.stock_code,
                score=s.score,
                threshold=threshold,
                window_days=window_days,
                actual_return=round(actual, 2) if actual is not None else None,
                hit=hit,
            ))
            if actual is not None:
                evaluated += 1
                returns.append(actual)
                if actual >= threshold:
                    hit_count += 1

    hit_rate = (hit_count / evaluated * 100) if evaluated else 0.0
    avg_return = (sum(returns) / len(returns)) if returns else None
    review = ReviewStats(
        total_signals=len(signals),
        evaluated=evaluated,
        hit_count=hit_count,
        hit_rate=round(hit_rate, 1),
        avg_return=round(avg_return, 2) if avg_return is not None else None,
        by_window={window_days: {"hit_rate": round(hit_rate, 1), "evaluated": evaluated}},
    )
    return review, stats


def _extract_hot_themes() -> List[HotThemeItem]:
    """从同花顺热点数据中提取题材标签云"""
    import re
    df = ths_hot_reason()
    if df is None or df.empty:
        return []
    # 同花顺返回字段可能不同，兼容常见列
    theme_col = None
    for c in ("reason", "theme", "typename", "诱因", "题材"):
        if c in df.columns:
            theme_col = c
            break
    if theme_col is None:
        # 没有题材列，尝试从任意文本列抽取
        text_cols = [c for c in df.columns if df[c].dtype == object]
        if not text_cols:
            return []
        theme_col = text_cols[0]

    theme_map: Dict[str, List[str]] = {}
    for _, row in df.iterrows():
        raw = str(row.get(theme_col, ""))
        # 提取中文题材关键词（去标点到空格）
        parts = re.split(r"[、，,；;/\s]+", raw)
        for p in parts:
            p = p.strip()
            if not p or len(p) > 12:
                continue
            stocks = theme_map.setdefault(p, [])
            name = row.get("name") or row.get("stock_name") or ""
            if name and name not in stocks:
                stocks.append(name)
            if len(stocks) >= 5:
                break

    items = [
        HotThemeItem(theme=t, count=len(s), sample_stocks=s[:5])
        for t, s in theme_map.items()
        if t
    ]
    items.sort(key=lambda x: -x.count)
    return items[:20]


def _fallback_sector_heat(signals: List[SignalRecord]) -> List[SectorHeatRow]:
    """兜底：从信号数据计算板块热度"""
    sector_map: Dict[str, Dict[str, Any]] = {}
    for sig in signals:
        sec = sig.sector or "未知"
        if sec not in sector_map:
            sector_map[sec] = {"count": 0, "total_score": 0.0}
        sector_map[sec]["count"] += 1
        sector_map[sec]["total_score"] += sig.score

    rows = []
    for sec, info in sorted(sector_map.items(), key=lambda x: -x[1]["total_score"]):
        rows.append(SectorHeatRow(
            sector=sec,
            heat=min(info["count"] * 20 + info["total_score"] / max(info["count"], 1), 100),
            signal_count=info["count"],
        ))
    return rows


def _fallback_industry_rank(signals: List[SignalRecord]) -> List[IndustryRankRow]:
    """兜底：从真实信号评分按行业聚合出涨跌排名（东财行业层实时不可达时使用）

    信号文件缺少 ret_20d 等行情因子时，用板块内信号平均评分派生行业涨跌幅，
    使排名与真实信号强度正相关（页面标注"信号派生"保持透明）。
    """
    from collections import defaultdict
    agg = defaultdict(lambda: {"count": 0, "score_sum": 0.0,
                               "leader": None, "leader_score": -1.0})
    for sig in signals:
        sec = sig.sector or "未知"
        a = agg[sec]
        a["count"] += 1
        a["score_sum"] += sig.score
        if sig.score > a["leader_score"]:
            a["leader_score"] = sig.score
            a["leader"] = sig.stock_name
    rows = []
    for sec, a in agg.items():
        avg = a["score_sum"] / max(1, a["count"])
        chg = round((avg - 80) * 0.8, 2)  # 评分派生行业涨跌幅(%)
        rows.append(IndustryRankRow(
            rank=0,
            name=sec,
            code="",
            change_pct=chg,
            up_count=1 if chg > 0 else 0,
            down_count=0 if chg > 0 else 1,
            leader=a["leader"] or "",
        ))
    rows.sort(key=lambda x: -x.change_pct)
    for i, r in enumerate(rows, 1):
        r.rank = i
    return rows


def _fallback_dragon_tiger(signals: List[SignalRecord]) -> List[DragonTigerRow]:
    """兜底：从真实信号挑选高分股作为量化精选强势股（龙虎榜实时不可达时使用）

    涨跌幅/净买额由信号评分派生（与真实信号强度正相关），页面标注"量化信号精选"。
    """
    ranked = sorted(signals, key=lambda s: -s.score)[:12]
    rows = []
    for sig in ranked:
        f = sig.factors
        dt = f.dragon_tiger_signal
        if dt == 1:
            reason = "龙虎榜净买入 · 量化信号精选"
        elif dt == -1:
            reason = "龙虎榜净卖出 · 量化信号精选"
        else:
            reason = f"量化信号精选 · {sig.sector}"
        chg = round((sig.score - 80) * 0.8, 2)
        net_wan = round((sig.score - 80) * 500)  # 主力净流入(万) 派生
        rows.append(DragonTigerRow(
            code=sig.stock_code,
            name=sig.stock_name,
            reason=reason,
            change_pct=chg,
            net_buy_wan=net_wan,
        ))
    return rows


def _fallback_margin(signals: List[SignalRecord]) -> MarginOverview:
    """兜底：从真实信号评分派生融资净买入 TOP（两融实时不可达时使用）

    评分>80 的标的按 (评分-80) 派生融资净买入额(亿)，与信号强度正相关。
    """
    ranked = sorted(
        [s for s in signals if s.score > 80],
        key=lambda s: -s.score,
    )[:8]
    top_buy = []
    for sig in ranked:
        top_buy.append({
            "code": sig.stock_code,
            "name": sig.stock_name,
            "date": sig.date,
            "rzye_yi": None,
            "net_buy_yi": round((sig.score - 80) * 0.3, 2),  # 评分派生融资净买入(亿)
        })
    return MarginOverview(
        available=True,
        derived=True,
        date=None,
        total_rzye_yi=None,
        total_rqye_yi=None,
        rzmre_yi=None,
        rzche_yi=None,
        top_buy=top_buy,
    )


# ═══════════════════════════════════════════════════════════════════════
# 市场状态独立 API
# ═══════════════════════════════════════════════════════════════════════

@router.get("/market/temperature")
async def get_market_temperature() -> Dict[str, Any]:
    """获取实时市场温度（独立端点，含分维度）"""
    try:
        mkt = get_full_market_state()
        return {
            "status": "success",
            "temperature": {
                "value": mkt.value,
                "label": mkt.label,
                "style": mkt.style,
                "capital_flow": mkt.capital_flow,
                "breadth_temp": mkt.breadth_temp,
                "fund_temp": mkt.fund_temp,
                "sentiment_temp": mkt.sentiment_temp,
                # 完整明细：前端 MarketDashboard 直接消费
                "indexes": mkt.indexes,
                "breadth": mkt.breadth,
                "northbound": mkt.northbound,
            },
            "sector_heat": mkt.sector_heat,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/market/sectors")
async def get_sector_heatmap() -> Dict[str, Any]:
    """获取板块热力图"""
    try:
        heatmap = get_sector_heatmap()
        return {
            "status": "success",
            "total_sectors": len(heatmap),
            "sectors": heatmap,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/review/hit-rate")
async def get_hit_rate(
    threshold: float = Query(5.0, description="命中率阈值(%)"),
    window_days: int = Query(5, description="观察窗口(交易日)"),
) -> Dict[str, Any]:
    """获取信号命中率明细（基于 a-stock-data 真实日线后验收益）"""
    all_dates = _list_signal_dates()
    stats: List[HitRateStat] = []
    all_signals: List[SignalRecord] = []

    for date_str in all_dates:
        signals = _load_signal_date(date_str)
        if not signals:
            continue
        all_signals.extend(signals)

    # 用真实日线计算后验收益，拿不到行情的信号 actual_return/hit 诚实置 None
    _, computed = _compute_hit_rate(all_signals, threshold, window_days)
    stats.extend(computed)

    return {
        "threshold": threshold,
        "window_days": window_days,
        "evaluated": sum(1 for s in stats if s.actual_return is not None),
        "stats": [s.model_dump() for s in stats],
    }


# ============================================================================
# P5 回测验证闭环 API（真实命中率反哺因子权重）
# ============================================================================

@router.post("/backtest/optimize")
async def post_backtest_optimize(body: Optional[Dict[str, Any]] = Body(None)) -> Dict[str, Any]:
    """回测验证闭环：用 a-stock-data 真实日线算因子 IC，反哺因子权重并持久化。

    下一轮信号扫描自动加载反哺后的权重（自我修正）。
    离线/无真实行情时诚实返回 error，绝不编造 IC。
    """
    from .backtest.factor_backtest import run_backtest, load_weights
    try:
        body = body or {}
        pool = body.get("pool") or STOCK_POOLS["watchlist"]
        windows = tuple(body.get("windows") or (5, 10, 20))
        as_of_dates = body.get("as_of_dates") or [datetime.now().strftime("%Y%m%d")]
        base = load_weights()  # 以当前生效权重为底，多次反哺更平滑
        result = await run_in_threadpool(run_backtest, pool, as_of_dates, windows, base, True)
        if not result.get("ok"):
            return {"status": "error", "message": result.get("error"), "samples": result.get("samples", 0)}
        return {"status": "success", **result}
    except Exception as e:
        return {"status": "error", "message": f"回测失败: {e}"}


@router.get("/backtest/weights")
async def get_backtest_weights() -> Dict[str, Any]:
    """查看当前生效的因子权重（默认或回测反哺）与最近一次 IC 摘要。"""
    from .signal_engine import DEFAULT_WEIGHTS, FACTOR_DIRECTION
    from .backtest.factor_backtest import load_weights, WEIGHTS_CACHE
    effective = load_weights() or DEFAULT_WEIGHTS
    last_ic = None
    generated_at = None
    if WEIGHTS_CACHE.exists():
        try:
            d = json.loads(WEIGHTS_CACHE.read_text(encoding="utf-8"))
            last_ic = d.get("meta", {}).get("ic")
            generated_at = d.get("generated_at")
        except Exception:
            pass
    return {
        "status": "success",
        "source": "backtest" if load_weights() else "default",
        "effective_weights": effective,
        "default_weights": DEFAULT_WEIGHTS,
        "direction": FACTOR_DIRECTION,
        "last_ic": last_ic,
        "generated_at": generated_at,
    }


# ============================================================================
# 交割单复盘 API
# ============================================================================

@router.post("/delivery/import")
async def import_delivery_csv(file: UploadFile = File(...)) -> Dict[str, Any]:
    """导入券商交割单CSV文件"""
    content = await file.read()
    text = content.decode("gbk", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    # 标准化字段名
    trades = []
    for row in rows:
        trade = {}
        for k, v in row.items():
            k_norm = k.strip().lower()
            if "代码" in k or "stock" in k_norm or "code" in k_norm:
                trade["stock_code"] = v.strip()
            elif "日期" in k or "date" in k_norm or "交易日期" in k:
                trade["trade_date"] = v.strip()
            elif "价格" in k or "price" in k_norm or "成交价" in k:
                trade["price"] = float(v) if v else 0
            elif "数量" in k or "qty" in k_norm or "volume" in k:
                trade["qty"] = int(float(v)) if v else 0
            elif "方向" in k or "side" in k_norm or "买卖" in k:
                trade["side"] = v.strip()
            elif "金额" in k or "amount" in k_norm or "成交金额" in k:
                trade["amount"] = float(v) if v else 0
            elif "股票" in k or "name" in k_norm or "证券" in k:
                trade["stock_name"] = v.strip()
            else:
                trade[k_norm] = v
        trades.append(trade)

    # 自动匹配信号
    matched = _match_delivery_to_signals(trades)

    matched_count = sum(1 for t in matched if t.get("matched_signal_id"))
    return {
        "total_rows": len(trades),
        "matched": matched_count,
        "unmatched": len(trades) - matched_count,
        "trades": matched,
    }


@router.get("/delivery/stats")
async def get_delivery_stats() -> Dict[str, Any]:
    """获取交割单统计（采纳率 + 胜率）"""
    all_dates = _list_signal_dates()
    total_signals = 0
    for d in all_dates:
        sigs = _load_signal_date(d)
        if sigs:
            total_signals += len(sigs)

    # 从 plans 中统计已执行的计划
    plans = _list_plans()
    executed = [p for p in plans if p.status in ("已执行", "已完成")]

    adoption_rate = (len(executed) / total_signals * 100) if total_signals > 0 else 0

    return {
        "signal_count": total_signals,
        "adopted_count": len(executed),
        "adoption_rate": round(adoption_rate, 1),
        "note": "胜率需要交割单实际盈亏数据，请导入CSV后计算",
    }
