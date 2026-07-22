"""复盘雷达 — 题材归因与即时兜底。"""

from __future__ import annotations
from typing import List, Dict, Any
import logging
from .signal_engine import ths_hot_reason
from .review_common import _samples_for_theme, _invoke_with_retry

def _generate_theme_reasons(
    themes: List[Dict[str, Any]], date_str: str
) -> Dict[str, str]:
    """输入 themes 列表每项至少含 theme / count / samples(code,name)。 """

    if not themes:
        return {}
    try:
        from agent.src.providers.llm import build_llm

        llm = build_llm()
    except Exception:
        return {}

    lines = []
    for t in themes[:15]:  # LLM 成本控制，最多 15 个题材
        samples = t.get("samples", [])
        stock_names = "、".join(s["name"] for s in samples[:3]) if samples else "无"
        lines.append(f"- {t['theme']}（{t['count']}只相关股）：代表股 {stock_names}")

    theme_list = "\n".join(lines)
    prompt = (
        f"你是A股投研助手。今天是 {date_str}。\n\n"
        f"以下是今天A股市场表现活跃的题材（概念板块）及其代表强势股：\n"
        f"{theme_list}\n\n"
        f"请为每个题材用一句话总结它今天上涨的**核心驱动原因**。\n"
        f"要求：\n"
        f"1) 基于你的知识判断最可能的催化因素（政策利好、行业新闻、事件驱动、\n"
        f"   资金偏好、技术突破等），不要编造具体未发生的新闻；\n"
        f"2) 如果无法确定具体原因，就写该题材的核心逻辑或市场共识；\n"
        f"3) 每条严格控制在 25 字以内，简洁有力；\n"
        f"4) 格式要求——每行一个，格式为：\n"
        f"   题材名：原因描述\n"
        f"5) 只输出上述格式的行，不要加序号、标题或其他内容。\n"
    )
    try:
        resp = llm.invoke(prompt)
        text = getattr(resp, "content", None)
        if text is None and isinstance(resp, str):
            text = resp
        if not (text or "").strip():
            return {}
        reasons: Dict[str, str] = {}
        for line in text.strip().splitlines():
            line = line.strip()
            if not line or line.startswith("-") or line.startswith("*"):
                line = line.lstrip("-* ").strip()
            if "：" in line:
                key, val = line.split("：", 1)
                key = key.strip()
                val = val.strip()
                if key and val:
                    reasons[key] = val
            elif ":" in line:
                key, val = line.split(":", 1)
                key = key.strip()
                val = val.strip()
                if key and val:
                    reasons[key] = val
        return reasons
    except Exception as exc:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning("theme reasons LLM failed: %s", exc)
        return {}


def _minimal_theme_attribution(stocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """用于后台全量构建完成前的即时兜底，避免前端长时间显示「接口中断」。 """

    if not stocks:
        return {"available": False, "building": True, "themes": [], "stocks": []}
    counter: Counter = Counter()
    for s in stocks:
        for t in s.get("themes", []):
            counter[t] += 1
    theme_items = [
        {"theme": t, "count": c, "samples": _samples_for_theme(stocks, t)}
        for t, c in counter.most_common(20)
    ]
    return {
        "available": True,
        "building": True,
        "themes": theme_items,
        "stocks": stocks,
        "note": "同花顺 getharden 基础数据已就绪，财报/买卖指导正在后台生成中…",
    }

