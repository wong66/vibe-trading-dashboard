"""A股量化决策 — 信号引擎

基于 a-stock-data 通道（mootdx / 腾讯 / 同花顺 / 新浪），实现多因子扫描、综合评分、信号生成。
数据源优先级：mootdx > 腾讯财经 > 同花顺 > 新浪；龙虎榜/资金流/行业排名 a-stock-data 无源则诚实降级，无任何东财依赖。

架构：
  StockPool        → 选股池管理（沪深300/中证500/自定义）
  FactorCalculator → 因子计算器（5大类 20+因子）
  SignalScorer     → 评分聚合器（权重/排名/板块修正）
  SignalPipeline   → 信号流水线（日扫描 → 评分 → 排序 → 持久化）
"""

from __future__ import annotations

import json
import math
import time
import urllib.request
import concurrent.futures
import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests
from pydantic import BaseModel
from .portfolio import PortfolioAllocator, PortfolioPlan  # P4 组合定仓风控

# ── 选股池（代表性样本，非完整指数成分；custom 由前端动态写入） ──
STOCK_POOLS = {
    "watchlist": [
        "600519", "000858", "000568", "600779",
        "300750", "002594", "601012", "600900", "600905",
        "600276", "603259", "300760", "000661", "600196",
        "601318", "600036", "600030", "601166", "000001",
        "000333", "000651", "600887", "603288", "002714", "600690",
        "002415", "688981", "603501", "000725", "002230", "603986",
        "600028", "601857", "600309",
    ],
    "hs300": [
        "600519", "000858", "300750", "601318", "600036", "600276",
        "000333", "600887", "002415", "601012", "600900", "603259",
        "600030", "000651", "002594", "600309", "601166", "000001",
        "603288", "600690",
    ],
    "zz500": [
        "000568", "600779", "300760", "000661", "600196", "688981",
        "603501", "000725", "002230", "603986", "600905", "601857",
        "600028", "002714",
    ],
    "custom": [],
}

# ── a-stock-data 依赖 ──────────────────────────────────────────────────
# 按需 import mootdx（TCP 行情），不阻塞非行情功能
try:
    from mootdx.quotes import Quotes
    MOOTDX_AVAILABLE = True
except ImportError:
    MOOTDX_AVAILABLE = False

# ── 数据层：统一走 DataProvider（a-stock-data 通道优先，东财仅缓存兜底） ──
from .data_provider import (  # noqa: E402
    UA, _get_prefix, em_get, eastmoney_datacenter,
    MOOTDX_AVAILABLE,
    tencent_batch_quote, mootdx_finance_snapshot, stock_fund_flow_120d,
    fetch_daily_bars, industry_comparison, ths_hot_reason,
    daily_dragon_tiger, margin_trading, financial_statements,
    get_provider, DataProvider,
)

@dataclass
class FactorResult:
    """单只股票的因子计算结果"""
    code: str
    name: str
    pe_ttm: float = 0
    pe_percentile: float = 50          # PE在自身历史中的百分位
    pb: float = 0
    pb_percentile: float = 50
    ps: Optional[float] = None                      # 市销率 — 暂无真实数据源(P2接入)
    roe: Optional[float] = None                     # ROE (%) — mootdx 财务快照
    gross_margin: Optional[float] = None            # 毛利率 (%) — 新浪季度财报补充(否则 None)
    net_margin: Optional[float] = None              # 净利率 (%) — mootdx 快照或新浪季度财报
    debt_ratio: Optional[float] = None              # 资产负债率 (%) — 暂无真实数据源(P2接入)
    revenue_yoy: Optional[float] = None             # 营收同比 (%) — 新浪利润表年报序列同比
    net_profit_yoy: Optional[float] = None          # 净利同比 (%) — 新浪利润表年报序列同比
    deducted_profit_yoy: Optional[float] = None      # 扣非净利同比 (%) — 新浪利润表 TTM 滚动
    eps_cagr_3y: Optional[float] = None             # EPS 3年复合增速 (%) — 新浪利润表 eps 序列
    ret_20d: Optional[float] = None                 # 20日涨跌幅 (%)
    ret_60d: Optional[float] = None                 # 60日涨跌幅 (%)
    price_position: Optional[float] = None          # 股价在60日区间的位置 (%)
    vol_ratio: float = 1.0             # 量比
    main_flow_20d: float = 0           # 近20日主力净流入(亿)
    northbound_ratio: float = 0        # 北向持仓占比变化(近似)
    dragon_tiger_signal: int = 0       # 龙虎榜信号(1=净买/0=未上榜/-1=净卖)
    margin_change_pct: Optional[float] = None       # 融资余额环比变化 (%) — 暂无真实数据源(P2接入)
    market_cap_yi: float = 0           # 总市值(亿)
    sector: str = ""                   # 行业
    is_st: bool = False
    data_coverage: float = 0.0         # 有效因子权重覆盖率(0-1)，诚实度指标


def _run_async_coro(coro):
    """跨上下文安全执行协程。

    问题背景：SignalPipeline.run() 在 FastAPI 的 async 端点中被调用，
    此时已有一个 running event loop；若在同步代码里直接 asyncio.run()
    会抛 'asyncio.run() cannot be called from a running event loop'，
    导致全部财务因子抓取静默失败（ROE/营收/毛利/PE 全丢）。

    处理：无运行中 loop 时走 asyncio.run()；已有运行中 loop 时在独立
    线程里跑 asyncio.run()，避免嵌套事件循环冲突。
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(lambda: asyncio.run(coro)).result()


class FactorCalculator:
    """因子计算器 — 基于 a-stock-data 数据源计算多维度因子"""

    @staticmethod
    def compute_from_tencent(code: str, quote: dict, sector: str = "") -> FactorResult:
        """从腾讯行情数据计算基础因子"""
        name = quote.get("name", "")
        pe = quote.get("pe_ttm", 0)
        pb = quote.get("pb", 0)
        price = quote.get("price", 0)
        mcap = quote.get("mcap_yi", 0)

        pe_pct = 0
        if pe > 0:
            if pe <= 10:
                pe_pct = 90 + (10 - pe) / 5  # 5-10 → 90-100
            elif pe <= 30:
                pe_pct = 50 + (30 - pe) / 20 * 40  # 10-30 → 50-90
            elif pe <= 100:
                pe_pct = 10 + (100 - pe) / 70 * 40  # 30-100 → 10-50
            else:
                pe_pct = max(0, 10 - (pe - 100) / 10)
            pe_pct = max(0, min(100, pe_pct))

        pb_pct = 0
        if pb > 0:
            if pb <= 1:
                pb_pct = 90 + (1 - pb) * 10
            elif pb <= 5:
                pb_pct = 50 + (5 - pb) / 4 * 40
            elif pb <= 20:
                pb_pct = 10 + (20 - pb) / 15 * 40
            else:
                pb_pct = max(0, 10 - (pb - 20) / 5)
            pb_pct = max(0, min(100, pb_pct))

        ps = 0
        if pe > 0 and price > 0:
            ps = -1  # 标记为数据缺失

        return FactorResult(
            code=code, name=name,
            pe_ttm=pe, pe_percentile=round(pe_pct, 1),
            pb=pb, pb_percentile=round(pb_pct, 1),
            ps=ps,
            market_cap_yi=mcap,
            vol_ratio=quote.get("vol_ratio", 1.0),
            sector=sector,
        )

    @staticmethod
    def enrich_with_finance(result: FactorResult, fin_data: dict) -> FactorResult:
        """用通达信财务快照补充质量/成长因子（保留兼容，主通道已迁移到 fundamentals 管线）"""
        if not fin_data:
            return result
        roe = fin_data.get("roe")
        if roe is not None:
            result.roe = round(float(roe), 1)
        profit = fin_data.get("profit")
        income = fin_data.get("income")
        if income is not None and profit is not None and float(income) > 0 and float(profit) > 0:
            result.net_margin = round(float(profit) / float(income) * 100, 1)

        return result

    @staticmethod
    def enrich_from_fundamentals_pipeline(result: FactorResult, code: str) -> FactorResult:
        """复用个股看板(fundamentals.py)的财务管线取 ROE/毛利率/净利率/营收增速/净利增速。

        数据源：新浪 JSON API（a-stock-data 标准端点，与 StockBoard /stock-fundamentals 同源）。
        计算逻辑：三表原始科目 → (营收-成本)/营收=毛利率, 净利/营收=净利率,
                  净利/净资产=ROE, TTM滚动4季度同比=营收/净利增速。
        覆盖率：金融股(银行/保险)无营业成本→毛利率=None(正确), 其余指标均有值。
        """
        import asyncio
        try:
            from .fundamentals import (
                _fetch_a_fundamentals_sina,
                _build_fundamentals_from_statements,
                _build_ttm_yoy,
                _apply_ttm_margins,
            )
        except ImportError as e:
            print(f"[signal] fundamentals 模块导入失败 {code}: {e}")
            return result

        try:
            stmts = _run_async_coro(_fetch_a_fundamentals_sina(code, num_periods=8))
        except Exception as e:
            print(f"[signal] fundamentals fetch 失败 {code}: {e}")
            return result

        if not stmts or not stmts.get("lrb"):
            return result

        try:
            periods = _build_fundamentals_from_statements(
                stmts["lrb"], stmts["fzb"], stmts["llb"]
            )
            periods = _build_ttm_yoy(periods)
            periods = _apply_ttm_margins(periods)
        except Exception as e:
            print(f"[signal] fundamentals build 失败 {code}: {e}")
            return result

        if not periods:
            return result

        p = periods[0]  # 最新一期

        # ROE（TTM）
        if p.get("roe") is not None and p["roe"] != 0:
            result.roe = round(p["roe"], 1)

        # 毛利率（TTM）：金融股无营业成本 → gross_margin≈100% → 视为 None
        gm = p.get("gross_margin")
        if gm is not None and 0 < gm < 98:
            result.gross_margin = round(gm, 1)
        # gm ≥ 98 或 gm ≤ 0: 金融股无COGS或异常值，保持 None（前端显示 N/A·金融）

        # 净利率（TTM）
        nm = p.get("net_margin")
        if nm is not None and nm != 0:
            result.net_margin = round(nm, 1)

        # 营收/净利增速
        # 金融股（银行/保险/券商，毛利率≈100% 或缺失）改用新浪原始年报累计同比：
        # 新浪单季数据在 2024 旧季度存在脏值（约半值），TTM 滚动窗口会放大成失真的高增速；
        # 年报为全年累计，新浪源干净，逐年同比最可靠。
        gm_val = p.get("gross_margin")
        is_financial = gm_val is None or (gm_val or 0) >= 95
        if is_financial:
            annual_rows = [r for r in stmts.get("lrb", [])
                           if str(r.get("period", "")).endswith("-12-31")]
            annual_rows.sort(key=lambda r: str(r.get("period", "")), reverse=True)
            if len(annual_rows) >= 2:
                def _f(r, *keys):
                    for k in keys:
                        v = r.get(k)
                        try:
                            return float(v)
                        except (TypeError, ValueError):
                            continue
                    return None
                rev0, rev1 = (_f(annual_rows[0], "营业总收入", "营业收入"),
                              _f(annual_rows[1], "营业总收入", "营业收入"))
                if rev0 and rev1:
                    result.revenue_yoy = round((rev0 / rev1 - 1) * 100, 1)
                np0 = _f(annual_rows[0], "归属于母公司所有者的净利润", "净利润")
                np1 = _f(annual_rows[1], "归属于母公司所有者的净利润", "净利润")
                if np0 and np1:
                    result.net_profit_yoy = round((np0 / np1 - 1) * 100, 1)
        else:
            # 非金融股：保留 TTM 滚动同比
            rev_yoy = p.get("revenue_yoy")
            if rev_yoy is not None:
                result.revenue_yoy = round(rev_yoy, 1)
            np_yoy = p.get("net_profit_yoy")
            if np_yoy is not None:
                result.net_profit_yoy = round(np_yoy, 1)

        # 扣非净利增速（TTM 同比 %，仅非金融股有意义）
        ded_yoy = p.get("deducted_profit_yoy")
        if ded_yoy is not None:
            result.deducted_profit_yoy = round(ded_yoy, 1)

        # PE(TTM)：腾讯行情 pe_ttm 常返回 0/0.01，用 市值/TTM净利润 补算
        if not result.pe_ttm or result.pe_ttm < 1:
            ttm = p.get("ttm") or {}
            ttm_np = ttm.get("net_profit")  # TTM净利润(亿)
            mcap = result.market_cap_yi      # 市值(亿)
            if ttm_np and mcap and ttm_np > 0:
                result.pe_ttm = round(mcap / ttm_np, 2)

        # 用修正后的 pe_ttm 重算百分位
        if result.pe_ttm and result.pe_ttm > 0:
            pe = result.pe_ttm
            if pe <= 10:
                pe_pct = 90 + (10 - pe) / 5
            elif pe <= 30:
                pe_pct = 50 + (30 - pe) / 20 * 40
            elif pe <= 100:
                pe_pct = 10 + (100 - pe) / 70 * 40
            else:
                pe_pct = max(0, 10 - (pe - 100) / 10)
            result.pe_percentile = round(max(0, min(100, pe_pct)), 1)

        return result

    @staticmethod
    def enrich_with_fund_flow(result: FactorResult, flow_data: list, fallback_pe: float = 0) -> FactorResult:
        """用资金流数据补充动量/情绪因子。无数据时置 None（不参与评分），避免全0导致归一化退化"""
        if not flow_data:
            result.main_flow_20d = None
            return result

        recent = flow_data[-20:] if len(flow_data) >= 20 else flow_data
        total_main = sum(d["main_net"] for d in recent)
        result.main_flow_20d = round(total_main / 1e8, 2)  # 转换为亿

        # 注意：ret_20d / ret_60d / price_position 必须由真实K线计算（见 enrich_with_momentum），

        return result

    @staticmethod
    def enrich_with_momentum(result: FactorResult, code: str) -> FactorResult:
        """拿不到真实K线时三个因子保持 None（诚实），绝不编造涨跌幅。 """

        df = fetch_daily_bars(code, start=None, end=None, max_bars=120)
        if df is None or df.empty or "close" not in df.columns:
            return result
        closes = df["close"].astype(float)
        n = len(closes)
        if n < 2:
            return result
        last = float(closes.iloc[-1])
        if n >= 21:
            base = float(closes.iloc[-21])
            if base:
                result.ret_20d = round((last / base - 1) * 100, 2)
        if n >= 61:
            base = float(closes.iloc[-61])
            if base:
                result.ret_60d = round((last / base - 1) * 100, 2)
            win = closes.iloc[-61:]
        else:
            win = closes
        lo, hi = float(win.min()), float(win.max())
        if hi > lo:
            result.price_position = round((last - lo) / (hi - lo) * 100, 1)
        try:
            vols = df["vol"].astype(float)
            if len(vols) >= 6:
                today_vol = float(vols.iloc[-1])
                avg5 = float(vols.iloc[-6:-1].mean())
                if avg5 > 0:
                    result.vol_ratio = round(today_vol / avg5, 2)
        except Exception:
            pass
        return result

    @staticmethod
    def enrich_with_growth(result: FactorResult, code: str) -> FactorResult:
        """revenue_yoy / net_profit_yoy 取最近两年年报同比；eps_cagr_3y 取近3年年报复合增速。 """

        stmt = financial_statements(code, "profit")
        if not stmt or not stmt.get("dates"):
            return result
        rev = stmt.get("total_revenue") or []
        npf = stmt.get("net_profit") or []
        eps = stmt.get("eps") or []

        def _yoy(series):
            if len(series) >= 2 and series[0] is not None and series[1] is not None and series[1] != 0:
                return (series[0] / series[1] - 1) * 100
            return None

        ry = _yoy(rev)
        ny = _yoy(npf)
        if ry is not None:
            result.revenue_yoy = round(ry, 1)
        if ny is not None:
            result.net_profit_yoy = round(ny, 1)
        if len(eps) >= 3 and eps[0] is not None and eps[2] is not None and eps[2] > 0 and eps[0] > 0:
            result.eps_cagr_3y = round(((eps[0] / eps[2]) ** (1 / 3) - 1) * 100, 1)
        return result

    @staticmethod
    def enrich_with_sentiment(result: FactorResult,
                               dragon_tiger_list: List[dict] = None,
                               hot_stocks: pd.DataFrame = None) -> FactorResult:
        """龙虎榜(dragon_tiger_list) 现已恒空（a-stock-data 无真实源，东财已移除）， """

        if dragon_tiger_list:
            for dt in dragon_tiger_list:
                if dt.get("code") == result.code:
                    net = dt.get("net_buy_wan", 0)
                    result.dragon_tiger_signal = 1 if net > 0 else -1
                    break

        if hot_stocks is not None and not hot_stocks.empty:
            match = hot_stocks[hot_stocks["code"] == result.code]
            if not match.empty and result.dragon_tiger_signal == 0:
                result.dragon_tiger_signal = 1

        return result

DEFAULT_WEIGHTS = {
    "pe_percentile": 12.5,
    "pb_percentile": 12.5,
    "roe": 15.0,
    "gross_margin": 5.0,
    "net_margin": 5.0,
    "revenue_yoy": 10.0,
    "net_profit_yoy": 10.0,
    "eps_cagr_3y": 5.0,
    "ret_20d": 5.0,
    "ret_60d": 5.0,
    "price_position": 5.0,
    "main_flow_20d": 5.0,
    "dragon_tiger_signal": 3.0,
    "margin_change_pct": 2.0,
}

FACTOR_DIRECTION = {
    "pe_percentile": 1,       # PE百分位越低越好 → 转化后分数越高
    "pb_percentile": 1,       # PB百分位越低越好
    "roe": 1,
    "gross_margin": 1,
    "net_margin": 1,
    "revenue_yoy": 1,
    "net_profit_yoy": 1,
    "eps_cagr_3y": 1,
    "ret_20d": 1,            # 动量：涨得好是正向信号
    "ret_60d": 1,
    "price_position": -1,    # 价格位置越低越好（不在高位）
    "main_flow_20d": 1,
    "dragon_tiger_signal": 1,
    "margin_change_pct": 1,
}

class SignalScorer:
    """评分聚合器 — 多因子加权 + 归一化 + 板块修正"""

    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or DEFAULT_WEIGHTS.copy()
        self.total_config_weight = sum(self.weights.values())
        total = self.total_config_weight
        if total != 100:
            self.weights = {k: v / total * 100 for k, v in self.weights.items()}
            self.total_config_weight = 100.0

    def normalize_factor(self, factor_name: str, value: float,
                          all_values: List[float]) -> float:
        """将因子值归一化到 0-100 分数 """

        if not all_values or all(v == 0 for v in all_values):
            return 50

        valid = [(i, v) for i, v in enumerate(all_values) if v is not None]
        if len(valid) < 2:
            return 50

        direction = FACTOR_DIRECTION.get(factor_name, 1)
        sorted_vals = sorted(valid, key=lambda x: x[1])
        rank = sum(1 for _, v in sorted_vals if v < value)
        percentile = rank / len(sorted_vals) * 100

        if direction == -1:
            percentile = 100 - percentile

        return round(percentile, 1)

    def score_single(self, factor: FactorResult,
                      factor_pools: Dict[str, List[float]],
                      sector_boost: float = 0) -> float:
        """对单只股票打分 """

        total_score = 0.0
        total_weight = 0.0
        effective_weight_sum = 0.0

        factor_values = {
            "pe_percentile": factor.pe_percentile,
            "pb_percentile": factor.pb_percentile,
            "roe": factor.roe,
            "gross_margin": factor.gross_margin,
            "net_margin": factor.net_margin,
            "revenue_yoy": factor.revenue_yoy,
            "net_profit_yoy": factor.net_profit_yoy,
            "eps_cagr_3y": factor.eps_cagr_3y,
            "ret_20d": factor.ret_20d,
            "ret_60d": factor.ret_60d,
            "price_position": factor.price_position,
            "main_flow_20d": factor.main_flow_20d,
            "dragon_tiger_signal": factor.dragon_tiger_signal,
            "margin_change_pct": factor.margin_change_pct,
        }

        for fname, weight in self.weights.items():
            if weight == 0:
                continue
            val = factor_values.get(fname)
            if val is None:
                continue

            pool = factor_pools.get(fname, [])
            normed = self.normalize_factor(fname, val, pool)
            total_score += normed * weight / 100
            total_weight += weight
            effective_weight_sum += weight

        coverage = round(effective_weight_sum / self.total_config_weight, 3) if self.total_config_weight else 0.0
        factor.data_coverage = coverage

        if total_weight == 0:
            return 0.0

        raw = total_score / total_weight * 100
        raw += sector_boost
        return round(min(100, max(0, raw)), 1)

class SignalOutput(BaseModel):
    """最终信号输出（pydantic，可直接 model_dump 序列化给前端 API）"""
    signal_id: str
    date: str
    stock_code: str
    stock_name: str
    score: float
    factors: Dict[str, Any]
    sector: str
    sector_score: Dict[str, float]
    ai_suggestion: str
    data_coverage: float = 0.0        # 有效因子权重覆盖率(诚实度)
    # ── P3 主线市场状态（择时 / 风格 / 仓位 / 主线板块） ──
    market_temp: Optional[int] = None        # 市场温度 0-100
    market_style: Optional[str] = None       # 价值/成长/题材/防御/震荡
    position_cap: Optional[int] = None       # 建议仓位上限(%)
    main_line_sector: Optional[str] = None   # 主线板块（数据降级时为 None）
    suggested_weight: Optional[float] = None  # 组合层面建议仓位(%)（P4 定仓风控回填）

class SignalPipeline:
    """信号流水线：日扫描 → 因子计算 → 评分 → 排序 → 输出"""

    def __init__(self, pool: List[str] = None,
                 weights: Dict[str, float] = None,
                 data_dir: Path = None):
        if weights is None:
            try:
                from .backtest.factor_backtest import load_weights
                loaded = load_weights()
                if loaded:
                    weights = loaded
            except Exception:
                pass
        self.pool = pool or STOCK_POOLS["watchlist"]
        self.base_weights = weights  # P3：风格 tilt 的基权重（可来自回测反哺）
        self.scorer = SignalScorer(weights)
        self.calculator = FactorCalculator()
        self.provider = get_provider()  # 统一数据层（a-stock-data 通道优先）
        self.data_dir = data_dir or Path(__file__).resolve().parent.parent / "A股量化决策"
        self.last_market_state = None  # P3：run() 结束时填充，供 API 层读取总览

    # ── P3：主线市场状态（择时 / 风格 tilt / 主线板块） ──────────────
    @staticmethod
    def _position_cap(temp: int) -> int:
        """市场温度 → 建议仓位上限(%)（越低越防御）"""
        if temp >= 70:
            return 90
        if temp >= 50:
            return 80
        if temp >= 30:
            return 60
        if temp >= 10:
            return 40
        return 20

    @staticmethod
    def _tilt_weights(style: str, base: Dict[str, float]) -> Dict[str, float]:
        """风格 → 因子权重 tilt（在基权重上做相对调整，始终归一化到 100）"""
        w = dict(base)
        if style in ("价值", "防御"):
            w["pe_percentile"] = w.get("pe_percentile", 0) * 1.3
            w["pb_percentile"] = w.get("pb_percentile", 0) * 1.3
            w["roe"] = w.get("roe", 0) * 1.2
            w["net_margin"] = w.get("net_margin", 0) * 1.2
            w["ret_20d"] = w.get("ret_20d", 0) * 0.7
            w["ret_60d"] = w.get("ret_60d", 0) * 0.7
        elif style == "成长":
            w["revenue_yoy"] = w.get("revenue_yoy", 0) * 1.4
            w["net_profit_yoy"] = w.get("net_profit_yoy", 0) * 1.4
            w["eps_cagr_3y"] = w.get("eps_cagr_3y", 0) * 1.3
            w["ret_20d"] = w.get("ret_20d", 0) * 1.3
            w["ret_60d"] = w.get("ret_60d", 0) * 1.3
        elif style == "题材":
            w["ret_20d"] = w.get("ret_20d", 0) * 1.4
            w["ret_60d"] = w.get("ret_60d", 0) * 1.4
            w["dragon_tiger_signal"] = w.get("dragon_tiger_signal", 0) * 1.5
            w["main_flow_20d"] = w.get("main_flow_20d", 0) * 1.3
        total = sum(w.values())
        if total:
            w = {k: v / total * 100 for k, v in w.items()}
        return w

    @staticmethod
    def _main_line_sectors(mstate: Any) -> List[str]:
        """从 market_state 提取主线板块；板块数据降级（东财移除）时返回空"""
        if mstate is None:
            return []
        heat = getattr(mstate, "sector_heat", None) or []
        if not heat:
            return []
        return [h.get("sector") for h in heat[:3] if h.get("sector")]

    def run(self, date_str: str = None, top_n: int = 20) -> List[SignalOutput]:
        """执行一次完整的信号扫描 """

        if date_str is None:
            date_str = datetime.now().strftime("%Y%m%d")
        display_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

        print(f"[SignalPipeline] 开始扫描 {len(self.pool)} 只股票...")

        # ── Step 0: 市场状态（主线择时 + 风格 + 板块主线） ──
        try:
            from .market_state import get_full_market_state
            mstate = get_full_market_state()
            temp = int(mstate.value)
            style = mstate.style
        except Exception as e:
            print(f"[SignalPipeline] 市场状态获取失败，诚实降级: {e}")
            mstate = None
            temp = 50
            style = "震荡"
        self.last_market_state = mstate
        position_cap = self._position_cap(temp)
        main_lines = self._main_line_sectors(mstate)
        print(f"  市场状态: 温度={temp} 风格={style} 仓位上限={position_cap}% "
              f"主线板块={main_lines or '无(数据降级)'}")
        self.scorer = SignalScorer(self._tilt_weights(style, self.base_weights or DEFAULT_WEIGHTS))

        # ── Step 1: 数据采集 ──
        quotes = tencent_batch_quote(self.pool)
        print(f"  腾讯行情: 获取 {len(quotes)} 只")

        industries = industry_comparison()
        sector_ranks = {}
        for i, ind in enumerate(industries):
            sector_ranks[ind["name"]] = {
                "rank": i + 1,
                "change_pct": ind["change_pct"],
                "up_count": ind["up_count"],
                "down_count": ind["down_count"],
            }
        print(f"  行业板块: {len(industries)} 个")

        hot_df = ths_hot_reason(display_date)
        hot_codes = set()
        if not hot_df.empty and "code" in hot_df.columns:
            hot_codes = set(hot_df["code"].astype(str).tolist())
        print(f"  同花顺热点: {len(hot_codes)} 只强势股")

        dt_data = daily_dragon_tiger(display_date)
        print(f"  龙虎榜: {len(dt_data)} 条记录")

        # ── Step 2: 逐股因子计算 ──
        factor_results: List[FactorResult] = []
        for code in self.pool:
            q = quotes.get(code)
            if not q:
                continue

            sector = self._infer_sector(code, q.get("name", ""))
            fr = self.calculator.compute_from_tencent(code, q, sector)

            if "ST" in q.get("name", "").upper() or "*ST" in q.get("name", ""):
                fr.is_st = True

            # ── 财务因子：复用个股看板 fundamentals 管线（与 /stock-fundamentals 同源） ──
            fr = self.calculator.enrich_from_fundamentals_pipeline(fr, code)

            flow_120 = stock_fund_flow_120d(code)
            fr = self.calculator.enrich_with_fund_flow(fr, flow_120)

            fr = self.calculator.enrich_with_sentiment(fr, dt_data, hot_df)

            factor_results.append(fr)

        print(f"  因子计算: {len(factor_results)} 只完成")

        # ── Step 3: 构建因子池（全市场分布，用于归一化） ──
        factor_pools = defaultdict(list)
        for fr in factor_results:
            factor_pools["pe_percentile"].append(fr.pe_percentile)
            factor_pools["pb_percentile"].append(fr.pb_percentile)
            factor_pools["roe"].append(fr.roe)
            factor_pools["gross_margin"].append(fr.gross_margin)
            factor_pools["net_margin"].append(fr.net_margin)
            factor_pools["revenue_yoy"].append(fr.revenue_yoy)
            factor_pools["net_profit_yoy"].append(fr.net_profit_yoy)
            factor_pools["eps_cagr_3y"].append(fr.eps_cagr_3y)
            factor_pools["ret_20d"].append(fr.ret_20d)
            factor_pools["ret_60d"].append(fr.ret_60d)
            factor_pools["price_position"].append(fr.price_position)
            factor_pools["main_flow_20d"].append(fr.main_flow_20d)
            factor_pools["dragon_tiger_signal"].append(fr.dragon_tiger_signal)
            factor_pools["margin_change_pct"].append(fr.margin_change_pct)

        # ── Step 4: 评分排序 ──
        scored = []
        for fr in factor_results:
            if fr.is_st:
                continue  # ST股不参与排名

            sec_info = sector_ranks.get(fr.sector, {})
            sec_rank = sec_info.get("rank", 50)
            sec_change = sec_info.get("change_pct", 0)
            sector_boost = max(0, (100 - sec_rank) / 100 * 5 + (sec_change > 0) * 3)
            sector_boost = min(8, sector_boost)
            if main_lines and fr.sector in main_lines:
                sector_boost = min(10, sector_boost + 5)

            score = self.scorer.score_single(fr, dict(factor_pools), sector_boost)

            sector_score = {
                "signal_density": 0,  # 稍后计算
                "capital_flow": 0,
                "leader_effect": 0,
                "total": 0,
            }
            secline = sec_info or {}
            sector_score["capital_flow"] = round(max(0, sec_change + 50), 1)
            sector_score["total"] = round(
                (sector_score["capital_flow"] + sector_score.get("leader_effect", 50)) / 2, 1
            )

            scored.append((fr, score, sector_score, sector_boost))

        scored.sort(key=lambda x: -x[1])

        # ── Step 5: 板块信号密度计算 ──
        sector_counts = defaultdict(lambda: {"count": 0, "total_score": 0})
        for fr, score, _, _ in scored:
            sec = fr.sector or "未知"
            sector_counts[sec]["count"] += 1
            sector_counts[sec]["total_score"] += score

        max_density = max(s["count"] for s in sector_counts.values()) if sector_counts else 1

        for i in range(len(scored)):
            fr, score, sec_score, _ = scored[i]
            sec = fr.sector or "未知"
            density = sector_counts[sec]["count"] / max_density * 100
            sec_score["signal_density"] = round(density, 1)
            sec_score["leader_effect"] = round(
                score / max(1, sector_counts[sec]["total_score"] / sector_counts[sec]["count"]) * 50, 1
            )
            sec_score["total"] = round(
                (sec_score["signal_density"] + sec_score["capital_flow"] + sec_score["leader_effect"]) / 3, 1
            )
            scored[i] = (fr, score, sec_score, 0)

        # ── Step 6: 生成信号输出 ──
        import uuid
        signals = []
        for fr, score, sec_score, _ in scored[:top_n]:
            sig_id = f"SIG-{date_str}-{uuid.uuid4().hex[:4].upper()}"

            suggestion = self._generate_suggestion(fr, score, temp, style, position_cap)

            q = quotes.get(fr.code, {})
            price = q.get("price", 0)
            last_close = q.get("last_close", 0)
            change_pct = q.get("change_pct", 0)
            change_amount = price - last_close if price and last_close else 0

            signals.append(SignalOutput(
                signal_id=sig_id,
                date=display_date,
                stock_code=f"{fr.code}.{'SH' if fr.code.startswith(('6','9')) else 'SZ'}",
                stock_name=fr.name,
                score=score,
                factors={
                    "pe_ttm": fr.pe_ttm,
                    "pe_percentile": fr.pe_percentile,
                    "pb": fr.pb,
                    "pb_percentile": fr.pb_percentile,
                    "roe": fr.roe,
                    "revenue_growth": fr.revenue_yoy,
                    "net_profit_growth": fr.net_profit_yoy,
                    "gross_margin_change": None,  # 需要环比数据(P2)
                    "gross_margin": fr.gross_margin,   # 毛利率(%) — 新浪季度财报
                    "net_margin": fr.net_margin,       # 净利率(%) — 新浪季度财报
                    "deducted_profit_growth": fr.deducted_profit_yoy,  # 扣非净利同比(%)
                    "market_cap_yi": fr.market_cap_yi,
                    "is_st": fr.is_st,
                    "main_flow_20d": fr.main_flow_20d,
                    "dragon_tiger_signal": fr.dragon_tiger_signal,
                    "ret_20d": fr.ret_20d,
                    "vol_ratio": fr.vol_ratio,
                    "price": round(price, 2),
                    "change_pct": round(change_pct, 2),
                    "change_amount": round(change_amount, 2),
                },
                sector=fr.sector,
                sector_score={
                    "signal_density": sec_score["signal_density"],
                    "capital_flow": sec_score["capital_flow"],
                    "leader_effect": sec_score["leader_effect"],
                    "total": sec_score["total"],
                },
                ai_suggestion=suggestion,
                data_coverage=fr.data_coverage,
                market_temp=temp,
                market_style=style,
                position_cap=position_cap,
                main_line_sector=", ".join(main_lines) if main_lines else None,
            ))

        print(f"[SignalPipeline] 完成！生成 {len(signals)} 条信号")
        return signals

    # ── P4：组合定仓风控（在评分信号之上做仓位分配 + 风控约束） ──
    def build_portfolio(self, signals: List[SignalOutput]) -> "PortfolioPlan":
        """根据 run() 输出的信号列表构建组合定仓方案（纯逻辑，无网络）"""
        if not signals:
            return PortfolioPlan(total_position=60, allocated_position=0.0,
                                 max_holdings=10,
                                 generated_at=datetime.now().isoformat(timespec="seconds"))
        position_cap = signals[0].position_cap or 60
        ml_str = signals[0].main_line_sector or ""
        main_lines = [s.strip() for s in ml_str.split(",") if s.strip()]
        plan = PortfolioAllocator().allocate(signals, position_cap, main_lines)
        wmap = {p.stock_code: p.weight for p in plan.suggested_positions}
        for sig in signals:
            sig.suggested_weight = wmap.get(sig.stock_code)
        return plan

    # ── P5：回测验证闭环（真实命中率反哺权重） ──
    def backtest_optimize(self, as_of_dates: List[str] = None,
                          windows=(5, 10, 20)) -> Dict:
        """Args: """

        from .backtest.factor_backtest import run_backtest
        if as_of_dates is None:
            as_of_dates = [datetime.now().strftime("%Y%m%d")]
        return run_backtest(
            self.pool, as_of_dates, windows,
            base=self.base_weights or DEFAULT_WEIGHTS,
        )

    def _infer_sector(self, code: str, name: str) -> str:
        """从股票名称推断行业（覆盖沪深300主流成分股，申万一级行业分类）"""
        sector_map = {
            # ── 白酒 ──
            "贵州茅台": "白酒", "五粮液": "白酒", "泸州老窖": "白酒", "山西汾酒": "白酒",
            "洋河股份": "白酒", "古井贡酒": "白酒", "今世缘": "白酒",
            # ── 新能源汽车 / 锂电池 ──
            "宁德时代": "锂电池", "比亚迪": "新能源汽车", "亿纬锂能": "锂电池",
            "赣锋锂业": "锂矿", "天齐锂业": "锂矿",
            # ── 光伏 ──
            "隆基绿能": "光伏", "通威股份": "光伏", "阳光电源": "光伏",
            "TCL中环": "光伏", "晶澳科技": "光伏",
            # ── 半导体 / 芯片 ──
            "中芯国际": "半导体", "北方华创": "半导体设备", "韦尔股份": "半导体",
            "海光信息": "芯片", "兆易创新": "半导体", "紫光国微": "半导体",
            "长电科技": "封测", "闻泰科技": "半导体", "卓胜微": "半导体",
            "华润微": "半导体", "斯达半导": "功率半导体", "中微公司": "半导体设备",
            # ── 消费电子 ──
            "工业富联": "消费电子", "立讯精密": "消费电子", "歌尔股份": "消费电子",
            "蓝思科技": "消费电子", "京东方A": "面板", "TCL科技": "面板",
            # ── 医药 / CXO / 医疗器械 ──
            "药明康德": "CXO", "恒瑞医药": "化学制药", "迈瑞医疗": "医疗器械",
            "智飞生物": "疫苗", "百济神州": "创新药", "联影医疗": "医疗器械",
            "爱美客": "医美", "复星医药": "综合医药", "爱尔眼科": "医疗服务",
            "片仔癀": "中药", "云南白药": "中药", "同仁堂": "中药",
            "华东医药": "化学制药", "人福医药": "化学制药",
            # ── 非银金融 ──
            "中国平安": "保险", "中国太保": "保险", "新华保险": "保险",
            "中信证券": "券商", "东方财富": "券商", "华泰证券": "券商",
            "招商证券": "券商", "国泰君安": "券商", "海通证券": "券商",
            # ── 银行 ──
            "招商银行": "银行", "兴业银行": "银行", "平安银行": "银行",
            "工商银行": "银行", "建设银行": "银行", "农业银行": "银行",
            "中国银行": "银行", "交通银行": "银行", "邮储银行": "银行",
            "民生银行": "银行", "浦发银行": "银行", "江苏银行": "银行",
            # ── 家电 ──
            "美的集团": "家电", "格力电器": "家电", "海尔智家": "家电",
            "海信家电": "家电",
            # ── 食品饮料 ──
            "伊利股份": "乳品", "海天味业": "调味品", "牧原股份": "养殖",
            "双汇发展": "肉制品", "涪陵榨菜": "调味品",
            # ── 房地产 ──
            "万科A": "地产", "保利发展": "地产", "中国海外发展": "地产",
            # ── 建筑 / 基建 ──
            "中国建筑": "建筑", "中国中铁": "基建", "中国交建": "基建",
            # ── 电力 / 公用事业 ──
            "长江电力": "电力", "中国核电": "电力", "三峡能源": "新能源发电",
            "中国神华": "煤炭", "中国石油": "石油石化", "中国石化": "石油石化",
            # ── 化工 / 新材料 ──
            "万华化学": "化工新材料", "恩捷股份": "锂电材料", "荣盛石化": "石化",
            "华鲁恒升": "化工", "龙佰集团": "钛白粉",
            # ── 工业 / 制造 ──
            "汇川技术": "工业自动化", "绿的谐波": "机器人",
            "三一重工": "工程机械", "中联重科": "工程机械",
            "宁德时代": "锂电池",  # duplicate key handled by last-write
            # ── 计算机 / 软件 / AI ──
            "科大讯飞": "人工智能", "中科曙光": "算力", "金山办公": "软件",
            "用友网络": "软件", "宝信软件": "软件", "海康威视": "安防",
            "大华股份": "安防", "德赛西威": "汽车电子", "寒武纪": "AI芯片",
            # ── 通信 ──
            "中兴通讯": "通信设备", "中国移动": "通信运营", "中国电信": "通信运营",
            "中国联通": "通信运营",
            # ── 汽车 ──
            "长城汽车": "汽车整车", "长安汽车": "汽车整车",
            "德赛西威": "汽车电子",  # already mapped above
            # ── 有色金属 ──
            "紫金矿业": "有色金属", "洛阳钼业": "有色金属",
            # ── 钢铁 ──
            "宝钢股份": "钢铁",
            # ── 交通运输 ──
            "顺丰控股": "物流", "上海机场": "航空机场",
            # ── 机械 ──
            "先导智能": "锂电设备", "迈为股份": "光伏设备",
        }
        return sector_map.get(name, "其他")

    def _generate_suggestion(self, fr: FactorResult, score: float,
                             temp: int = None, style: str = None,
                             position_cap: int = None) -> str:
        """基于因子 + 市场状态生成 AI 建议文本"""
        parts = []

        if score >= 85:
            parts.append("综合评分优秀")
        elif score >= 70:
            parts.append("综合评分良好")
        elif score >= 55:
            parts.append("综合评分一般")
        else:
            parts.append("综合评分偏低")

        if fr.pe_percentile is not None:
            if fr.pe_percentile >= 80:
                parts.append("估值处于历史低位")
            elif fr.pe_percentile <= 20:
                parts.append("估值偏高")

        if fr.roe is not None:
            if fr.roe >= 20:
                parts.append("ROE优秀")
            elif fr.roe >= 10:
                parts.append("ROE良好")

        if fr.revenue_yoy is not None:
            if fr.revenue_yoy >= 30:
                parts.append("营收高速增长")
            elif fr.revenue_yoy >= 15:
                parts.append("营收稳健增长")

        if fr.main_flow_20d is not None and fr.main_flow_20d > 1:
            parts.append("主力资金持续流入")
        elif fr.main_flow_20d is not None and fr.main_flow_20d < -1:
            parts.append("主力资金流出")

        if fr.dragon_tiger_signal == 1:
            parts.append("热点资金关注")
        elif fr.dragon_tiger_signal == -1:
            parts.append("资金关注度低")

        base = "，".join(parts[:4])
        if temp is not None:
            pos = f"仓位上限{position_cap}%" if position_cap is not None else ""
            base += f"；市场温度{temp}°（{style or '震荡'}风格·{pos}）"
        return base + "。"

def run_daily_scan(pool: List[str] = None, top_n: int = 20) -> List[SignalOutput]:
    """执行每日信号扫描（便捷入口）"""
    pipeline = SignalPipeline(pool=pool)
    return pipeline.run(top_n=top_n)

def get_stock_pool(pool_name: str = "watchlist") -> List[str]:
    """获取选股池"""
    return STOCK_POOLS.get(pool_name, STOCK_POOLS["watchlist"])

if __name__ == "__main__":
    print("=" * 60)
    print("A股量化决策 — 信号引擎自测")
    print("=" * 60)

    pipeline = SignalPipeline(pool=["600519", "000858", "002594"])
    signals = pipeline.run(top_n=10)

    print(f"\n生成 {len(signals)} 条信号:\n")
    for sig in signals:
        print(f"  {sig.stock_name}({sig.stock_code}) — 评分: {sig.score}")
        print(f"    板块: {sig.sector}  板块分: {sig.sector_score['total']}")
        print(f"    建议: {sig.ai_suggestion}")
        print(f"    因子: PE%={sig.factors['pe_percentile']} "
              f"ROE={sig.factors['roe']} 营收+{sig.factors['revenue_growth']}%")
        print()
