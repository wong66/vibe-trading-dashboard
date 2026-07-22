"""复盘雷达 — 板块资金流（同花顺行业资金流数据中心，真实净额）。

取数逻辑与 Vibe-Research 的每日复盘完全一致：
akshare.stock_fund_flow_industry(symbol="即时") 底层即访问
data.10jqka.com.cn/funds/hyzjl/ （同花顺行业资金流数据中心），取「净额」列
= 行业全部资金净流入（流入−流出，单位亿元）。

本文件用 node 运行 akshare 内置的 ths.js 生成 hexin-v token（等价于 akshare
用 MiniRacer 跑同一份 JS），绕开 py_mini_racer 在 Python 3.12 上的原生库崩溃。
"""

from __future__ import annotations
from typing import List, Dict, Tuple, Any
import os
import time
import shutil
import subprocess
import requests
from bs4 import BeautifulSoup
from .signal_engine import em_get, UA

# node 候选路径：优先 PATH，其次常见安装位置 + nvm
_NODE_CANDIDATES = [
    "node",
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
    os.path.expanduser("~/.workbuddy/binaries/node/versions/22.22.2/bin/node"),
]

_HEXIN_V_CACHE: Dict[str, Any] = {"v": None, "ts": 0.0}
_HEXIN_V_TTL = 600  # 10 分钟内复用同一 token


def _find_node() -> str | None:
    for cand in _NODE_CANDIDATES:
        if cand == "node":
            p = shutil.which("node")
            if p:
                return p
        elif os.path.exists(cand) and os.access(cand, os.X_OK):
            return cand
    # nvm 安装的 node
    nvm_dir = os.path.expanduser("~/.nvm/versions/node")
    if os.path.isdir(nvm_dir):
        for ver in sorted(os.listdir(nvm_dir), reverse=True):
            p = os.path.join(nvm_dir, ver, "bin", "node")
            if os.path.exists(p) and os.access(p, os.X_OK):
                return p
    return None


def _get_hexin_v() -> str:
    """用 node 跑 akshare 内置 ths.js 生成 hexin-v token（同 akshare 的 MiniRacer 逻辑）。"""
    now = time.time()
    if _HEXIN_V_CACHE["v"] and now - _HEXIN_V_CACHE["ts"] < _HEXIN_V_TTL:
        return _HEXIN_V_CACHE["v"]

    node = _find_node()
    if not node:
        raise RuntimeError("node 不可用，无法生成同花顺 token")

    ths_js = ""
    try:
        import akshare as ak  # 复用 akshare 自带的 ths.js
        ths_js = os.path.join(os.path.dirname(ak.__file__), "data", "ths.js")
    except Exception:
        pass
    if not ths_js or not os.path.exists(ths_js):
        # 兜底：直接用本项目 venv 内的 akshare
        ths_js = os.path.join(
            os.path.dirname(__file__), "..", "..", ".venv", "lib",
            "python3.12", "site-packages", "akshare", "data", "ths.js",
        )
    if not os.path.exists(ths_js):
        raise RuntimeError("ths.js 未找到，无法生成 token")

    code = "const fs=require('fs');const s=fs.readFileSync(%r,'utf8');eval(s);console.log(v());" % ths_js
    out = subprocess.run([node, "-e", code], capture_output=True, text=True, timeout=30)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError("node 生成 token 失败: " + (out.stderr or "")[:200])
    v = out.stdout.strip().split("\n")[-1].strip()
    if not v:
        raise RuntimeError("token 为空")
    _HEXIN_V_CACHE.update(v=v, ts=now)
    return v


def _parse_ths_fund_page(html: str) -> List[Dict[str, Any]]:
    """解析同花顺行业资金流单页 HTML 表格。
    列序：序号/行业/行业指数/行业-涨跌幅/流入资金/流出资金/净额/公司家数/领涨股/...
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []
    out: List[Dict[str, Any]] = []
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 7:
            continue
        try:
            name = tds[1].get_text(strip=True)
            chg = float(tds[3].get_text(strip=True).replace("%", ""))
            net = float(tds[6].get_text(strip=True).replace(",", ""))  # 净额(亿)
        except Exception:
            continue
        if not name:
            continue
        # 流入/流出/家数：列存在才取，取不到诚实置 0（东财 crash 时 THS 仍可用）
        inflow = outflow = 0.0
        firms = 0
        try:
            inflow = float(tds[4].get_text(strip=True).replace(",", ""))  # 流入资金(亿)
        except Exception:
            pass
        try:
            outflow = float(tds[5].get_text(strip=True).replace(",", ""))  # 流出资金(亿)
        except Exception:
            pass
        try:
            firms = int(float(tds[7].get_text(strip=True).replace(",", "")))  # 公司家数
        except Exception:
            pass
        out.append({
            "code": "",
            "name": name,
            "change_pct": chg,
            "main_net_yi": round(net, 2),   # 真实行业资金净流入（亿）
            "main_net_pct": chg,            # 涨跌幅
            "inflow_yi": round(inflow, 2),  # 流入资金（亿）
            "outflow_yi": round(outflow, 2),  # 流出资金（亿）
            "firms": firms,                 # 公司家数
            "proxy": False,
        })
    return out


def _ths_fund_flow(top_n: int = 20) -> Tuple[List[Dict[str, Any]], int]:
    """同花顺行业资金流数据中心（真实净额）。等价 akshare stock_fund_flow_industry('即时')。

    返回 (榜单, 行业总数)。同花顺失败时降级到东财真实主力净流入，仍失败返回 ([], 0)。
    """
    # 1) 同花顺真实净额
    try:
        v = _get_hexin_v()
        base_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.85 Safari/537.36",
            "Referer": "http://data.10jqka.com.cn/funds/hyzjl/",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "text/html, */*; q=0.01",
            "hexin-v": v,
        }
        first = requests.get(
            "http://data.10jqka.com.cn/funds/hyzjl/field/tradezdf/order/desc/ajax/1/free/1/",
            headers=base_headers, timeout=15,
        )
        soup = BeautifulSoup(first.text, "html.parser")
        page_info = soup.find(name="span", attrs={"class": "page_info"})
        page_num = int(page_info.text.split("/")[1]) if page_info else 1
        rows = _parse_ths_fund_page(first.text)
        for p in range(2, page_num + 1):
            try:
                r = requests.get(
                    f"http://data.10jqka.com.cn/funds/hyzjl/field/tradezdf/order/desc/page/{p}/ajax/1/free/1/",
                    headers=base_headers, timeout=15,
                )
                rows.extend(_parse_ths_fund_page(r.text))
            except Exception:
                break
        if rows:
            rows.sort(key=lambda x: x["main_net_yi"], reverse=True)
            total = len(rows)
            head = rows[:top_n]
            tail = rows[-top_n:] if len(rows) > top_n else []
            seen = {r["name"] for r in head}
            combined = head + [r for r in tail if r["name"] not in seen]
            return combined, total
    except Exception:
        pass

    # 2) 降级：东财真实主力净流入
    try:
        return _em_main_flow(top_n)
    except Exception:
        pass

    return [], 0


def _em_main_flow(top_n: int = 20) -> Tuple[List[Dict[str, Any]], int]:
    """东财 push2 行业主力净流入（f62=主力净流入, f184=主力净占比）。"""
    url = "https://push2.eastmoney.com/api/qt/clist/get"
    params = {
        "pn": "1", "pz": "100", "po": "1", "np": "1",
        "fltt": "2", "invt": "2",
        "fs": "m:90+t:2",
        "fields": "f12,f14,f3,f62,f184",
    }
    r = em_get(url, params=params, headers={"User-Agent": UA}, timeout=15)
    d = r.json()
    dd = d.get("data") or {}
    items = dd.get("diff") or []
    if not items:
        return [], 0
    total = dd.get("total") or len(items)
    rows = []
    for it in items:
        f62 = it.get("f62") or 0
        rows.append({
            "code": it.get("f12", ""),
            "name": it.get("f14", ""),
            "change_pct": it.get("f3") or 0,
            "main_net_yi": round(f62 / 1e8, 2) if f62 else 0.0,
            "main_net_pct": it.get("f184") or 0,
            "proxy": False,
        })
    rows.sort(key=lambda x: x["main_net_yi"], reverse=True)
    head = rows[:top_n]
    tail = rows[-top_n:] if len(rows) > top_n else []
    seen = {r["code"] for r in head}
    combined = head + [r for r in tail if r["code"] not in seen]
    return combined, total


def sector_capital_flow(top_n: int = 20) -> Tuple[List[Dict[str, Any]], int]:
    """对外接口：同花顺真实净额优先，东财主力净流入降级。"""
    return _ths_fund_flow(top_n)


# ── 涨幅最大行业（同花顺行情页，无需 token）───────────────────────

import re
from concurrent.futures import ThreadPoolExecutor, as_completed


def _fetch_sector_top_stocks(sector_code: str, n: int = 3) -> List[Dict[str, Any]]:
    """抓取单个行业板块内的个股排行，返回前 N 只。"""
    try:
        url = f"http://q.10jqka.com.cn/thshy/detail/code/{sector_code}/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "http://q.10jqka.com.cn/thshy/",
        }
        r = requests.get(url, headers=headers, timeout=12)
        soup = BeautifulSoup(r.text, "html.parser")
        table = soup.find("table")
        if not table:
            return []
        stocks = []
        for tr in table.find_all("tr")[1:]:  # 跳过表头
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue
            try:
                code = tds[1].get_text(strip=True)
                name = tds[2].get_text(strip=True)
                chg = float(tds[4].get_text(strip=True).replace("%", ""))
            except (ValueError, IndexError):
                continue
            if not code:
                continue
            stocks.append({"code": code, "name": name, "change_pct": round(chg, 2)})
            if len(stocks) >= n:
                break
        return stocks
    except Exception:
        return []


def _ths_sector_ranking(top_n: int = 15) -> List[Dict[str, Any]]:
    """同花顺行业板块行情页（q.10jqka.com.cn/thshy/）。

    返回按涨跌幅降序的行业列表，含：name / change_pct / up_count /
    down_count / leader（领涨股）/ top_stocks（前3只代表个股）。
    无需 hexin-v token，公开页面直接抓取。
    """
    try:
        url = "http://q.10jqka.com.cn/thshy/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "http://q.10jqka.com.cn/",
        }
        r = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        table = soup.find("table")
        if not table:
            return []
        rows: List[Dict[str, Any]] = []
        sector_codes: List[str] = []
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 11:
                continue
            try:
                name = tds[1].get_text(strip=True)
                if not name or name in ("板块",):
                    continue
                chg = float(tds[2].get_text(strip=True).replace("%", ""))
                up = int(tds[6].get_text(strip=True))
                down = int(tds[7].get_text(strip=True))
                leader = tds[9].get_text(strip=True)
                # 提取行业代码（从链接 href 中）
                link = tds[1].find("a", href=True)
                sc = ""
                if link and link["href"]:
                    m = re.search(r"(\d{6})", link["href"])
                    if m:
                        sc = m.group(1)
            except (ValueError, IndexError):
                continue
            rows.append({
                "code": "",
                "name": name,
                "change_pct": round(chg, 2),
                "up_count": up,
                "down_count": down,
                "leader": leader,
                "top_stocks": [],  # 后面填充
            })
            sector_codes.append(sc)

        # 并发抓取每个行业的 top-3 个股
        result = rows[:top_n]
        codes_to_fetch = [(sc, i) for i, sc in enumerate(sector_codes[:top_n]) if sc]
        if codes_to_fetch:
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = {pool.submit(_fetch_sector_top_stocks, sc, 3): i for sc, i in codes_to_fetch}
                for fut in as_completed(futures):
                    idx = futures[fut]
                    try:
                        result[idx]["top_stocks"] = fut.result(timeout=15)
                    except Exception:
                        pass

        return result
    except Exception:
        return []
