"""复盘雷达 — 公共工具与叶子函数（格式化/解析/行情/连板/财务并发）。"""

from __future__ import annotations
import ssl
import time
import logging
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
from .signal_engine import (
    em_get, ths_hot_reason, tencent_batch_quote, UA, _get_prefix, get_provider,
)

def _fmt_yi(v: Optional[float]) -> str:
    """数值(元)格式化为亿，保留1位小数；None→'—'。"""
    if v is None:
        return "—"
    try:
        return f"{v / 1e8:.1f}"
    except Exception:
        return "—"


def _fmt_pct(v: Optional[float]) -> str:
    """小数(0.063)格式化为百分比字符串(+6.3%)；None→'—'。"""
    if v is None:
        return "—"
    try:
        return f"{v * 100:+.1f}%"
    except Exception:
        return "—"


def _parse_themes(reason: str) -> List[str]:
    if not reason:
        return []
    return [t.strip() for t in str(reason).split("+") if t.strip()]


def _parse_kv_lines(text: str) -> Dict[str, str]:
    """解析「代码：描述」/「题材：原因」类 KV 行。"""
    result: Dict[str, str] = {}
    for line in text.strip().splitlines():
        line = line.strip().lstrip("-* ").strip()
        sep = "：" if "：" in line else (":" if ":" in line else None)
        if not sep:
            continue
        parts = line.split(sep, 1)
        if len(parts) != 2:
            continue
        key, val = parts[0].strip(), parts[1].strip()
        if key and val:
            result[key] = val
    return result


def _invoke_with_retry(
    llm, prompt: str, label: str = "LLM", attempts: int = 3
) -> Optional[str]:
    """带重试的 LLM 调用，返回文本或 None（全部失败）。"""
    _log = logging.getLogger(__name__)
    for attempt in range(attempts):
        try:
            resp = llm.invoke(prompt)
            text = getattr(resp, "content", None)
            if text is None and isinstance(resp, str):
                text = resp
            if (text or "").strip():
                return text
        except Exception as exc:
            _log.warning("%s attempt %d failed: %s", label, attempt + 1, exc)
            if attempt < attempts - 1:
                time.sleep(2 * (attempt + 1))
    return None


def _fetch_realtime_quotes(codes: List[str]) -> Dict[str, dict]:
    """实时行情（腾讯 qt.gtimg.cn），兼容 launchd 无 SSL 证书环境。"""
    if not codes:
        return {}
    try:
        r = tencent_batch_quote(codes)
        if r:
            return r
    except Exception:
        pass
    import urllib.request
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    from .signal_engine import _get_prefix
    prefixed = [f"{_get_prefix(c)}{c}" for c in codes]
    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    try:
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        data = resp.read().decode("gbk")
    except Exception:
        return {}
    result: Dict[str, dict] = {}
    for line in data.strip().split(";"):
        if not line.strip() or "=" not in line or '"' not in line:
            continue
        key = line.split("=")[0].split("_")[-1]
        vals = line.split('"')[1].split("~")
        if len(vals) < 53:
            continue
        code = key[2:]
        result[code] = {
            "name": vals[1],
            "price": float(vals[3]) if vals[3] else 0,
            "last_close": float(vals[4]) if vals[4] else 0,
            "change_pct": float(vals[32]) if vals[32] else 0,
        }
    return result


def _samples_for_theme(stocks: List[Dict[str, Any]], theme: str, k: int = 3) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for s in stocks:
        if theme in s.get("themes", []):
            out.append({"code": s["code"], "name": s["name"]})
            if len(out) >= k:
                break
    return out


def _theme_heat_from_stocks(stocks: List[Dict[str, Any]], top_n: int = 15) -> List[Dict[str, Any]]:
    """返回按出现次数排序的题材列表，每项含：theme/count/samples/avg_change。 """

    counter: Counter = Counter()
    theme_changes: Dict[str, List[float]] = {}
    for s in stocks:
        for t in s.get("themes", []):
            counter[t] += 1
            pct = s.get("change_pct")
            if pct is not None and pct == pct:  # 排除 NaN
                theme_changes.setdefault(t, []).append(pct)
    
    result = []
    for theme, count in counter.most_common(top_n):
        samples = []
        for s in stocks:
            if theme in s.get("themes", []):
                samples.append({"code": s["code"], "name": s["name"]})
                if len(samples) >= 3:
                    break
        pcts = theme_changes.get(theme, [])
        avg_change = round(sum(pcts) / len(pcts), 2) if pcts else None
        result.append({
            "theme": theme,
            "count": count,
            "samples": samples,
            "avg_change": avg_change,
        })
    return result


def _build_theme_top_picks(theme: str, stocks: List[Dict[str, Any]], top_n: int = 3) -> List[Dict[str, Any]]:
    """返回 [ """

    def _pct(s):
        p = s.get("realtime_pct") if s.get("realtime_pct") is not None else s.get("change_pct")
        return p if p is not None else -999

    ranked = sorted(stocks, key=_pct, reverse=True)[:top_n]
    if not ranked:
        return []

    picks: List[Dict[str, Any]] = []
    for s in ranked:
        code = s.get("code", "")
        price = s.get("price") if s.get("price") is not None else None
        change = s.get("realtime_pct") if s.get("realtime_pct") is not None else s.get("change_pct")
        buy = _calc_buy_stop(price, change)
        picks.append({
            "code": code,
            "name": s.get("name", ""),
            "price": price,
            "change_pct": change,
            "fin": None,  # 由调用方并发填充
            "buy": buy,
            "evidence": "",  # 由 _generate_all_evidence 批量填充
        })
    return picks


def _fetch_financials_concurrent(codes: List[str]) -> Dict[str, Optional[dict]]:
    """用线程池将 60 次串行请求压缩到 ~10s 内完成。各自容错。 """

    if not codes:
        return {}
    try:
        from .signal_engine import get_provider
        provider = get_provider()
    except Exception:
        return {c: None for c in codes}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    fin_map: Dict[str, Optional[dict]] = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(provider.quarterly_financials, c): c for c in codes}
        for f in as_completed(futures):
            c = futures[f]
            try:
                fin_map[c] = f.result()
            except Exception:
                fin_map[c] = None
    return fin_map


def _harden_codes(date_str: str) -> set:
    """某交易日 getharden 涨停股票代码集合。"""
    try:
        df = ths_hot_reason(date_str)
    except Exception:
        return set()
    if df is None or getattr(df, "empty", True):
        return set()
    if "code" not in df.columns:
        return set()
    return set(str(c) for c in df["code"].tolist())


def _prior_trading_days(n: int, end: datetime) -> List[datetime]:
    days: List[datetime] = []
    d = end
    while len(days) < n:
        d = d - timedelta(days=1)
        if d.weekday() < 5:  # 跳过周末
            days.append(d)
    return days


def _compute_boards(today_codes: List[str], date_str: str, lookback: int = 7) -> Dict[str, int]:
    """再前一交易日也涨停则再 +1，以此类推——只向前延伸，绝不把「首板」归零。 """

    boards: Dict[str, int] = {c: 1 for c in today_codes}  # 1 = 当天涨停（首板保底）
    try:
        anchor = datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        anchor = datetime.now()
    chaining = set(today_codes)  # 仍在连续连板链中的代码
    for d in _prior_trading_days(lookback, anchor):
        prev = _harden_codes(d.strftime("%Y-%m-%d"))
        if not prev:
            break  # 遇无数据日则停止延伸（保守，避免虚高连板）
        still: set = set()
        for c in chaining:
            if c in prev:
                boards[c] += 1
                still.add(c)
        chaining = still
        if not chaining:
            break  # 所有票连板链均已中断，无需继续往前查
    return boards


def _estimate_blast() -> Dict[str, Any]:
    """炸板率估算：东财全 A 扫描，收盘涨幅 [9.5%, 9.95%) 近似炸板（主板/创业 10% 限制）。"""
    fs_list = ["m:0+t:6", "m:0+t:80"]  # 沪深主板 + 创业板
    blast = 0
    scanned = 0
    for fs in fs_list:
        url = "https://push2.eastmoney.com/api/qt/clist/get"
        params = {
            "pn": "1", "pz": "5000", "po": "1", "np": "1",
            "fltt": "2", "invt": "2",
            "fs": fs, "fields": "f3",
        }
        try:
            r = em_get(url, params=params, headers={"User-Agent": UA}, timeout=20)
            d = r.json()
        except Exception:
            continue
        items = (d.get("data") or {}).get("diff") or []
        for it in items:
            f3 = it.get("f3")
            if f3 is None:
                continue
            scanned += 1
            if 9.5 <= f3 < 9.95:
                blast += 1
    return {"blast": blast, "scanned": scanned}


def _board_ladder(boards: Dict[str, int]) -> List[Dict[str, Any]]:
    cnt = Counter(boards.values())
    return [{"board": b, "count": cnt[b]} for b in sorted(cnt.keys(), reverse=True)]


def _board_label(b: int) -> str:
    if not b or b <= 1:
        return "首板"
    return f"{b}连板"


def _calc_buy_stop(price: Optional[float], change_pct: Optional[float]) -> Dict[str, Any]:
    """返回 {buy_low, buy_high, stop_loss, note} """

    if not price or price <= 0:
        return {"buy_low": None, "buy_high": None, "stop_loss": None,
                "note": "价格缺失，无法给出指导"}
    if change_pct is not None and change_pct >= 9.5:
        return {"buy_low": None, "buy_high": None, "stop_loss": None,
                "note": "涨停封板，等待开板回踩再介入"}
    buy_high = round(price, 2)
    buy_low = round(price * 0.97, 2)
    stop_loss = round(buy_low * 0.93, 2)
    return {"buy_low": buy_low, "buy_high": buy_high,
            "stop_loss": stop_loss,
            "note": f"回踩 {buy_low}~{buy_high} 介入，破 {stop_loss} 止损"}


def _is_20cm(code: Optional[str]) -> bool:
    """科创板(688)与创业板(300)为 20% 涨跌幅限制。"""
    if not code:
        return False
    c = code.upper()
    return c.startswith("688") or (c.startswith("30") and c.endswith(".SZ"))

