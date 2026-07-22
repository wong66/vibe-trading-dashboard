"""复盘雷达 — 交易参数与市场温度分类。"""

from __future__ import annotations
from typing import List, Dict, Any
from .review_common import _is_20cm, _board_label

def _calc_trade_params(stock: Dict[str, Any], strategy_type: str, boards: int) -> Dict[str, Any]:
    """所有价格均来自 panels 中已有的 price/change_pct/boards 字段， """

    price = stock.get("price")
    name = stock.get("name", "")
    code = stock.get("code")
    if price is None or price <= 0 or not isinstance(price, (int, float)):
        return {
            "buy_range": "", "stop_loss": "", "target": "",
            "note": "无实时价格", "params_note": "", "risk_reward": "",
        }

    is_20 = _is_20cm(code)
    limit_pct = 0.20 if is_20 else 0.10  # 涨停幅度

    if strategy_type == "主线延续":
        buy_low = round(price * 0.95, 2)   # 回踩 -5%
        buy_high = round(price * 0.98, 2)  # 回踩 -2%
        entry = round((buy_low + buy_high) / 2, 2)
        stop = round(price * 0.90, 2)      # 止损 -10%（真龙常深洗后反包，放宽）
        tgt = round(price * (1.20 if boards >= 4 else 1.15), 2)  # 看 N+1 板 / +15~20%
        note = f"{name}{boards}板主线确认，分歧日回踩低吸"
        params_note = (
            "【主线延续策略】龙头走出连板、主线确认后，等分歧日回踩 2%~5% 低吸；"
            "止损放宽至 -10%（真龙常深洗至 -10% 后再反包，过紧易被洗出）；"
            "目标看封住 N+1 板或 +15%~20%。"
        )

    elif strategy_type == "题材埋伏":
        buy_low = round(price * 0.99, 2)   # -1%
        buy_high = round(price * 1.02, 2)  # +2%
        entry = round((buy_low + buy_high) / 2, 2)
        stop = round(price * 0.94, 2)      # 止损 -6%（试仓严控）
        tgt = round(price * 1.10, 2)       # 目标 +10%（首板保守预期）
        note = f"{name}首板启动，轻仓试错"
        params_note = (
            "【题材埋伏策略】题材出现多只首板但未见高板，属启动初期；"
            "就近 ±1% 轻仓试错，止损 -6% 严控风险，目标 +10% 保守预期，等待高板确认主线。"
        )

    elif strategy_type == "连板接力":
        buy_low = round(price, 2)          # 涨停价打板
        buy_high = round(price, 2)
        entry = round(price, 2)
        stop = round(price * (1 - 0.05), 2)  # 次日破开盘价或 -5% 即离场（防核按钮）
        tgt = round(price * (1 + limit_pct), 2)  # 目标封住 N+1 板（+10%/+20%）
        note = f"{name}{boards}板接力，涨停价打板看N+1板"
        params_note = (
            f"【连板接力策略】于涨停价（≈{price}）打板或换手回封介入；"
            f"次日跌破开盘价或 -5% 即离场（防核按钮，不预设固定中段止损）；"
            f"目标封住 N+1 板（{'+20%' if is_20 else '+10%'}）。成本基准=涨停价。"
        )

    else:
        buy_low = round(price * 0.97, 2)
        buy_high = round(price * 1.00, 2)
        entry = round((buy_low + buy_high) / 2, 2)
        stop = round(price * 0.95, 2)
        tgt = round(price * 1.08, 2)
        note = ""
        params_note = "【默认保守模板】无明确策略类型时的兜底参数。"

    risk = round(entry - stop, 2)
    reward = round(tgt - entry, 2)
    rr = ""
    if risk > 0 and reward > 0:
        ratio = reward / risk
        rr = f"1:{ratio:.1f}"

    return {
        "buy_range": f"{buy_low}～{buy_high}",
        "stop_loss": f"{stop}",
        "target": f"{tgt}",
        "note": note,
        "params_note": params_note,
        "risk_reward": rr,
    }


def _classify_market_temp(lb: Dict[str, Any], sr: Dict[str, Any]) -> Dict[str, Any]:
    """返回： """

    max_board = lb.get("max_board") or 0
    blast_rate = lb.get("blast_rate")
    limitup_count = lb.get("limitup_count") or 0
    ladder = lb.get("board_ladder") or []

    high_board_count = sum(b["count"] for b in ladder if b.get("board", 0) >= 3)
    total_board_stocks = sum(b["count"] for b in ladder) if ladder else 0
    ladder_health = (high_board_count / total_board_stocks * 100) if total_board_stocks else 0

    inflows = [c for c in (sr.get("capital_inflow") or []) if (c.get("main_net_yi") or 0) > 0]
    outflows = [c for c in (sr.get("capital_inflow") or []) if (c.get("main_net_yi") or 0) < 0]

    score = 50  # 基准分

    if max_board >= 7:
        score += 25
    elif max_board >= 5:
        score += 15
    elif max_board >= 3:
        score += 5
    elif max_board <= 1:
        score -= 20

    if limitup_count >= 60:
        score += 10
    elif limitup_count >= 30:
        score += 5
    elif limitup_count <= 10:
        score -= 15

    if blast_rate is not None:
        if blast_rate >= 40:
            score -= 20
        elif blast_rate >= 30:
            score -= 10
        elif blast_rate < 15:
            score += 10

    if ladder_health >= 50:
        score += 10
    elif ladder_health <= 10 and total_board_stocks > 3:
        score -= 10

    if len(inflows) > len(outflows) * 2:
        score += 10
    elif len(outflows) > len(inflows) * 2:
        score -= 10

    score = max(0, min(100, score))

    if score >= 70:
        cycle = "上行"
        desc = f"情绪上行期（连板{max_board}板+涨停{limitup_count}家），打板赚钱效应强"
    elif score >= 45:
        cycle = "混沌"
        desc = f"市场混沌期（多空交织），结构性机会为主"
    elif score >= 25:
        cycle = "退潮"
        desc = f"情绪退潮期（炸板率{blast_rate}%/高度压制），追高亏钱效应显现"
    else:
        cycle = "冰点"
        desc = f"情绪冰点期（高度{max_board}板/涨停稀少），宜防守等待"

    def adjust_conf(base: str) -> str:
        """根据市场温度调整置信度。"""
        order = {"高": 3, "中": 2, "低": 1}
        base_val = order.get(base, 2)
        if cycle == "退潮":
            base_val = min(base_val, 2)  # 退潮期最高只给中
            if base_val == 2 and score < 35:
                base_val = 1  # 深度退潮降为低
        elif cycle == "冰点":
            base_val = 1  # 冰点期全部降为低
        elif cycle == "上行":
            pass  # 上行期不额外提升，保持原评级
        return {3: "高", 2: "中", 1: "低"}[base_val]

    return {
        "cycle": cycle,
        "score": score,
        "desc": desc,
        "adjust": adjust_conf,
    }

