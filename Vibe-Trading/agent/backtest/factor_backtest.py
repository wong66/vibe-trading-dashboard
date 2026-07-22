"""P5 回测验证闭环 — 因子有效性回测 + 权重反哺

用 a-stock-data 真实日线(mootdx)对未来收益做横截面 Spearman IC，
评估每个因子对「未来收益」的预测力，据此收缩调整因子权重并持久化，
下一轮 SignalPipeline 自动加载反哺后的权重（自我修正）。

诚实原则：
- 拿不到真实行情/因子的样本跳过，绝不编造后验收益。
- 有效样本不足时返回 error，绝不编造 IC。
- 权重反哺采用收缩(shrinkage)，不过拟合、不失控。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

from ..signal_engine import (
    DEFAULT_WEIGHTS,
    FACTOR_DIRECTION,
    FactorCalculator,
    tencent_batch_quote,
    mootdx_finance_snapshot,
    stock_fund_flow_120d,
    fetch_daily_bars,
)

FACTOR_NAMES: List[str] = list(DEFAULT_WEIGHTS.keys())

WEIGHTS_CACHE = (
    Path(__file__).resolve().parent.parent.parent / "A股量化决策" / ".cache" / "factor_weights.json"
)


def _future_returns(code: str, as_of: str, windows=(5, 10, 20)) -> Optional[Dict[int, float]]:
    """用真实日线算 as_of 之后各窗口收益(%)。失败返回 None（诚实降级）。"""
    try:
        ts = pd.Timestamp(as_of)
    except Exception:
        return None
    end_s = (ts + timedelta(days=max(windows) * 2 + 15)).strftime("%Y-%m-%d")
    df = fetch_daily_bars(code, start=None, end=end_s)
    if df is None or df.empty or "close" not in df.columns:
        return None
    sub = df.loc[df.index >= ts]
    if sub.empty:
        return None
    entry = float(sub["close"].iloc[0])
    if not entry:
        return None
    out = {}
    for w in windows:
        pos = min(w, len(sub) - 1)
        exit_c = float(sub["close"].iloc[pos])
        out[w] = round((exit_c / entry - 1) * 100, 2)
    return out


def build_sample(pool: List[str], as_of: str) -> pd.DataFrame:
    """构造单时点回测样本：因子值（与 run() 同口径）+ 未来收益。无真实收益样本跳过。"""
    calc = FactorCalculator()
    quotes = tencent_batch_quote(pool)
    rows = []
    for code, q in quotes.items():
        if not q:
            continue
        fr = calc.compute_from_tencent(code, q, "")
        fr = calc.enrich_with_finance(fr, mootdx_finance_snapshot(code))
        fr = calc.enrich_with_fund_flow(fr, stock_fund_flow_120d(code))
        fr = calc.enrich_with_momentum(fr, code)
        fr = calc.enrich_with_growth(fr, code)
        rets = _future_returns(code, as_of)
        if rets is None:
            continue
        row = {f: getattr(fr, f, None) for f in FACTOR_NAMES}
        row["code"] = code
        row["name"] = fr.name
        for w, rv in rets.items():
            row[f"fwd_ret_{w}d"] = rv
        rows.append(row)
    return pd.DataFrame(rows)


def compute_ic(panel: pd.DataFrame, windows=(5, 10, 20)) -> Dict[str, Dict[str, float]]:
    """对每个因子算与 fwd_ret_Nd 的横截面 Spearman IC（多窗口均值 + 分窗口）。"""
    result: Dict[str, Dict[str, float]] = {}
    for f in FACTOR_NAMES:
        ics = []
        by_win = {}
        for w in windows:
            col = f"fwd_ret_{w}d"
            if col not in panel.columns:
                continue
            sub = panel[[f, col]].dropna()
            if len(sub) < 5:
                continue
            r = sub[f].corr(sub[col], method="spearman")
            if pd.isna(r):
                continue
            r = round(float(r), 3)
            ics.append(r)
            by_win[w] = r
        if ics:
            ncol = f"fwd_ret_{windows[0]}d"
            n = int(panel[[f, ncol]].dropna().shape[0]) if ncol in panel.columns else 0
            result[f] = {"ic_mean": round(sum(ics) / len(ics), 3), "ic_by_window": by_win, "n": n}
    return result


def optimize_weights(ic_map: Dict, base: Optional[Dict[str, float]] = None) -> Tuple[Dict[str, float], Dict[str, str]]:
    """基于 IC 收缩反哺权重。

    - 方向一致(IC 与 FACTOR_DIRECTION 同号)：权重 0.6*base + 0.4*base*(1+0.8*clamp(IC))
    - 方向相反：压到 base*0.2 地板（提示因子方向可能反了）
    - 无 IC 证据：base*0.5（适度降级）
    - 最终归一化回 base 总权重（保持 100）
    """
    base = base or DEFAULT_WEIGHTS.copy()
    new: Dict[str, float] = {}
    notes: Dict[str, str] = {}
    for f, w in base.items():
        info = ic_map.get(f)
        if not info:
            new[f] = round(w * 0.5, 2)
            notes[f] = "无IC证据，权重减半"
            continue
        ic = info["ic_mean"]
        aligned = (ic * FACTOR_DIRECTION.get(f, 1)) > 0
        if aligned and abs(ic) >= 1e-6:
            mult = 1.0 + 0.8 * max(-1.0, min(1.0, ic))
            nw = w * (0.6 + 0.4 * mult)
            notes[f] = f"IC={ic:+.2f}方向一致，{w:.1f}→{nw:.1f}"
        else:
            nw = w * 0.2
            notes[f] = f"IC={ic:+.2f}方向与预期相反，压至地板 {nw:.1f}"
        new[f] = round(nw, 2)
    tot = sum(new.values())
    target = sum(base.values())
    if tot:
        new = {k: round(v / tot * target, 2) for k, v in new.items()}
    return new, notes


def save_weights(weights: Dict[str, float], meta: Dict) -> str:
    WEIGHTS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "weights": weights,
        "meta": meta,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
    WEIGHTS_CACHE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(WEIGHTS_CACHE)


def load_weights() -> Optional[Dict[str, float]]:
    if not WEIGHTS_CACHE.exists():
        return None
    try:
        data = json.loads(WEIGHTS_CACHE.read_text(encoding="utf-8"))
        ga = data.get("generated_at")
        if ga:
            age = (datetime.now() - datetime.fromisoformat(ga)).days
            if age > 7:
                return None
        return data.get("weights")
    except Exception:
        return None


def run_backtest(pool: List[str], as_of_dates: List[str],
                 windows=(5, 10, 20),
                 base: Optional[Dict[str, float]] = None,
                 save: bool = True) -> Dict:
    """回测验证闭环入口：多时点样本 → IC → 权重反哺 → 持久化。"""
    frames = []
    for d in as_of_dates:
        f = build_sample(pool, d)
        if not f.empty:
            f["as_of"] = d
            frames.append(f)
    if not frames:
        return {"ok": False, "error": "无有效回测样本（真实行情不可用或股票池为空）", "samples": 0}
    panel = pd.concat(frames, ignore_index=True)
    if len(panel) < 5:
        return {"ok": False, "error": f"有效样本仅 {len(panel)} 条，不足以估计IC", "samples": len(panel)}
    ic_map = compute_ic(panel, windows)
    new_w, notes = optimize_weights(ic_map, base)
    if save:
        save_weights(new_w, {
            "as_of_dates": as_of_dates,
            "windows": list(windows),
            "ic": ic_map,
            "notes": notes,
            "samples": int(len(panel)),
        })
    return {
        "ok": True,
        "samples": int(len(panel)),
        "ic": ic_map,
        "weights": new_w,
        "notes": notes,
        "as_of_dates": as_of_dates,
    }
