"""复盘雷达 — 5 面板数据装配。

面板：0=策略信号(纯规则合成) | 1=行业轮动(东财+同花顺) | 2=题材归因(ths getharden)
      3=涨停归因(连板推导) | 4=涨停打板(家数/最高板/炸板估算)。
原则：单面板容错、不做假数据、连板真实推导、炸板标估算。
"""
from __future__ import annotations
import math
import ssl
import time
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
import os
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup
from .signal_engine import em_get, ths_hot_reason, industry_comparison, tencent_batch_quote, UA

from .review_common import (
    _fmt_yi, _fmt_pct, _parse_themes, _parse_kv_lines, _invoke_with_retry,
    _fetch_realtime_quotes, _samples_for_theme, _theme_heat_from_stocks,
    _build_theme_top_picks, _fetch_financials_concurrent, _harden_codes,
    _prior_trading_days, _compute_boards, _estimate_blast, _board_ladder,
    _board_label, _calc_buy_stop, _is_20cm,
)
from .review_sectors import sector_capital_flow, _ths_fund_flow, _ths_sector_ranking
from .review_serenity import (
    _generate_all_evidence, _generate_serenity_picks, _generate_serenity_scorecards,
)
from .review_themes import _generate_theme_reasons, _minimal_theme_attribution
from .review_trade import _calc_trade_params, _classify_market_temp

_CACHE: Dict[str, Any] = {"ts": 0.0, "date": None, "data": None}
_CACHE_TTL = 300.0  # 5 分钟
_REVIEW_CACHE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".cache", "review_panels_cache.json",
)
_BUILD_TIMEOUT = 180.0  # 题材归因 Top3 + 新浪财报并发 + LLM 证据，整轮约 40~90s
def _load_file_cache(date_str):
    try:
        if os.path.exists(_REVIEW_CACHE_FILE):
            with open(_REVIEW_CACHE_FILE, "r", encoding="utf-8") as f:
                c = json.load(f)
            if c.get("date") == date_str:
                return c.get("data")
    except Exception:
        pass
    return None
def _save_file_cache(date_str, data):
    try:
        d = os.path.dirname(_REVIEW_CACHE_FILE)
        os.makedirs(d, exist_ok=True)
        with open(_REVIEW_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"date": date_str, "data": data}, f, ensure_ascii=False)
    except Exception:
        pass
_LLM_CACHE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".cache", "review_llm_cache.json",
)
def _load_llm_cache(date_str: str) -> Optional[Dict[str, Any]]:
    """读取当日 LLM 缓存。返回 {theme_reasons, evidence, serenity_picks, serenity_scorecards} 或 None。"""
    try:
        if os.path.exists(_LLM_CACHE_FILE):
            with open(_LLM_CACHE_FILE, "r", encoding="utf-8") as f:
                c = json.load(f)
            if c.get("date") == date_str:
                return c.get("llm_data")
    except Exception:
        pass
    return None
def _save_llm_cache(date_str: str, llm_data: Dict[str, Any]) -> None:
    """写入当日 LLM 产物缓存。"""
    try:
        d = os.path.dirname(_LLM_CACHE_FILE)
        os.makedirs(d, exist_ok=True)
        with open(_LLM_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"date": date_str, "llm_data": llm_data}, f, ensure_ascii=False)
    except Exception:
        pass
_force_refresh_llm: bool = False
def _build_with_strategy(date, force_llm=False):
    data = _build(date, force_llm=force_llm)
    try:
        data["strategy_suggestions"] = synthesize_strategies(data)
    except Exception:
        data["strategy_suggestions"] = {
            "available": False, "strategies": [], "risk_alerts": [],
            "note": "策略合成失败（不影响其他面板）",
        }
    return data
_bg_lock = threading.Lock()
_bg_building: Dict[str, bool] = {}
def _background_build(date):
    global _CACHE
    key = date or _now_str()
    force = _force_refresh_llm
    try:
        data = _build_with_strategy(date, force_llm=force)
        now = time.time()
        _CACHE = {"ts": now, "date": key, "data": data}
        _save_file_cache(key, data)
    except Exception:
        pass
    finally:
        with _bg_lock:
            _bg_building[key] = False
def _trigger_background_build(date):
    key = date or _now_str()
    with _bg_lock:
        if _bg_building.get(key):
            return
        _bg_building[key] = True
    threading.Thread(target=_background_build, args=(date,), daemon=True).start()
def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")
def _build(date: Optional[str] = None, force_llm: bool = False) -> Dict[str, Any]:
    date = date or _now_str()
    result: Dict[str, Any] = {"date": date}

    llm_cache = None if force_llm else _load_llm_cache(date)
    llm_cache = llm_cache or {}  # 部分命中时用已有部分

    _stocks_for_sector: List[Dict[str, Any]] = []
    try:
        df0 = ths_hot_reason(date)
        if df0 is not None and not getattr(df0, "empty", True):
            for _, row in df0.iterrows():
                reason0 = row.get("reason", "") or ""
                _stocks_for_sector.append({
                    "code": str(row.get("code", "")),
                    "name": row.get("name", ""),
                    "reason": reason0,
                    "themes": _parse_themes(reason0),
                    "change_pct": None,  # 后续统一补充
                })
    except Exception:
        pass

    top_gain = []
    capital = []
    industry_total = 0
    try:
        capital, industry_total = _ths_fund_flow(15)
    except Exception:
        capital = []
    try:
        with ThreadPoolExecutor(max_workers=1) as _ex:
            industries = _ex.submit(industry_comparison).result(timeout=8) or []
    except Exception:
        industries = []

    # 涨幅最大行业：同花顺行情页（含真实涨跌家数/领涨股），东财 fallback
    top_gain = _ths_sector_ranking(15)
    if not top_gain:
        top_gain = industries[:15] if industries else []

    if _stocks_for_sector:
        theme_heat = _theme_heat_from_stocks(_stocks_for_sector, top_n=15)
        result["sector_rotation"] = {
            "available": True,
            "source": "ths",
            "top_gain": top_gain,
            "capital_inflow": capital,  # 同花顺真实净额
            "total_industries": industry_total or len(industries),
            "theme_heat": theme_heat,
        }
    else:
        result["sector_rotation"] = {
            "available": False,
            "source": "none",
            "top_gain": [],
            "capital_inflow": [],
            "total_industries": 0,
        }

    stocks: List[Dict[str, Any]] = []
    theme_counter: Counter = Counter()
    if _stocks_for_sector:
        try:
            df_full = ths_hot_reason(date)
            has_zf = df_full is not None and "zhangfu" in df_full.columns
            zf_map: Dict[str, Any] = {}
            if has_zf and df_full is not None:
                for _, row in df_full.iterrows():
                    c = str(row.get("code", ""))
                    zf = row.get("zhangfu")
                    if zf is not None and zf == zf:
                        try:
                            zf_map[c] = round(float(zf), 2)
                        except (TypeError, ValueError):
                            pass
        except Exception:
            has_zf = False
            zf_map = {}

        for s in _stocks_for_sector:
            s["change_pct"] = zf_map.get(s["code"])
            for t in s.get("themes", []):
                theme_counter[t] += 1
        stocks = _stocks_for_sector
    else:
        try:
            df = ths_hot_reason(date)
            if df is None or getattr(df, "empty", True):
                raise ValueError("empty")
            has_zf = "zhangfu" in df.columns
            for _, row in df.iterrows():
                code = str(row.get("code", ""))
                reason = row.get("reason", "") or ""
                themes = _parse_themes(reason)
                for t in themes:
                    theme_counter[t] += 1
                zf = row.get("zhangfu") if has_zf else None
                zf_val = None
                if zf is not None and zf == zf and not (isinstance(zf, float) and math.isnan(zf)):
                    try:
                        zf_val = round(float(zf), 2)
                    except (TypeError, ValueError):
                        zf_val = None
                stocks.append({
                    "code": code,
                    "name": row.get("name", ""),
                    "reason": reason,
                    "themes": themes,
                    "change_pct": zf_val,
                })
        except Exception:
            stocks = []
            theme_counter = Counter()

    theme_items = [
        {"theme": t, "count": c, "samples": _samples_for_theme(stocks, t)}
        for t, c in theme_counter.most_common(20)
    ]
    theme_reasons = llm_cache.get("theme_reasons")
    if theme_reasons is None or force_llm:
        theme_reasons = _generate_theme_reasons(theme_items, date_str=date)
        llm_cache["theme_reasons"] = theme_reasons or {}
    else:
        theme_reasons = theme_reasons or {}
    for item in theme_items:
        item["reason"] = theme_reasons.get(item["theme"], "")
    result["theme_attribution"] = {
        "available": bool(stocks),
        "themes": theme_items,
        "stocks": stocks,
        "note": "同花顺 getharden 涨停/强势股题材标签（盘中仅题材，收盘含涨幅）",
    }

    try:
        boards = _compute_boards([s["code"] for s in stocks], date, lookback=7)
    except Exception:
        boards = {s["code"]: 1 for s in stocks}

    for s in stocks:
        s["boards"] = boards.get(s["code"], 1)

    if stocks:
        try:
            quotes = _fetch_realtime_quotes([s["code"] for s in stocks])
            for s in stocks:
                q = quotes.get(s["code"], {})
                s["price"] = q.get("price")
                s["realtime_pct"] = q.get("change_pct")
        except Exception:
            for s in stocks:
                s.setdefault("price", None)
                s.setdefault("realtime_pct", None)

    if stocks:
        theme_members_cache: Dict[str, List[Dict[str, Any]]] = {}
        for item in theme_items:
            members = theme_members_cache.get(item["theme"])
            if members is None:
                members = [s for s in stocks if item["theme"] in s.get("themes", [])]
                theme_members_cache[item["theme"]] = members
            item["top_picks"] = _build_theme_top_picks(item["theme"], members, top_n=3)
        all_codes = []
        for it in theme_items:
            for p in it.get("top_picks", []):
                if p["code"] not in all_codes:
                    all_codes.append(p["code"])
        fin_map = _fetch_financials_concurrent(all_codes)
        for it in theme_items:
            for p in it.get("top_picks", []):
                p["fin"] = fin_map.get(p["code"])
        try:
            all_ev = llm_cache.get("theme_evidence")
            if all_ev is None or force_llm:
                all_ev = _generate_all_evidence(
                    {it["theme"]: it.get("top_picks", []) for it in theme_items}
                )
                llm_cache["theme_evidence"] = all_ev or {}
            else:
                all_ev = all_ev or {}
            for it in theme_items:
                ev_map = all_ev.get(it["theme"], {})
                for p in it.get("top_picks", []):
                    p["evidence"] = ev_map.get(p["code"], "")
        except Exception:
            pass  # 证据缺失不影响面板

    if theme_items:
        try:
            serenity_raw = llm_cache.get("serenity_picks")
            if serenity_raw is None or force_llm:
                serenity_raw = _generate_serenity_picks(theme_items)
                llm_cache["serenity_picks"] = serenity_raw or {}
            else:
                serenity_raw = serenity_raw or {}
            if serenity_raw:
                sr_all_codes: List[str] = []
                for it in theme_items:
                    sp = serenity_raw.get(it["theme"], [])
                    it["serenity_picks"] = []
                    for s in sp[:3]:
                        if s["code"] not in sr_all_codes:
                            sr_all_codes.append(s["code"])
                        it["serenity_picks"].append({
                            "code": s["code"],
                            "name": s["name"],
                            "price": None,
                            "change_pct": None,
                            "fin": None,
                            "evidence": "",
                            "buy": {"note": "等待开板回踩再介入", "buy_low": None, "buy_high": None, "stop_loss": None},
                        })
                if sr_all_codes:
                    try:
                        existing_codes = {s["code"] for s in stocks}
                        need_quotes = [c for c in sr_all_codes if c not in existing_codes]
                        if need_quotes:
                            sq = _fetch_realtime_quotes(need_quotes)
                        else:
                            sq = {}
                        stock_quote_map = {s["code"]: {"price": s.get("price"), "change_pct": s.get("realtime_pct") or s.get("change_pct")} for s in stocks}
                        for it in theme_items:
                            for p in it.get("serenity_picks", []):
                                c = p["code"]
                                if c in stock_quote_map:
                                    p["price"] = stock_quote_map[c]["price"]
                                    p["change_pct"] = stock_quote_map[c]["change_pct"]
                                elif c in sq:
                                    q = sq[c]
                                    p["price"] = q.get("price")
                                    p["change_pct"] = q.get("change_pct")
                    except Exception:
                        pass
                sr_fin_map = _fetch_financials_concurrent(sr_all_codes)
                for it in theme_items:
                    for p in it.get("serenity_picks", []):
                        p["fin"] = sr_fin_map.get(p["code"])
                        price = p.get("price")
                        cp = p.get("change_pct")
                        if price is not None and cp is not None:
                            p["buy"] = _calc_buy_stop(price, cp)
                sr_theme_picks = {
                    it["theme"]: it.get("serenity_picks", [])
                    for it in theme_items
                    if it.get("serenity_picks")
                }
                if sr_theme_picks:
                    try:
                        sr_ev = llm_cache.get("serenity_evidence")
                        if sr_ev is None or force_llm:
                            sr_ev = _generate_all_evidence(sr_theme_picks)
                            llm_cache["serenity_evidence"] = sr_ev or {}
                        else:
                            sr_ev = sr_ev or {}
                        for it in theme_items:
                            ev_m = sr_ev.get(it["theme"], {})
                            for p in it.get("serenity_picks", []):
                                p["evidence"] = ev_m.get(p["code"], "")
                    except Exception:
                        pass
                sr_fin_theme_picks = {
                    it["theme"]: [p for p in it.get("serenity_picks", []) if p.get("fin")]
                    for it in theme_items
                    if it.get("serenity_picks")
                }
                if any(v for v in sr_fin_theme_picks.values()):
                    try:
                        sr_sc = llm_cache.get("serenity_scorecards")
                        if sr_sc is None or force_llm:
                            sr_sc = _generate_serenity_scorecards(sr_fin_theme_picks)
                            llm_cache["serenity_scorecards"] = sr_sc or {}
                        else:
                            sr_sc = sr_sc or {}
                        for it in theme_items:
                            sc_m = sr_sc.get(it["theme"], {})
                            for p in it.get("serenity_picks", []):
                                p["serenity_analysis"] = sc_m.get(p["code"], "")
                    except Exception:
                        pass
        except Exception:
            import logging
            logging.getLogger(__name__).warning("serenity picks generation failed", exc_info=True)

    lu_theme_counter: Counter = Counter()
    for s in stocks:
        for t in s.get("themes", []):
            lu_theme_counter[t] += 1
    theme_summary = [{"theme": t, "count": c} for t, c in lu_theme_counter.most_common(15)]

    max_board = max(boards.values()) if boards else 0

    try:
        bi = _estimate_blast()
        blast = bi["blast"]
        scanned = bi["scanned"]
        limitup = len(stocks)
        if scanned and (limitup + blast):
            blast_rate = round(blast / (limitup + blast) * 100, 1)
        else:
            blast = None
            blast_rate = None
    except Exception:
        blast = None
        blast_rate = None

    result["limitup_attribution"] = {
        "available": bool(stocks),
        "stocks": stocks,
        "theme_summary": theme_summary,
        "max_board": max_board,
    }
    result["limitup_board"] = {
        "available": bool(stocks),
        "limitup_count": len(stocks),
        "max_board": max_board,
        "blast_count": blast,
        "blast_rate": blast_rate,
        "board_ladder": _board_ladder(boards),
        "note": "炸板率为估算：东财全A收盘涨幅 [9.5%, 9.95%) 近似炸板（主板/创业 10% 限制）",
    }
    if llm_cache:
        _save_llm_cache(date, llm_cache)
    return result
def synthesize_strategies(panels: Dict[str, Any]) -> Dict[str, Any]:
    """设计原则（与项目一致）： """

    sr = panels.get("sector_rotation") or {}
    la = panels.get("limitup_attribution") or {}
    lb = panels.get("limitup_board") or {}

    strategies: List[Dict[str, Any]] = []
    risk_alerts: List[Dict[str, str]] = []

    mkt = _classify_market_temp(lb, sr)

    limit_stocks = la.get("stocks") or []
    def _is_st(name: str) -> bool:
        return bool(name) and (name.startswith("ST") or name.startswith("*ST"))
    eff_stocks = [s for s in limit_stocks if not _is_st(s.get("name", ""))]
    theme_counter: Counter = Counter()
    for s in eff_stocks:
        for t in s.get("themes", []):
            theme_counter[t] += 1

    top_gain_names = set(i.get("name", "") for i in (sr.get("top_gain") or []))
    inflow_names = set(c.get("name", "") for c in (sr.get("capital_inflow") or []))
    outflow = [c for c in (sr.get("capital_inflow") or []) if (c.get("main_net_yi") or 0) < 0]

    def stocks_of_theme(theme: str) -> List[Dict[str, Any]]:
        return [s for s in eff_stocks if theme in s.get("themes", [])]

    def sector_resonance(theme: str) -> Optional[str]:
        """题材名是否出现在行业涨幅榜/资金流入榜（模糊包含匹配）。"""
        for nm in (top_gain_names | inflow_names):
            if not nm:
                continue
            if theme in nm or nm in theme:
                return nm
        return None

    for theme, count in theme_counter.most_common():
        if count < 2:
            continue  # 单票题材置信度不足，跳过
        stocks = stocks_of_theme(theme)
        board_list = [s.get("boards", 1) for s in stocks]
        max_b = max(board_list) if board_list else 1
        has_high_board = max_b >= 3
        pcts = [s.get("change_pct") for s in stocks if isinstance(s.get("change_pct"), (int, float))]
        avg = round(sum(pcts) / len(pcts), 2) if pcts else None
        res = sector_resonance(theme)

        if has_high_board:
            raw_conf = "高" if (count >= 3 and res) else ("中" if (count >= 3 or res) else "低")
            conf = mkt["adjust"](raw_conf)  # ← 情绪周期降级
            rationale_parts = [
                f"题材出现 {count} 只涨停股且已走出 {_board_label(max_b)}",
            ]
            if res:
                rationale_parts.append(f"行业「{res}」同步走强/资金流入")
            if avg is not None:
                rationale_parts.append(f"板块平均涨幅 {avg}%")
            if mkt["cycle"] in ("退潮", "冰点"):
                rationale_parts.append(f"[⚠️{mkt['cycle']}期，置信度已下调]")
            rationale = "，".join(rationale_parts) + "。主线确认。" if res else "，".join(rationale_parts) + "。连板支撑较强。"
            enriched_stocks = []
            for s in stocks:
                tp = _calc_trade_params(s, "主线延续", s.get("boards", 1))
                enriched_stocks.append({
                    "code": s["code"], "name": s["name"],
                    "price": s.get("price"),
                    **tp,
                })
            strategies.append({
                "type": "主线延续",
                "title": f"{theme}（{count}只涨停 · 最高{_board_label(max_b)}）",
                "confidence": conf,
                "rationale": rationale,
                "action": "持有关注 / 分歧低吸",
                "trade_logic": enriched_stocks[0]["params_note"] if enriched_stocks else "",
                "stocks": enriched_stocks,
            })
        else:
            raw_conf = "中" if (count >= 3 or res) else "低"
            conf = mkt["adjust"](raw_conf)
            rationale_parts = [
                f"题材出现 {count} 只涨停股但最高仅 {_board_label(max_b)}，属启动初期",
            ]
            if res:
                rationale_parts.append(f"且行业「{res}」资金流入共振")
            if mkt["cycle"] in ("退潮", "冰点"):
                rationale_parts.append(f"[⚠️{mkt['cycle']}]")
            rationale_parts.append("可试仓埋伏等待高板确认")
            rationale = "，".join(rationale_parts) + "。"
            enriched_stocks = []
            for s in stocks:
                if s.get("boards", 1) != 1:
                    continue
                tp = _calc_trade_params(s, "题材埋伏", 1)
                enriched_stocks.append({
                    "code": s["code"], "name": s["name"],
                    "price": s.get("price"),
                    **tp,
                })
            strategies.append({
                "type": "题材埋伏",
                "title": f"{theme}（{count}只首板 · 未见高板）",
                "confidence": conf,
                "rationale": rationale,
                "action": "试仓埋伏",
                "trade_logic": enriched_stocks[0]["params_note"] if enriched_stocks else "",
                "stocks": enriched_stocks,
            })

    max_board = lb.get("max_board") or 0
    ladder = lb.get("board_ladder") or []
    if limit_stocks and max_board >= 3:
        relay_stocks = [s for s in eff_stocks if s.get("boards", 1) >= 2]
        raw_conf = "高" if max_board >= 5 else "中"
        conf = mkt["adjust"](raw_conf)
        ladder_txt = " · ".join(
            f"{_board_label(b['board'])}{b['count']}家" for b in ladder[:4]
        )
        rationale = (
            f"市场连板高度达 {_board_label(max_board)}，连板梯队完整[{ladder_txt}]，"
            f"处于{mkt['cycle']}期（评分{mkt['score']}），可关注高位换手回封与 N+1 板接力。"
        )
        enriched_relay = []
        for s in relay_stocks:
            tp = _calc_trade_params(s, "连板接力", s.get("boards", 1))
            enriched_relay.append({
                "code": s["code"], "name": s["name"],
                "price": s.get("price"),
                **tp,
            })
        strategies.append({
            "type": "连板接力",
            "title": f"情绪{'上行' if mkt['cycle']=='上行' else mkt['cycle']}：最高{_board_label(max_board)} · 梯队 [{ladder_txt}]",
            "confidence": conf,
            "rationale": rationale,
            "action": "关注 N+1 板接力",
            "trade_logic": enriched_relay[0]["params_note"] if enriched_relay else "",
            "stocks": enriched_relay,
        })
    elif eff_stocks and max_board <= 1:
        risk_alerts.append({
            "level": "中",
            "text": (
                f"连板高度仅 {_board_label(max_board)}，涨停家数 {lb.get('limitup_count', 0)}，"
                f"市场处于{mkt['cycle']}期（评分{mkt['score']}），追高性价比低，宜等待高度打开。"
            ),
        })

    blast_rate = lb.get("blast_rate")
    if blast_rate is not None and blast_rate >= 30:
        level = "高" if blast_rate >= 40 else "中"
        risk_alerts.append({
            "level": level,
            "text": (
                f"炸板率 {blast_rate}%（估算）偏高，打板亏钱效应显现，"
                "谨慎追高、注意炸板回落与封单质量。"
            ),
        })
    for c in outflow[:3]:
        nm = c.get("name", "")
        yi = abs(c.get("main_net_yi", 0) or 0)
        risk_alerts.append({
            "level": "中",
            "text": f"行业「{nm}」主力净流出 {yi} 亿，资金出逃，短期规避。",
        })

    available = bool(strategies) or bool(risk_alerts)
    return {
        "available": available,
        "market_temp": {
            "cycle": mkt["cycle"],
            "score": mkt["score"],
            "desc": mkt["desc"],
        },
        "strategies": strategies[:8],
        "risk_alerts": risk_alerts[:6],
        "note": (
            f"策略由现有 4 面板纯规则合成（行业轮动 × 题材归因 × 涨停打板）。"
            f"当前市场周期：{mkt['cycle']}（评分{mkt['score']}/100），"
            "非投资建议；盘中题材数据不含涨幅时置信度已下调。"
        ),
    }
def build_review_panels(date: Optional[str] = None, force_refresh: bool = False) -> Dict[str, Any]:
    """关键：行业轮动三列（题材热度 + 资金流）由同花顺秒级获取并作为兜底， """

    global _force_refresh_llm
    _force_refresh_llm = force_refresh
    global _CACHE
    now = time.time()
    cache_date = date or _now_str()
    if (
        _CACHE["data"] is not None
        and _CACHE["date"] == cache_date
        and now - _CACHE["ts"] < _CACHE_TTL
    ):
        return _CACHE["data"]

    quick_sr = {
        "available": False, "source": "ths", "top_gain": [],
        "capital_inflow": [], "total_industries": 0, "theme_heat": [],
    }
    try:
        _df = ths_hot_reason(cache_date)
        _stocks = []
        if _df is not None and not getattr(_df, "empty", True):
            for _, _row in _df.iterrows():
                _r = _row.get("reason", "") or ""
                _stocks.append({
                    "code": str(_row.get("code", "")), "name": _row.get("name", ""),
                    "themes": _parse_themes(_r),
                })
        if _stocks:
            quick_sr["theme_heat"] = _theme_heat_from_stocks(_stocks, top_n=15)
            quick_sr["available"] = True
        try:
            _cap, _tot = _ths_fund_flow(15)
            quick_sr["capital_inflow"] = _cap
            quick_sr["total_industries"] = _tot or 0
        except Exception:
            pass
    except Exception:
        pass

    cached = _load_file_cache(cache_date)
    if cached is not None:
        ta = cached.get("theme_attribution", {})
        if ta.get("available") and ta.get("themes"):
            _trigger_background_build(cache_date)
            c = dict(cached)
            c["stale"] = True
            return c

    _trigger_background_build(cache_date)
    if quick_sr["theme_heat"] or quick_sr["capital_inflow"]:
        return {
            "date": cache_date, "stale": True, "building": True,
            "sector_rotation": quick_sr,
            "theme_attribution": _minimal_theme_attribution(_stocks),
            "limitup_attribution": {"available": False},
            "limitup_board": {"available": False},
            "strategy_suggestions": {"available": False, "strategies": [], "risk_alerts": []},
        }

    return {
        "date": cache_date, "stale": True, "building": True,
        "sector_rotation": {"available": False, "source": "error", "theme_heat": [], "capital_inflow": []},
        "theme_attribution": {"available": False, "building": True},
        "limitup_attribution": {"available": False},
        "limitup_board": {"available": False},
        "strategy_suggestions": {"available": False, "strategies": [], "risk_alerts": []},
    }
