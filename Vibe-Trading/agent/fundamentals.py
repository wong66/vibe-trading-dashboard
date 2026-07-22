"""Stock fundamentals (A-share + US) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx

from .common import a_code_to_exchange, safe_float

logger = logging.getLogger(__name__)


def _safe_float(v) -> float:
    return safe_float(v, default=0.0)


async def _fetch_a_fundamentals_sina(code: str, num_periods: int = 24) -> dict:
    """Fetch A-share quarterly fundamentals from Sina."""
    prefix = a_code_to_exchange(code)
    paper = f"{prefix}{code}"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"}

    def _get(source: str) -> list[dict]:
        url = "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022"
        params = {"paperCode": paper, "source": source, "type": "0", "page": "1", "num": str(num_periods)}
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        report_list = (data.get("result", {}) or {}).get("data", {}).get("report_list", {}) or {}
        rows = []
        for period in sorted(report_list.keys(), reverse=True)[:num_periods]:
            obj = report_list[period]
            rec = {"period": f"{period[:4]}-{period[4:6]}-{period[6:8]}"}
            for it in obj.get("data", []) or []:
                title = it.get("item_title") or ""
                if not title or it.get("item_value") in (None, ""):
                    continue
                rec[title] = it.get("item_value")
            rows.append(rec)
        return rows

    lrb = await asyncio.to_thread(_get, "lrb")
    fzb = await asyncio.to_thread(_get, "fzb")
    llb = await asyncio.to_thread(_get, "llb")
    return {"lrb": lrb, "fzb": fzb, "llb": llb}


def _fetch_deducted_profit_eastmoney(code: str, num_periods: int = 24) -> dict[str, float]:
    """Fetch quarterly 扣非归母净利润 from EastMoney datacenter."""
    if code.startswith(("6", "9")):
        secucode = f"{code}.SH"
    elif code.startswith(("4", "8")):
        secucode = f"{code}.BJ"
    else:
        secucode = f"{code}.SZ"
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "reportName": "RPT_F10_FINANCE_GINCOMEQC", "columns": "ALL",
        "filter": f'(SECUCODE="{secucode}")',
        "pageNumber": "1", "pageSize": str(num_periods),
        "sortColumns": "REPORT_DATE", "sortTypes": "-1",
    }
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://emweb.securities.eastmoney.com/"}
    out: dict[str, float] = {}
    try:
        with httpx.Client(timeout=4.0) as client:
            resp = client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        for row in (data.get("result", {}) or {}).get("data", []) or []:
            rd = row.get("REPORT_DATE")
            ded = row.get("DEDUCT_PARENT_NETPROFIT")
            if rd and ded is not None:
                period = str(rd)[:10]
                try:
                    out[period] = float(ded)
                except (TypeError, ValueError):
                    continue
    except Exception as exc:
        logger.debug("EM 扣非 fetch failed for %s: %s", code, exc)
    return out


def _build_fundamentals_from_statements(
    lrb: list[dict], fzb: list[dict], llb: list[dict],
    deduct_idx: dict[str, float] | None = None,
) -> list[dict]:
    """Normalize Sina 三表 into per-period records with TTM/YoY support."""
    deduct_idx = deduct_idx or {}
    lrb_idx = {r["period"]: r for r in lrb}
    fzb_idx = {r["period"]: r for r in fzb}
    llb_idx = {r["period"]: r for r in llb}
    all_periods = sorted({*lrb_idx.keys(), *fzb_idx.keys(), *llb_idx.keys()}, reverse=True)

    def _read_row(period: str) -> dict[str, float]:
        inc = lrb_idx.get(period, {})
        cfs = llb_idx.get(period, {})
        return {
            "revenue": _safe_float(inc.get("营业总收入") or inc.get("营业收入")),
            "op_cost": _safe_float(inc.get("营业成本")),
            "net_profit": _safe_float(
                inc.get("归属于母公司所有者的净利润") or inc.get("净利润")
            ),
            "deducted_profit": (
                deduct_idx.get(period)
                if deduct_idx.get(period) is not None
                else _safe_float(inc.get("扣除非经常性损益后的净利润") or inc.get("扣非净利润"))
            ),
            "op_cashflow": _safe_float(
                cfs.get("经营活动产生的现金流量净额")
                or cfs.get("经营活动产生的现金流量净额Net_经营活动产生的现金流量净额")
            ),
            "sales_cashflow": _safe_float(
                cfs.get("销售商品提供劳务收到的现金")
                or cfs.get("销售商品、提供劳务收到的现金")
                or cfs.get("销售商品提供劳务收到的现金Net_销售商品提供劳务收到的现金")
            ),
            "sell_exp": _safe_float(inc.get("销售费用")),
            "admin_exp": _safe_float(inc.get("管理费用")),
            "rd_exp": _safe_float(inc.get("研发费用") or inc.get("研发投入")),
        }

    ytd_by_key: dict[tuple[int, int], dict[str, float]] = {}
    for p in all_periods:
        try:
            y, m, _d = p.split("-"); y, m = int(y), int(m)
        except Exception:
            continue
        if m not in (3, 6, 9, 12):
            continue
        ytd_by_key[(y, m)] = _read_row(p)

    out: list[dict] = []
    for p in all_periods:
        try:
            y, m, _d = p.split("-"); y, m = int(y), int(m)
        except Exception:
            continue
        if m not in (3, 6, 9, 12):
            continue

        bal = fzb_idx.get(p, {})
        prior_key = {3: None, 6: (y, 3), 9: (y, 6), 12: (y, 9)}[m]
        fields_yuan: dict[str, float] = {}
        for key in ("revenue", "op_cost", "net_profit", "op_cashflow",
                     "sales_cashflow", "sell_exp", "admin_exp", "rd_exp"):
            cur_ytd = ytd_by_key.get((y, m), {}).get(key)
            if cur_ytd is None:
                fields_yuan[key] = 0.0
                continue
            if prior_key is None:
                singleq = cur_ytd
            else:
                prior_ytd = ytd_by_key.get(prior_key, {}).get(key)
                singleq = (cur_ytd - prior_ytd) if prior_ytd is not None else 0.0
            fields_yuan[key] = singleq

        # deducted_profit
        em_deduct = deduct_idx.get(p)
        if em_deduct is not None:
            fields_yuan["deducted_profit"] = em_deduct
        else:
            cur_ytd = ytd_by_key.get((y, m), {}).get("deducted_profit")
            if cur_ytd is None:
                fields_yuan["deducted_profit"] = 0.0
            elif prior_key is None:
                fields_yuan["deducted_profit"] = cur_ytd
            else:
                prior_ytd = ytd_by_key.get(prior_key, {}).get("deducted_profit")
                fields_yuan["deducted_profit"] = (cur_ytd - prior_ytd) if prior_ytd is not None else 0.0

        # Convert to 亿
        rev = fields_yuan["revenue"] / 1e8
        cost = fields_yuan["op_cost"] / 1e8
        np_ = fields_yuan["net_profit"] / 1e8
        deducted = fields_yuan["deducted_profit"] / 1e8
        op_cf = fields_yuan["op_cashflow"] / 1e8
        sales_cf = fields_yuan["sales_cashflow"] / 1e8
        sell = fields_yuan["sell_exp"] / 1e8
        admin = fields_yuan["admin_exp"] / 1e8
        rd = fields_yuan["rd_exp"] / 1e8
        net_asset = _safe_float(
            bal.get("归属于母公司股东权益合计") or bal.get("所有者权益合计") or bal.get("股东权益合计")
        ) / 1e8
        ar = _safe_float(bal.get("应收账款") or bal.get("应收票据及应收账款")) / 1e8

        # Detailed BS items
        bs_cash = _safe_float(bal.get("货币资金")) / 1e8
        bs_ar = _safe_float(bal.get("应收票据及应收账款") or bal.get("应收账款")) / 1e8
        bs_prepay = _safe_float(bal.get("预付款项")) / 1e8
        bs_inventory = _safe_float(bal.get("存货")) / 1e8
        bs_other_ca = _safe_float(bal.get("其他流动资产")) / 1e8
        bs_lt_invest = _safe_float(bal.get("长期股权投资") or bal.get("其他长期投资")) / 1e8
        bs_fixed = _safe_float(
            bal.get("固定资产及清理合计") or bal.get("固定资产(合计)") or bal.get("固定资产净值")
        ) / 1e8
        bs_intangible = _safe_float(bal.get("无形资产")) / 1e8
        bs_other_nca = (
            _safe_float(bal.get("其他非流动资产")) + _safe_float(bal.get("商誉"))
            + _safe_float(bal.get("长期待摊费用")) + _safe_float(bal.get("递延所得税资产"))
        ) / 1e8
        bs_st_debt = _safe_float(
            bal.get("短期借款") or bal.get("短期借款及应付票据")
        ) / 1e8
        bs_ap = _safe_float(
            bal.get("应付票据及应付账款") or bal.get("应付账款") or bal.get("应付票据")
        ) / 1e8
        bs_contract_liab = _safe_float(bal.get("合同负债") or bal.get("预收款项")) / 1e8
        bs_salary_tax = (_safe_float(bal.get("应付职工薪酬")) + _safe_float(bal.get("应交税费"))) / 1e8
        bs_other_cl = (
            _safe_float(bal.get("其他流动负债")) + _safe_float(bal.get("应付利息"))
            + _safe_float(bal.get("应付股利"))
        ) / 1e8
        bs_lt_debt = _safe_float(bal.get("长期借款")) / 1e8
        bs_other_ncl = (
            _safe_float(bal.get("其他长期负债")) + _safe_float(bal.get("递延所得税负债"))
            + _safe_float(bal.get("长期应付款"))
        ) / 1e8

        gross_margin = (rev - cost) / rev * 100 if rev else 0.0
        net_margin = np_ / rev * 100 if rev else 0.0
        ytd_now = ytd_by_key.get((y, m), {}) or {}
        ytd_np_yuan = ytd_now.get("net_profit") or 0.0
        roe = (ytd_np_yuan / 1e8 / net_asset * 100) if net_asset else 0.0

        out.append({
            "period": p, "revenue": rev, "op_cost": cost, "net_profit": np_,
            "deducted_profit": deducted, "op_cashflow": op_cf, "sales_cashflow": sales_cf,
            "gross_margin": gross_margin, "net_margin": net_margin, "roe": roe,
            "sell_exp": sell, "admin_exp": admin, "rd_exp": rd,
            "net_asset": net_asset, "ar": ar,
            "bs_cash": bs_cash, "bs_ar": bs_ar, "bs_prepay": bs_prepay,
            "bs_inventory": bs_inventory, "bs_other_ca": bs_other_ca,
            "bs_lt_invest": bs_lt_invest, "bs_fixed": bs_fixed,
            "bs_intangible": bs_intangible, "bs_other_nca": bs_other_nca,
            "bs_st_debt": bs_st_debt, "bs_ap": bs_ap, "bs_contract_liab": bs_contract_liab,
            "bs_salary_tax": bs_salary_tax, "bs_other_cl": bs_other_cl,
            "bs_lt_debt": bs_lt_debt, "bs_other_ncl": bs_other_ncl,
        })
    return out


def _build_ttm_yoy(periods: list[dict]) -> list[dict]:
    """Compute TTM trailing 4-quarter sum and YoY% for key metrics."""
    fields = ("revenue", "op_cost", "net_profit", "deducted_profit", "op_cashflow",
              "sales_cashflow", "sell_exp", "admin_exp", "rd_exp")

    def win_sum(i: int, key: str) -> tuple[float, bool]:
        total = 0.0
        ok = True
        for j in range(i, i + 4):
            if j >= len(periods):
                ok = False; break
            v = periods[j].get(key)
            if v is None:
                ok = False; break
            total += float(v or 0.0)
        return total, ok

    for i, row in enumerate(periods):
        ttm: dict[str, float] = {}
        cur_ok = prior_ok = True
        for key in fields:
            cur, c_ok = win_sum(i, key)
            pri, p_ok = win_sum(i + 4, key)
            cur_ok = cur_ok and c_ok
            prior_ok = prior_ok and p_ok
            ttm[key] = round(cur, 4) if c_ok else None
            if c_ok and p_ok and pri:
                row[f"{key}_yoy"] = round((cur - pri) / abs(pri) * 100, 2)
            else:
                row[f"{key}_yoy"] = None
        row["ttm"] = ttm
        row["ttm_window"] = cur_ok and prior_ok
    return periods


def _apply_ttm_margins(periods: list[dict]) -> list[dict]:
    """Recalculate gross_margin / net_margin / ROE using TTM values."""
    for row in periods:
        ttm = row.get("ttm") or {}
        rev = ttm.get("revenue")
        cost = ttm.get("op_cost")
        np_ = ttm.get("net_profit")
        na = row.get("net_asset") or 0
        if rev and cost is not None and np_ is not None and rev > 0:
            row["gross_margin"] = round((rev - cost) / rev * 100, 2)
            row["net_margin"] = round(np_ / rev * 100, 2)
        if np_ is not None and na > 0:
            row["roe"] = round(np_ / na * 100, 2)
    return periods


def _build_business_segments_a(code: str, period: str | None = None) -> dict:
    """Pull business segments from EastMoney hsf10."""
    if code.startswith(("6", "9")):
        secucode = f"{code}.SH"
    elif code.startswith(("4", "8")):
        secucode = f"{code}.BJ"
    else:
        secucode = f"{code}.SZ"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://emweb.securities.eastmoney.com/"}
    url = "https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax"
    empty = {"periods": [], "current": "", "by_industry": [], "by_product": [], "by_region": [], "by_region_series": []}

    try:
        with httpx.Client(timeout=4.0, trust_env=False) as client:
            resp = client.get(url, params={"code": secucode}, headers=headers)
            if resp.status_code != 200:
                return empty
            data = resp.json() or {}
    except Exception as exc:
        logger.warning("business segments fetch failed for %s: %s", code, exc)
        return empty

    segs = data.get("zygcfx") or []
    if not segs:
        return empty

    periods = sorted({s["REPORT_DATE"][:10] for s in segs if s.get("REPORT_DATE")}, reverse=True)
    cur = period if period in periods else (periods[0] if periods else "")

    def _group(type_code: str) -> list[dict]:
        out: dict[str, float] = {}
        cost: dict[str, float] = {}
        for s in segs:
            if s.get("MAINOP_TYPE") != type_code or s["REPORT_DATE"][:10] != cur:
                continue
            name = s.get("ITEM_NAME") or "其他"
            try:
                inc = float(s.get("MAIN_BUSINESS_INCOME") or 0) / 1e8
            except (TypeError, ValueError):
                inc = 0.0
            try:
                cost_v = float(s.get("MAIN_BUSINESS_COST") or 0) / 1e8
            except (TypeError, ValueError):
                cost_v = 0.0
            out[name] = out.get(name, 0.0) + inc
            cost[name] = cost.get(name, 0.0) + cost_v
        total = sum(out.values()) or 1.0
        rows = [
            {"name": k, "value": round(v, 3), "ratio": round(v / total * 100, 2),
             "cost": round(cost.get(k, 0.0), 3), "gross_profit": round(v - cost.get(k, 0.0), 3)}
            for k, v in out.items()
        ]
        rows.sort(key=lambda r: r["value"], reverse=True)
        return rows

    return {
        "periods": periods, "current": cur,
        "by_industry": _group("1"), "by_product": _group("2"), "by_region": _group("3"),
        "by_region_series": _region_series_ttm(segs, type_code="3"),
    }


def _region_series_ttm(segs: list[dict], type_code: str) -> list[dict]:
    """Aggregate region segments with TTM (rolling 12-month) values."""
    name_total: dict[tuple[str, str], float] = {}
    for s in segs:
        if s.get("MAINOP_TYPE") != type_code or not s.get("REPORT_DATE"):
            continue
        p = s["REPORT_DATE"][:10]
        n = s.get("ITEM_NAME") or "其他"
        try:
            v = float(s.get("MAIN_BUSINESS_INCOME") or 0) / 1e8
        except (TypeError, ValueError):
            v = 0.0
        name_total[(p, n)] = name_total.get((p, n), 0.0) + v

    by_name: dict[str, list[tuple[str, float]]] = {}
    for (p, n), v in name_total.items():
        if v <= 0:
            continue
        by_name.setdefault(n, []).append((p, v))
    for pts in by_name.values():
        pts.sort(key=lambda x: x[0])

    out = []
    for name, pts in by_name.items():
        period_vals = {p: v for p, v in pts}
        for period in sorted(period_vals.keys()):
            cur = period_vals[period]
            y, m, d = int(period[:4]), int(period[5:7]), int(period[8:10])
            prev_annual = period_vals.get(f"{y-1}-12-31")
            prev_same = period_vals.get(f"{y-1}-{m:02d}-{d:02d}")
            if prev_annual is not None and prev_same is not None:
                ttm = cur + prev_annual - prev_same
            elif m == 12 and d == 31:
                ttm = cur
            else:
                ttm = cur
            out.append({"period": period, "name": name, "value": round(ttm, 3)})

    out.sort(key=lambda r: (r["period"], r["name"]), reverse=True)
    return out


def _fetch_us_fundamentals_yfinance(code: str) -> dict:
    """US quarterly fundamentals (income + balance + cashflow) via yfinance."""
    import yfinance as yf
    sym = code.upper().replace(".US", "")

    def _df_to_records(df) -> list[dict]:
        records = []
        if df is None or df.empty:
            return records
        for idx, row in df.iterrows():
            d = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            rec = {"period": d}
            rec.update({k: (None if (isinstance(v, float) and (v != v)) else float(v) if isinstance(v, (int, float)) else v) for k, v in row.to_dict().items()})
            records.append(rec)
        return records

    t = yf.Ticker(sym)
    try:
        inc_df = t.quarterly_income_stmt
        bal_df = t.quarterly_balance_sheet
        cfs_df = t.quarterly_cashflow
    except Exception:
        inc_df = bal_df = cfs_df = None

    def _col(row: dict, *names) -> float:
        for n in names:
            if n in row and row[n] is not None:
                return _safe_float(row[n])
        return 0.0

    by_period: dict[str, dict] = {}
    for r in _df_to_records(inc_df):
        p = r["period"]; rec = by_period.setdefault(p, {"period": p})
        rec["revenue"] = _col(r, "Total Revenue", "Operating Revenue")
        rec["op_cost"] = _col(r, "Cost Of Revenue", "Reconciled Cost Of Revenue")
        rec["net_profit"] = _col(r, "Net Income", "Net Income Common Stockholders")
        rec["deducted_profit"] = _col(r, "Net Income From Continuing Operation Net Minority Interest", "Net Income")
        rec["sell_exp"] = _col(r, "Selling General And Administration", "Selling And Marketing Expense")
        rec["admin_exp"] = _col(r, "General And Administrative Expense")
        rec["rd_exp"] = _col(r, "Research And Development")
    for r in _df_to_records(bal_df):
        p = r["period"]; rec = by_period.setdefault(p, {"period": p})
        rec["net_asset"] = _col(r, "Stockholders Equity", "Total Equity Gross Minority Interest")
        rec["ar"] = _col(r, "Accounts Receivable", "Receivables")
    for r in _df_to_records(cfs_df):
        p = r["period"]; rec = by_period.setdefault(p, {"period": p})
        rec["op_cashflow"] = _col(r, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")

    out = []
    for p, rec in sorted(by_period.items(), reverse=True):
        rev = rec.get("revenue", 0); np_ = rec.get("net_profit", 0)
        cost = rec.get("op_cost", 0); na = rec.get("net_asset", 0)
        rec["gross_margin"] = (rev - cost) / rev * 100 if rev else 0.0
        rec["net_margin"] = np_ / rev * 100 if rev else 0.0
        rec["roe"] = (np_ * 4) / na * 100 if na else 0.0
        out.append(rec)
    return {"periods": out}
