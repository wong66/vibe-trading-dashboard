"""复盘雷达 — Serenity AI 评分卡 / 选股 / 证据生成。"""

from __future__ import annotations
from typing import List, Dict, Tuple, Any
from .review_common import (
    _invoke_with_retry, _parse_kv_lines, _fmt_yi, _fmt_pct,
)

def _generate_all_evidence(
    theme_picks: Dict[str, List[Dict[str, Any]]]
) -> Dict[str, Dict[str, str]]:
    """输入 {theme: [pick, ...]}，每项 pick 含 name/code/fin/change_pct。 """

    tasks = []
    for theme, picks in theme_picks.items():
        for p in picks:
            if p.get("fin"):  # 仅有财务数据才值得写证据
                tasks.append((theme, p))
    if not tasks:
        return {}
    try:
        from agent.src.providers.llm import build_llm
        llm = build_llm()
    except Exception:
        return {}

    result: Dict[str, Dict[str, str]] = {}
    chunk_size = 10
    import time as _t
    for i in range(0, len(tasks), chunk_size):
        chunk = tasks[i:i + chunk_size]
        lines = []
        for theme, p in chunk:
            fin = p.get("fin") or {}
            fin_str = (
                f"营收{_fmt_yi(fin.get('revenue'))}亿(同比{_fmt_pct(fin.get('revenue_yoy'))})，"
                f"净利{_fmt_yi(fin.get('profit'))}亿(同比{_fmt_pct(fin.get('profit_yoy'))})，"
                f"毛利率{fin.get('gross_margin')}%，"
                f"合同负债{_fmt_yi(fin.get('contract_liability'))}亿，"
                f"经营现金流{_fmt_yi(fin.get('operating_cash_flow'))}亿"
            )
            lines.append(
                f"- [{theme}] {p['name']}({p['code']})：涨幅{_fmt_pct(p.get('change_pct'))}，"
                f"财报({fin.get('period','?')})：{fin_str}"
            )
        pick_list = "\n".join(lines)
        prompt = (
            f"你是A股投研助手。以下是今天各热门题材的精选代表强势股及其最新财务数据：\n"
            f"{pick_list}\n\n"
            f"请为**每只股票**用一句话写「关键证据」——它为什么值得关注（结合财务质量/成长性/题材契合度），"
            f"要具体、有数据支撑，不要空话。\n"
            f"要求：\n"
            f"1) 每条严格控制在 30 字以内；\n"
            f"2) 格式：股票代码：证据描述（代码需与上面列出的完全一致）；\n"
            f"3) 只输出上述格式的行，不要加序号/标题/题材名。\n"
        )
        text = _invoke_with_retry(llm, prompt, label=f"evidence chunk {i}")
        if not text:
            continue
        code_ev = _parse_kv_lines(text)
        for theme, p in chunk:
            code = p["code"]
            ev = code_ev.get(code, "")
            if not ev:
                for k, v in code_ev.items():
                    if k.endswith(code) or code in k:
                        ev = v
                        break
            result.setdefault(theme, {})[code] = ev
    return result


def _generate_serenity_picks(
    themes: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, str]]]:
    """Serenity 核心逻辑：从产业链卡点 → 供给稀缺性 → 财务质量 → 估值错位 """

    if not themes:
        return {}
    try:
        from agent.src.providers.llm import build_llm
        llm = build_llm()
    except Exception:
        return {}

    theme_names = [t["theme"] for t in themes[:15]]
    name_list = "\n".join(f"- {name}" for name in theme_names)

    prompt = (
        "你是 A 股供应链瓶颈分析专家（Serenity 方法论）。\n\n"
        "以下是一组A股市场热门题材/概念板块。对**每个题材**，请独立选出 "
        "**3只基本面最优质、最值得深入研究**的A股标的。\n\n"
        f"题材列表：\n{name_list}\n\n"
        "选股标准（Serenity 评分维度）：\n"
        "1) **产业链卡点位置**：是否处于供给稀缺层（上游材料/设备/核心部件 > 中游制造 > 下游集成）；\n"
        "2) **财务质量**：营收增速、净利增速、毛利率、经营现金流是否健康；\n"
        "3) **供需格局**：产能扩张难度、客户集中度、技术壁垒；\n"
        "4) **估值与催化**：当前估值是否未充分反映产业链地位，近期是否有订单/政策/技术催化。\n\n"
        "要求：\n"
        "- 每只股票必须给出 **6 位股票代码** + **证券简称**（如 600519 贵州茅台）；\n"
        "- 选出的股票应该是该领域**长期竞争力最强**的龙头或隐形冠军，\n"
        "  不一定是当天涨得最多的（可能和涨幅榜完全不同）；\n"
        "- 格式——每行一个题材，格式为：\n"
        "   题材名：代码1 名称1，代码2 名称2，代码3 名称3\n"
        "- 只输出上述格式的行，不要加序号/标题/解释。"
    )

    text = _invoke_with_retry(llm, prompt, label="serenity picks")
    if not text:
        return {}

    result: Dict[str, List[Dict[str, str]]] = {}
    for line in text.strip().splitlines():
                line = line.strip()
                if not line or "：" not in line and ":" not in line:
                    continue
                sep = "：" if "：" in line else ":"
                parts = line.split(sep, 1)
                if len(parts) != 2:
                    continue
                th = parts[0].strip()
                val = parts[1].strip()
                if not th or not val:
                    continue
                picks: List[Dict[str, str]] = []
                for token in val.replace("，", ",").split(","):
                    token = token.strip()
                    if not token:
                        continue
                    m = __import__("re").match(r"^(\d{6})\s*(.+)$", token)
                    if m:
                        picks.append({"code": m.group(1), "name": m.group(2).strip()})
                if picks:
                    matched = th
                    for known in theme_names:
                        if known in th or th in known:
                            matched = known
                            break
                    result.setdefault(matched, []).extend(picks[:3])
    return result if result else {}


def _generate_serenity_scorecards(
    theme_picks: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Dict[str, str]]:
    """输入: {theme_name: [pick_dict_with_fin, ...]}  （pick 含 code/name/price/fin/evidence） """

    if not theme_picks:
        return {}
    try:
        from agent.src.providers.llm import build_llm
        llm = build_llm()
    except Exception:
        return {}

    tasks: List[Tuple[str, Dict[str, Any]]] = []
    for theme, picks in theme_picks.items():
        for p in picks:
            if p.get("fin"):
                tasks.append((theme, p))

    if not tasks:
        return {}

    result: Dict[str, Dict[str, str]] = {}
    chunk_size = 6
    for i in range(0, len(tasks), chunk_size):
        chunk = tasks[i:i + chunk_size]
        lines = []
        for theme, p in chunk:
            fin = p.get("fin") or {}
            fin_str = (
                f"营收{_fmt_yi(fin.get('revenue'))}亿(同比{_fmt_pct(fin.get('revenue_yoy'))})，"
                f"净利{_fmt_yi(fin.get('profit'))}亿(同比{_fmt_pct(fin.get('profit_yoy'))})，"
                f"毛利率{fin.get('gross_margin')}%，"
                f"净利率{fin.get('net_margin')}%，"
                f"负债率{fin.get('debt_ratio')}%，"
                f"合同负债{_fmt_yi(fin.get('contract_liability'))}亿，"
                f"经营现金流{_fmt_yi(fin.get('operating_cash_flow'))}亿"
            )
            lines.append(
                f"- [{theme}] {p['name']}({p['code']}) 最新价{p.get('price','?')} "
                f"财报({fin.get('period','?')})：{fin_str}"
            )

        prompt = (
            "你是 A 股供应链瓶颈分析专家（Serenity 方法论）。"
            "以下各题材的精选个股已给出最新财务数据。"
            "请为**每只股票**撰写一份精简的「Serenity 评分卡」分析。\n\n"
            f"{chr(10).join(lines)}\n\n"
            "每只股票的评分卡必须包含以下 5 个板块（用中文冒号分隔）：\n"
            "1) **卡住的环节**：一句话描述该公司在产业链中的核心卡点/瓶颈位置\n"
            "2) **产业链位置**：一句话描述其在产业链上下游中的定位\n"
            "3) **排序原因**：2-4 个要点 bullet（用 • 开头），解释为什么选这只股，结合财务数据\n"
            "4) **证据强度**：一句话评估（强/中等偏强/中等/弱），说明依据\n"
            "5) **主要风险**：1-2 条最关键的风险提示\n\n"
            "格式要求——每只股票严格按以下格式输出一行：\n"
            "   股票代码：【卡住的环节】xxx；【产业链位置】xxx；【排序原因】•xxx •xxx；"
            "【证据强度】xxx；【主要风险】xxx\n"
            "- 只输出上述格式的行，不要加序号或额外内容\n"
            "- 每条控制在 150 字以内"
        )

        text = _invoke_with_retry(llm, prompt, label=f"scorecard chunk {i}")
        if not text:
            continue

        code_card: Dict[str, str] = {}
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            m = __import__("re").match(r"^(\d{6})[：:\s](.+)$", line)
            if m:
                code_card[m.group(1)] = m.group(2).strip()

        for theme, p in chunk:
            code = p["code"]
            card = code_card.get(code, "")
            if not card:
                for k, v in code_card.items():
                    if k.endswith(code) or code in k:
                        card = v
                        break
                    result.setdefault(theme, {})[code] = card

    return result

