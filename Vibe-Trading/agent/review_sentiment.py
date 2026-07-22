"""复盘雷达 — 市场情绪 / 板块资金趋势榜 / 短线情绪

照搬 Vibe-Research 每日复盘（backend/market.py）的三块数据口径，
数据源全部改用本环境可用的 akshare / 同花顺（东财 stock_fund_flow_industry
在本 venv 因 py_mini_racer 崩溃，故板块资金流改用已验证的 THS 真实净额）。

- 市场情绪：akshare.stock_market_activity_legu（乐股大盘宽度）
- 板块资金趋势榜：review_sectors.sector_capital_flow（同花顺真实净额，等价东财即时行业资金流）
- 短线情绪：akshare 涨停四池（stock_zt_pool_em / zbgc / dtgc / previous）
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

BEIJING = timezone(timedelta(hours=8))


def _num(v) -> int:
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return 0


def _to_float(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


# ── 1) 市场情绪 ────────────────────────────────────────────────────────

def get_market_sentiment() -> Dict[str, Any]:
    """市场情绪：涨跌家数/涨停跌停/活跃度 + 大盘宽度、题材投机（机械分档）。

    等价 Vibe-Research market._sentiment()。
    """
    try:
        import akshare as ak
        df = ak.stock_market_activity_legu()
        d = {str(row["item"]): row["value"] for _, row in df.iterrows()}
    except Exception:
        return {}

    up, down, flat = _num(d.get("上涨")), _num(d.get("下跌")), _num(d.get("平盘"))
    zt, zt_real = _num(d.get("涨停")), _num(d.get("真实涨停"))
    dt, dt_real = _num(d.get("跌停")), _num(d.get("真实跌停"))
    r = up / max(down, 1)
    if up < 600:
        breadth = "冰点"
    elif r < 0.7:
        breadth = "偏弱"
    elif r < 1.2:
        breadth = "中性"
    elif r < 2.5:
        breadth = "偏强"
    else:
        breadth = "普涨"
    speculation = "亢奋" if zt_real >= 100 else "活跃" if zt_real >= 60 else "普通" if zt_real >= 30 else "冰点"
    return {
        "up": up, "down": down, "flat": flat,
        "zt": zt, "zt_real": zt_real, "dt": dt, "dt_real": dt_real,
        "active": str(d.get("活跃度", "")),
        "breadth": breadth, "speculation": speculation,
        "date": str(d.get("统计日期", "")),
    }


# ── 2) 板块资金趋势榜 ────────────────────────────────────────────────────

def get_sector_flow(top_n: int = 40) -> List[Dict[str, Any]]:
    """板块资金趋势榜（按净额降序）。等价 Vibe-Research market._sectors()。

    东财 stock_fund_flow_industry 在本 venv 崩溃，改用已验证的 THS 真实净额
    （review_sectors.sector_capital_flow），字段口径一致：行业/涨跌%/净流入/流入/流出/家数。
    """
    try:
        from .review_sectors import sector_capital_flow
        rows, _total = sector_capital_flow(top_n)
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "name": str(r.get("name", "")),
            "pct": round(_to_float(r.get("change_pct", 0)), 2),
            "net": round(_to_float(r.get("main_net_yi", 0)), 2),
            "inflow": round(_to_float(r.get("inflow_yi", 0)), 2),
            "outflow": round(_to_float(r.get("outflow_yi", 0)), 2),
            "firms": _num(r.get("firms")),
        })
    return out


# ── 3) 短线情绪 ────────────────────────────────────────────────────────

def get_short_term_emotion() -> Dict[str, Any]:
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    等价 Vibe-Research market._emotion()，数据源改用 akshare 涨停四池
    （东财 push2ex 等价）。聚合口径，展示客观公开榜单（含连板股清单）。
    """
    try:
        import akshare as ak
    except Exception:
        return {}

    # 定位最近交易日：从今天往前回溯，第一日有涨停池即取
    today = datetime.now(BEIJING).date()
    resolved, zt = "", None
    for back in range(10):
        d = (today - timedelta(days=back)).strftime("%Y%m%d")
        try:
            z = ak.stock_zt_pool_em(date=d)
            if z is not None and len(z) > 0:
                resolved, zt = d, z
                break
        except Exception:
            continue
    if not resolved or zt is None or len(zt) == 0:
        return {}

    try:
        zb = ak.stock_zt_pool_zbgc_em(date=resolved)   # 炸板池
    except Exception:
        zb = None
    try:
        dt = ak.stock_zt_pool_dtgc_em(date=resolved)   # 跌停池
    except Exception:
        dt = None
    try:
        yzt = ak.stock_zt_pool_previous_em(date=resolved)  # 昨涨停池
    except Exception:
        yzt = None

    zb = zb if zb is not None else []
    dt = dt if dt is not None else []
    yzt = yzt if yzt is not None else []

    def _board(row) -> int:
        try:
            b = int(float(row.get("连板数", 1) or 1))
        except Exception:
            b = 1
        return b if b >= 1 else 1

    boards = [_board(r) for _, r in zt.iterrows()]
    lianban = [b for b in boards if b >= 2]
    tiers = Counter(min(b, 5) for b in lianban)
    ladder = [{"board": b, "count": tiers[b]} for b in sorted(tiers)]

    lianban_stocks = []
    for _, row in zt.iterrows():
        b = _board(row)
        if b >= 2:
            lianban_stocks.append({
                "code": str(row.get("代码", "")),
                "name": str(row.get("名称", "")),
                "boards": b,
                "price": round(_to_float(row.get("最新价", 0)), 2),
                "pct": round(_to_float(row.get("涨跌幅", 0)), 2),
                "amount": _to_float(row.get("成交额", 0)),       # 成交额,元
                "float_cap": _to_float(row.get("流通市值", 0)),  # 流通市值,元
                "industry": str(row.get("所属行业", "")),
            })
    lianban_stocks.sort(key=lambda x: (-x["boards"], -x["amount"]))

    zt_count, zb_count, dt_count, yzt_count = len(zt), len(zb), len(dt), len(yzt)
    attempts = zt_count + zb_count
    seal_rate = round(zt_count / attempts, 3) if attempts else None      # 封板率
    break_rate = round(zb_count / attempts, 3) if attempts else None     # 炸板率
    promotion_rate = round(len(lianban) / yzt_count, 3) if yzt_count else None  # 晋级率

    return {
        "date": f"{resolved[:4]}-{resolved[4:6]}-{resolved[6:]}",
        "zt_count": zt_count,
        "dt_count": dt_count,
        "zb_count": zb_count,
        "max_boards": max(boards) if boards else 0,
        "lianban_count": len(lianban),
        "ladder": ladder,
        "lianban_stocks": lianban_stocks,
        "seal_rate": seal_rate,
        "break_rate": break_rate,
        "promotion_rate": promotion_rate,
        "yzt_count": yzt_count,
    }
