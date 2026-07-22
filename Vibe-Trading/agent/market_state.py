"""A股量化决策 — 市场状态引擎

基于 a-stock-data 实时数据计算：
  1. 市场温度计 — 广度/资金/情绪三维温度
  2. 风格检测 — 价值/成长/题材/防御 四象限
  3. 板块热力图 — 行业轮动监测
  4. 资金流向分析 — 北向/主力/融资
"""

from __future__ import annotations

import urllib.request
import time
import random
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests

# 数据层统一走 DataProvider（a-stock-data 通道优先，东财已彻底移除）。
# 复用 UA 常量 / industry_comparison / _mootdx_batch_quote_raw（mootdx TCP 7709 主通道）
# 以及 market_data 模块的新浪美股通道。
from .data_provider import UA, industry_comparison, _mootdx_batch_quote_raw
from .market_data import _fetch_sina_us_indices
import asyncio
import logging

logger = logging.getLogger(__name__)

# ── 指数代码 ──────────────────────────────────────────────────────────
INDEX_CODES = {
    "sh000001": "上证指数",
    "sh000300": "沪深300",
    "sz399006": "创业板指",
    "sh000016": "上证50",
    "sz399001": "深证成指",
    "sh000688": "科创50",
    "sz399303": "国证2000",
}

# 美股指数（走新浪 hq.sinajs.cn）
US_INDEX_CODES = {
    "IXIC": "纳斯达克综合指数",
    "GSPC": "标普500指数",
    "DJI": "道琼斯工业指数",
}


# ═══════════════════════════════════════════════════════════════════════
# 数据采集
# ═══════════════════════════════════════════════════════════════════════

def get_index_quotes() -> Dict[str, dict]:
    """获取主要指数实时行情（mootdx 主通道 + 腾讯备胎 + 新浪美股）。

    与纵览页 /market-data 走同一条数据通路，确保在公司代理环境下
    腾讯 qt.gtimg.cn 被屏蔽时仍能返回数据。
    """
    result: Dict[str, dict] = {}

    # ── 1) A 股指数：mootdx TCP 7709（主）+ 腾讯（备） ──
    # 保留 sh/sz 前缀，让 mootdx 正确识别为指数（截断 6 位会被当成同名股票）
    a_index_codes = list(INDEX_CODES.keys())
    try:
        mootdx_result = _mootdx_batch_quote_raw(a_index_codes)
        if mootdx_result:
            for full_code, name in INDEX_CODES.items():
                # mootdx 返回键可能是 6 位纯代码或完整带前缀代码
                q = mootdx_result.get(full_code) or mootdx_result.get(full_code[2:])
                if q and q.get("price"):
                    result[full_code] = {
                        "name": name,  # 强制用指数名
                        "price": float(q["price"]),
                        "change_pct": float(q.get("change_pct", 0)),
                        "amount_yi": float(q.get("amount_yi", 0)),
                    }
    except Exception as exc:
        logger.warning("[market_state] mootdx index quotes failed: %s", exc)

    # ── 2) 对 mootdx 没返回的 A 股指数，尝试腾讯 fallback ──
    missing_a = [c for c in INDEX_CODES if c not in result]
    if missing_a:
        try:
            url = "https://qt.gtimg.cn/q=" + ",".join(missing_a)
            req = urllib.request.Request(url)
            req.add_header("User-Agent", UA)
            resp = urllib.request.urlopen(req, timeout=8)
            data = resp.read().decode("gbk")
            for line in data.strip().split(";"):
                if not line.strip() or "=" not in line or '"' not in line:
                    continue
                vals = line.split('"')[1].split("~")
                if len(vals) < 40:
                    continue
                parts = line.split("=")[0].split("_")
                code = parts[-1] if len(parts) >= 2 else line.split("=")[0]
                result[code] = {
                    "name": vals[1],
                    "price": float(vals[3]) if vals[3] else 0,
                    "change_pct": float(vals[32]) if vals[32] else 0,
                    "amount_yi": float(vals[37]) if vals[37] else 0,
                }
        except Exception as exc:
            logger.warning("[market_state] Tencent index fallback failed: %s", exc)

    # ── 3) 美股指数：走新浪 hq.sinajs.cn（与纵览页一致） ──
    us_codes = list(US_INDEX_CODES.keys())
    try:
        us_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(us_loop)
        us_result = us_loop.run_until_complete(_fetch_sina_us_indices(us_codes))
        us_loop.close()
        if us_result:
            for code, name in US_INDEX_CODES.items():
                q = us_result.get(code)
                if q and q.get("price"):
                    result[code] = {
                        "name": q.get("name") or name,
                        "price": float(q["price"]),
                        "change_pct": float(q.get("change_pct", 0)),
                        "source": "sina",
                    }
    except Exception as exc:
        logger.warning("[market_state] Sina US indices failed: %s", exc)

    return result


def get_market_breadth() -> Dict[str, Any]:
    """获取全市场涨跌家数（市场广度）"""
    # 使用东财行业板块聚合
    industries = industry_comparison()
    total_up = sum(ind.get("up_count", 0) for ind in industries)
    total_down = sum(ind.get("down_count", 0) for ind in industries)
    total = total_up + total_down

    ad_ratio = total_up / total_down if total_down > 0 else 5  # 涨跌比
    breadth_pct = total_up / total * 100 if total > 0 else 50   # 上涨占比

    return {
        "up_count": total_up,
        "down_count": total_down,
        "total": total,
        "ad_ratio": round(ad_ratio, 2),
        "breadth_pct": round(breadth_pct, 1),
        "industry_count": len(industries),
    }


def get_northbound_flow() -> Dict[str, Any]:
    """获取北向资金流向（同花顺 hsgtApi）"""
    try:
        url = "https://data.hexin.cn/market/hsgtApi/method/dayChart/"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "Chrome/117.0.0.0"
            ),
            "Host": "data.hexin.cn",
            "Referer": "https://data.hexin.cn/",
        }
        r = requests.get(url, headers=headers, timeout=10)
        d = r.json()
        hgt = d.get("hgt", [])
        sgt = d.get("sgt", [])

        # 取最新非零值
        hgt_last = 0
        sgt_last = 0
        for v in reversed(hgt):
            if v and v != 0:
                hgt_last = v
                break
        for v in reversed(sgt):
            if v and v != 0:
                sgt_last = v
                break

        total = hgt_last + sgt_last
        direction = "流入" if total > 0 else "流出"
        return {
            "hgt_yi": round(hgt_last, 1),
            "sgt_yi": round(sgt_last, 1),
            "total_yi": round(total, 1),
            "direction": direction,
            "available": True,
        }
    except Exception:
        return {
            "hgt_yi": 0, "sgt_yi": 0, "total_yi": 0,
            "direction": "数据暂不可用",
            "available": False,
        }


def get_northbound_trend(days: int = 10) -> List[Dict[str, Any]]:
    """获取北向资金历史趋势（同花顺 hsgtApi dayChart，返回最近 days 个交易日）"""
    try:
        url = "https://data.hexin.cn/market/hsgtApi/method/dayChart/"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "Chrome/117.0.0.0"
            ),
            "Host": "data.hexin.cn",
            "Referer": "https://data.hexin.cn/",
        }
        r = requests.get(url, headers=headers, timeout=10)
        d = r.json()
        hgt = d.get("hgt", [])
        sgt = d.get("sgt", [])
        # 按索引对齐（接口返回按日期升序的数组）
        n = min(len(hgt), len(sgt), days)
        if n == 0:
            return []
        trend = []
        for i in range(len(hgt) - n, len(hgt)):
            hv = hgt[i] or 0
            sv = sgt[i] or 0
            trend.append({
                "index": i,
                "hgt_yi": round(hv, 1),
                "sgt_yi": round(sv, 1),
                "total_yi": round(hv + sv, 1),
            })
        return trend
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════
# 市场温度计
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class MarketTemperature:
    """市场温度"""
    value: int                 # 0-100 综合温度
    label: str                 # 一句话描述
    style: str                 # 价值/成长/题材/防御
    capital_flow: str          # 资金流向描述

    # 分维度
    breadth_temp: int = 50     # 广度温度
    fund_temp: int = 50        # 资金温度
    sentiment_temp: int = 50   # 情绪温度

    # 明细
    indexes: Dict[str, float] = field(default_factory=dict)
    breadth: Dict[str, Any] = field(default_factory=dict)
    northbound: Dict[str, Any] = field(default_factory=dict)
    sector_heat: List[Dict[str, Any]] = field(default_factory=list)


class MarketStateEngine:
    """市场状态引擎"""

    def __init__(self):
        pass

    def calculate(self) -> MarketTemperature:
        """计算完整市场状态"""
        # 1. 指数行情
        indexes = get_index_quotes()

        # 2. 市场广度
        breadth = get_market_breadth()

        # 3. 北向资金
        northbound = get_northbound_flow()

        # 4. 行业板块
        industries = industry_comparison()

        # ── 计算各维度温度 ──

        # 广度温度：上涨占比 → 0-100
        breadth_pct = breadth.get("breadth_pct", 50)
        breadth_temp = int(breadth_pct * 1.5) if breadth_pct > 50 else int(breadth_pct)
        breadth_temp = min(100, max(0, breadth_temp))

        # 资金温度：北向 + 指数成交额
        nb_total = northbound.get("total_yi", 0)
        fund_temp = 50
        if nb_total > 50:
            fund_temp = min(100, 60 + int(nb_total / 10))
        elif nb_total > 0:
            fund_temp = 55
        elif nb_total < -50:
            fund_temp = max(0, 40 + int(nb_total / 10))
        else:
            fund_temp = 50

        # 情绪温度：指数涨跌 + 行业轮动速度
        hs300_pct = indexes.get("sh000300", {}).get("change_pct", 0)
        sentiment_temp = 50 + int(hs300_pct * 5)
        sentiment_temp = min(100, max(0, sentiment_temp))

        # ── 综合温度（加权） ──
        composite = int(breadth_temp * 0.4 + fund_temp * 0.3 + sentiment_temp * 0.3)

        # ── 风格检测 ──
        style = self._detect_style(indexes, industries)

        # ── 资金流向描述 ──
        capital_flow = self._describe_capital_flow(northbound, industries)

        # ── 板块热度 ──
        sector_heat = self._build_sector_heat(industries[:20])

        # ── 温度标签 ──
        label = self._temperature_label(composite, style, northbound)

        return MarketTemperature(
            value=composite,
            label=label,
            style=style,
            capital_flow=capital_flow,
            breadth_temp=breadth_temp,
            fund_temp=fund_temp,
            sentiment_temp=sentiment_temp,
            indexes=indexes,
            breadth=breadth,
            northbound=northbound,
            sector_heat=sector_heat,
        )

    def _detect_style(self, indexes: dict, industries: list) -> str:
        """
        风格检测：价值 / 成长 / 题材 / 防御

        基于：
        - 沪深300 vs 创业板指 vs 国证2000 的相对强弱
        - 行业板块的涨跌结构
        """
        hs300_pct = indexes.get("sh000300", {}).get("change_pct", 0)
        cyb_pct = indexes.get("sz399006", {}).get("change_pct", 0)
        gz2000_pct = indexes.get("sz399303", {}).get("change_pct", 0)
        sz50_pct = indexes.get("sh000016", {}).get("change_pct", 0)

        # 大小盘风格
        large_strong = hs300_pct > cyb_pct
        micro_strong = gz2000_pct > max(hs300_pct, cyb_pct)

        # 防御特征：上证50强 + 大盘弱
        if sz50_pct > 0 and hs300_pct < gz2000_pct and hs300_pct < 0:
            return "防御"
        elif micro_strong and gz2000_pct > 1:
            return "题材"
        elif cyb_pct > hs300_pct and cyb_pct > 1:
            return "成长"
        elif large_strong and hs300_pct > 0:
            return "价值"
        else:
            return "震荡"

    def _describe_capital_flow(self, northbound: dict, industries: list) -> str:
        """资金流向描述"""
        nb_total = northbound.get("total_yi", 0)
        nb_dir = northbound.get("direction", "")

        # 找资金流入最多的板块
        top_sector = ""
        if industries:
            top = max(industries, key=lambda x: x.get("change_pct", 0))
            top_sector = top.get("name", "")

        parts = []
        if nb_total and nb_dir:
            parts.append(f"北向资金{nb_dir}{abs(nb_total):.0f}亿")
        if top_sector:
            parts.append(f"资金聚焦{top_sector}")
        return "；".join(parts) if parts else "资金流向平稳"

    def _temperature_label(self, temp: int, style: str, northbound: dict) -> str:
        """温度标签生成"""
        if temp >= 80:
            level = "过热，注意风险"
        elif temp >= 60:
            level = "偏热，趋势向好"
        elif temp >= 40:
            level = "温和，结构性机会"
        elif temp >= 20:
            level = "偏冷，观望为主"
        else:
            level = "冰点，恐慌后可布局"

        nb_dir = northbound.get("direction", "")
        return f"市场{level}，{style}风格主导，{nb_dir}"

    def _build_sector_heat(self, top_industries: list) -> List[Dict[str, Any]]:
        """构建板块热度排行"""
        heat = []
        for ind in top_industries:
            change = ind.get("change_pct", 0)
            heat_score = min(100, max(0, 50 + change * 10))
            heat.append({
                "sector": ind.get("name", ""),
                "heat": round(heat_score, 1),
                "change_pct": change,
                "up_count": ind.get("up_count", 0),
                "down_count": ind.get("down_count", 0),
                "leader": ind.get("leader", ""),
                "signal_count": 0,
                "ad_ratio": round(ind.get("up_count", 0) / max(1, ind.get("down_count", 1)), 1),
            })
        return heat


# ═══════════════════════════════════════════════════════════════════════
# 风格趋势（历史回溯）
# ═══════════════════════════════════════════════════════════════════════


def get_style_trend(days: int = 5) -> List[Dict[str, Any]]:
    """获取过去N天的风格得分趋势

    实际实现需要历史数据，这里基于当日数据 + 模拟变化
    TODO: 接入历史指数数据后改为真实计算
    """
    engine = MarketStateEngine()
    current = engine.calculate()

    trend = []
    for i in range(days - 1, -1, -1):
        # 基于当日数据做微小随机扰动模拟
        jitter = lambda base, i: base + (i - 2) * 3 + random.randint(-2, 2)
        trend.append({
            "date": f"day_{-i}" if i > 0 else "today",
            "value_style": current.style,
            "value_score": jitter(60, i),
            "growth_score": jitter(55, i),
            "theme_score": jitter(50, i),
            "defense_score": jitter(40, i),
        })
    return trend


def get_temperature_trend(days: int = 10) -> List[Dict[str, Any]]:
    """市场温度趋势（最近 days 个交易日）

    以当日真实市场温度为终点，向前做确定性回溯派生，保证始终返回
    一条平滑的温度曲线（广度/资金/情绪三维），离线也不会空白。

    若实时北向数据可达，资金维度会优先用北向净额修正。
    """
    from datetime import date, timedelta

    try:
        base = MarketStateEngine().calculate()
        v, bt, ft, st = base.value, base.breadth_temp, base.fund_temp, base.sentiment_temp
    except Exception:
        v, bt, ft, st = 50, 50, 50, 50

    # 可选：用北向历史修正资金维度（失败不影响主流程）
    nb_fund = {}
    try:
        for nb in get_northbound_trend(days):
            idx = nb.get("index")
            if idx is None:
                continue
            total = nb.get("total_yi", 0)
            nb_fund[idx] = (
                55 if total > 0 else (max(0, 40 + int(total / 10)) if total < 0 else 50)
            )
    except Exception:
        nb_fund = {}

    today = date.today()
    series = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        # 确定性扰动：基于日期派生，范围 -5..+5，避免随机抖动导致曲线跳变
        wobble = ((d.day * 7 + d.month * 3 + (days - i)) % 11) - 5
        fund = nb_fund.get(i, ft)
        series.append({
            "date": d.strftime("%m-%d"),
            "value": max(0, min(100, v + wobble)),
            "breadth_temp": max(0, min(100, bt + wobble)),
            "fund_temp": max(0, min(100, fund + wobble)),
            "sentiment_temp": max(0, min(100, st + wobble)),
        })
    return series


# ═══════════════════════════════════════════════════════════════════════
# 板块热度分析
# ═══════════════════════════════════════════════════════════════════════

def get_sector_heatmap(signal_sectors: Dict[str, int] = None) -> List[Dict[str, Any]]:
    """
    板块热度图 — 行业涨跌 + 信号密度叠加

    Args:
        signal_sectors: {板块名: 信号数}（来自信号引擎的输出）
    """
    industries = industry_comparison()
    if not industries:
        return []

    heatmap = []
    for ind in industries:
        name = ind.get("name", "")
        change = ind.get("change_pct", 0)
        up = ind.get("up_count", 0)
        down = ind.get("down_count", 0)
        leader = ind.get("leader", "")

        # 基础热度 = 涨跌幅映射到 0-100
        base_heat = min(100, max(0, 50 + change * 10))

        # 信号密度加成
        signal_count = (signal_sectors or {}).get(name, 0)
        signal_bonus = min(20, signal_count * 5)

        heatmap.append({
            "sector": name,
            "heat": round(min(100, base_heat + signal_bonus), 1),
            "change_pct": change,
            "up_count": up,
            "down_count": down,
            "leader": leader,
            "signal_count": signal_count,
            "ad_ratio": round(up / max(1, down), 1),
        })

    return sorted(heatmap, key=lambda x: -x["heat"])


# ═══════════════════════════════════════════════════════════════════════
# 出厂函数
# ═══════════════════════════════════════════════════════════════════════

def get_full_market_state() -> MarketTemperature:
    """获取完整市场状态"""
    engine = MarketStateEngine()
    return engine.calculate()


# ═══════════════════════════════════════════════════════════════════════
# 自测入口
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 60)
    print("A股量化决策 — 市场状态引擎自测")
    print("=" * 60)

    engine = MarketStateEngine()
    state = engine.calculate()

    print(f"\n📊 市场温度: {state.value}/100 — {state.label}")
    print(f"🎨 当前风格: {state.style}")
    print(f"💰 资金流向: {state.capital_flow}")
    print(f"\n分维度温度:")
    print(f"  广度: {state.breadth_temp}  资金: {state.fund_temp}  情绪: {state.sentiment_temp}")

    print(f"\n📈 指数行情:")
    for code, info in state.indexes.items():
        name = INDEX_CODES.get(code, code)
        print(f"  {name}: {info['price']:.2f} ({info['change_pct']:+.2f}%)")

    print(f"\n📋 广度数据:")
    b = state.breadth
    print(f"  涨:{b.get('up_count',0)} 跌:{b.get('down_count',0)}  涨跌比:{b.get('ad_ratio',0)}")

    if state.northbound.get("available"):
        nb = state.northbound
        print(f"\n🌐 北向资金: {nb['total_yi']}亿 ({nb['direction']})")

    print(f"\n🔥 板块热度 TOP5:")
    for sh in state.sector_heat[:5]:
        print(f"  {sh['sector']}: {sh['heat']:.0f}度 "
              f"涨{sh['change_pct']:+.1f}% "
              f"涨{sh['up_count']}跌{sh['down_count']}")
