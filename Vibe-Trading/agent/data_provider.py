"""A股量化决策 — 统一数据层 (DataProvider)

数据源策略（a-stock-data 方法论，无任何东财依赖）：
  mootdx(TCP 7709) / 腾讯财经(qt.gtimg.cn) / 同花顺(10jqka) / 新浪(三表) —— 全部 a-stock-data 通道

设计要点：
  1. 所有对外数据访问走唯一入口 DataProvider，下游因子层/择时层(P2/P3)复用同一接口。
  2. 严格只用 a-stock-data 四通道（mootdx/腾讯/同花顺/新浪）。原东财 push2/push2his/
     datacenter 已彻底移除 —— 龙虎榜/个股资金流120日/行业板块排名 a-stock-data 无真实源，
     一律返回空(诚实降级)，绝不编造、绝不回退东财缓存假数据。
  3. a-stock-data 主通道带本地缓存，减少重复请求、断网续跑。
  4. health() 报告各 a-stock-data 源实时可达性，供前端展示数据源健康度。

注意：本模块不 import signal_engine（避免循环依赖）；signal_engine 从本模块 re-export
所需符号，原函数体改为委托到 get_provider()。
"""

from __future__ import annotations

import json
import math
import re
import time
import random
import io
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

# ── mootdx（TCP 行情，a-stock-data 首选通道） ─────────────────────────────
try:
    from mootdx.quotes import Quotes
    MOOTDX_AVAILABLE = True
except ImportError:
    MOOTDX_AVAILABLE = False

try:
    import numpy as np
except ImportError:
    np = None


# ═══════════════════════════════════════════════════════════════════════
# 常量 / 东财防封工具（保留供本模块内 东财 通道使用）
# ═══════════════════════════════════════════════════════════════════════

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

EM_SESSION = requests.Session()
EM_SESSION.headers.update({"User-Agent": UA})
EM_MIN_INTERVAL = 1.0
_em_last_call = [0.0]

DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def _get_prefix(code: str) -> str:
    """6位代码 → 市场前缀"""
    if code.startswith(("6", "9")):
        return "sh"
    elif code.startswith("8"):
        return "bj"
    return "sz"


def em_get(url: str, params: dict = None, headers: dict = None,
           timeout: int = 15, **kwargs):
    """东财统一请求入口：自动节流 + 复用 session + 默认 UA"""
    wait = EM_MIN_INTERVAL - (time.time() - _em_last_call[0])
    if wait > 0:
        time.sleep(wait + random.uniform(0.1, 0.5))
    try:
        return EM_SESSION.get(url, params=params, headers=headers, timeout=timeout, **kwargs)
    finally:
        _em_last_call[0] = time.time()


def eastmoney_datacenter(report_name: str, columns: str = "ALL",
                         filter_str: str = "", page_size: int = 50,
                         sort_columns: str = "", sort_types: str = "-1") -> list:
    """东财数据中心统一查询"""
    params = {
        "reportName": report_name, "columns": columns,
        "filter": filter_str, "pageNumber": "1", "pageSize": str(page_size),
        "sortColumns": sort_columns, "sortTypes": sort_types,
        "source": "WEB", "client": "WEB",
    }
    r = em_get(DATACENTER_URL, params=params, timeout=15)
    d = r.json()
    if d.get("result") and d["result"].get("data"):
        return d["result"]["data"]
    return []


# ═══════════════════════════════════════════════════════════════════════
# 本地缓存（JSON 文件，带 TTL + 陈旧兜底）
# ═══════════════════════════════════════════════════════════════════════

def _jsonable(o):
    """把 numpy / pandas 标量转成 JSON 可序列化原生类型"""
    if np is not None:
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    return str(o)


class _FileCache:
    """极简 JSON 文件缓存：fresh = 未过期；stale = 存在但可能过期（兜底用）"""

    def __init__(self, cache_dir: Path):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)
        return self.cache_dir / f"{safe}.json"

    def set(self, key: str, data: Any) -> None:
        p = self._path(key)
        try:
            p.write_text(
                json.dumps({"ts": time.time(), "data": data}, ensure_ascii=False, default=_jsonable),
                encoding="utf-8",
            )
        except Exception as e:
            print(f"[cache] set {key} 失败: {e}")

    def get_fresh(self, key: str, ttl: int) -> Optional[Any]:
        p = self._path(key)
        if not p.exists():
            return None
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
        if time.time() - d.get("ts", 0) > ttl:
            return None
        return d.get("data")

    def get_stale(self, key: str) -> Optional[Any]:
        p = self._path(key)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("data")
        except Exception:
            return None


# ═══════════════════════════════════════════════════════════════════════
# DataProvider — 统一数据层
# ═══════════════════════════════════════════════════════════════════════

# 各源 TTL（秒）
TTL_QUOTE = 3600          # 腾讯行情：1h
TTL_BARS = 3600           # mootdx 日线：1h（盘中不变）
TTL_FIN = 86400           # 财务快照：1d
TTL_HOT = 86400           # 同花顺热点：1d
TTL_EM = 86400            # 东财类（行业/龙虎/资金流/两融）：1d


class DataProvider:
    """A股量化决策统一数据层。

    每个方法返回与历史 signal_engine 同名函数一致的数据结构，便于无缝替换。
    东财类方法在网络失败/被屏蔽时回退陈旧缓存，无缓存则返回空（诚实降级）。
    """

    def __init__(self, cache_dir: Path = None):
        if cache_dir is None:
            cache_dir = Path(__file__).resolve().parent.parent / "A股量化决策" / ".cache"
        self.cache = _FileCache(cache_dir)

    # ── a-stock-data 主通道（mootdx / 腾讯 / 同花顺） ────────────────────

    def quote(self, codes: List[str]) -> Dict[str, dict]:
        """个股实时行情 — 主通道 mootdx（TCP 7709，腾讯/东财被代理屏蔽时仍可用）。

        返回结构与历史 tencent_batch_quote 完全一致（name/price/pe_ttm/pb/mcap_yi/
        turnover_pct/change_pct/...），signal_engine 等下游无需改动即可拿到真实
        PE/PB/市值/换手率/涨跌幅。

        估值推导链路（全部在 a-stock-data 体系内，零外部依赖）：
          · mootdx quotes   → 实时价/昨收/开/高/低/量(手)/额(元)
          · 新浪实时行情     → 股票名称（mootdx quotes 无名称）
          · mootdx 财务快照 → 总股本/流通股/每股净资产(BVPS)
          · 新浪年报净利润   → EPS = 净利润 / 总股本 → 真实 PE（TTM 近似）
        """
        if not codes:
            return {}
        key = "quote:" + ",".join(sorted(codes))
        cached = self.cache.get_fresh(key, TTL_QUOTE)
        if cached is not None:
            return cached
        # 主通道：mootdx 实时报价 + 新浪名称/年报 + mootdx 股本/BVPS → 推导估值
        raw = _mootdx_batch_quote_raw(codes)
        if raw:
            self.cache.set(key, raw)
            return raw
        # 兜底：腾讯（未来若恢复）
        raw = _tencent_batch_quote_raw(codes)
        if raw:
            self.cache.set(key, raw)
            return raw
        stale = self.cache.get_stale(key)
        return stale if stale is not None else {}

    def daily_bars(self, code: str, start: str = None, end: str = None,
                   max_bars: int = 800) -> Optional[pd.DataFrame]:
        """a-stock-data 行情层：个股日线（mootdx TCP 7709，不封 IP，首选）。"""
        key = f"bars:{code}:{max_bars}"
        cached = self.cache.get_fresh(key, TTL_BARS)
        if cached is not None:
            df = _bars_from_records(cached)
        else:
            df = _fetch_daily_bars_raw(code, max_bars)
            if df is not None and not df.empty:
                self.cache.set(key, _bars_to_records(df))
            else:
                stale = self.cache.get_stale(key)
                df = _bars_from_records(stale) if stale else None
        if df is None or df.empty:
            return None
        if start:
            df = df[df.index >= pd.Timestamp(start)]
        if end:
            df = df[df.index <= pd.Timestamp(end)]
        return df

    def financial(self, code: str) -> dict:
        """通达信财务快照 — EPS/ROE/净利润/营收等（mootdx，不封IP）"""
        key = f"fin:{code}"
        cached = self.cache.get_fresh(key, TTL_FIN)
        if cached is not None:
            return cached
        raw = _mootdx_finance_snapshot_raw(code)
        if raw:
            self.cache.set(key, raw)
            return raw
        stale = self.cache.get_stale(key)
        return stale if stale is not None else {}

    def quarterly_financials(self, code: str) -> Optional[dict]:
        """新浪财报三表（季度）— 最新一期营收/净利润/毛利率/合同负债/经营现金流。

        供复盘雷达「题材归因」右侧 serenity 风格财务表使用。
        不可达返回 None（诚实降级）。
        """
        key = f"qfin:{code}"
        cached = self.cache.get_fresh(key, TTL_FIN)
        if cached is not None:
            return cached
        raw = _sina_quarterly_raw(code)
        if raw:
            self.cache.set(key, raw)
            return raw
        stale = self.cache.get_stale(key)
        return stale if stale is not None else None

    def financial_statements(self, code: str, stmt: str = "profit") -> Optional[dict]:
        """历史财报三表（a-stock-data 通道：新浪）。

        目前支持利润表(stmt="profit")，返回历年营业总收入/净利润/EPS 序列，
        供成长因子(revenue_yoy/net_profit_yoy/eps_cagr_3y)真实计算。
        不可达时回退陈旧缓存；无缓存返回 None（诚实降级，绝不编造同比）。
        """
        if stmt != "profit":
            return None
        key = f"stmt:{stmt}:{code}"
        cached = self.cache.get_fresh(key, TTL_FIN)
        if cached is not None:
            return cached
        raw = _sina_profit_raw(code)
        if raw:
            self.cache.set(key, raw)
            return raw
        stale = self.cache.get_stale(key)
        return stale if stale is not None else None

    def hot_stocks(self, date_str: str = None) -> pd.DataFrame:
        """同花顺当日强势股 + 题材归因（a-stock-data 通道）"""
        if date_str is None:
            date_str = datetime.now().strftime("%Y-%m-%d")
        key = f"hot:{date_str}"
        # 同花顺不可达时回退缓存
        raw = _ths_hot_reason_raw(date_str)
        if raw is not None and not raw.empty:
            self.cache.set(key, _df_to_payload(raw))
            return raw
        payload = self.cache.get_stale(key)
        if payload is not None:
            return _df_from_payload(payload)
        return pd.DataFrame()

    # ── 东财通道（仅缓存兜底，被代理屏蔽时回退） ────────────────────────

    def industry_ranking(self) -> List[dict]:
        """行业板块排名（东财 push2 二级行业，含涨跌幅/涨跌家数/领涨股）。

        与 review_panels.sector_capital_flow 同源（push2 m:90+t:2），
        证明公司网络下东财可达时此接口也有真实数据。
        """
        url = "https://push2.eastmoney.com/api/qt/clist/get"
        params = {
            "pn": "1", "pz": "100", "po": "1", "np": "1",
            "fltt": "2", "invt": "2",
            "fs": "m:90+t:2",
            # f3=涨跌幅  f104=上涨家数  f105=下跌家数  f6=领涨股代码  f7=领涨股名称
            "fields": "f12,f14,f3,f104,f105,f6,f7",
        }
        try:
            r = em_get(url, params=params, headers={"User-Agent": UA}, timeout=15)
            d = r.json()
        except Exception:
            return []
        items = ((d.get("data") or {}).get("diff") or [])
        result = []
        for it in items:
            name = it.get("f14", "") or ""
            if not name:
                continue
            result.append({
                "code": it.get("f12", ""),
                "name": name,
                "change_pct": round((it.get("f3") or 0), 2),
                "up_count": it.get("f104") or 0,
                "down_count": it.get("f105") or 0,
                "leader": it.get("f7") or "",
            })
        # 按涨跌幅降序（与原行业涨幅榜行为一致）
        result.sort(key=lambda x: -(x.get("change_pct") or 0))
        return result

    def dragon_tiger(self, date_str: str = None) -> List[dict]:
        """全市场龙虎榜 —— a-stock-data 无真实源，诚实返回空（不读任何东财缓存）。"""
        return []

    def fund_flow_120d(self, code: str) -> List[dict]:
        """个股资金流120日 —— a-stock-data 无真实源，诚实返回空（不读任何东财缓存）。"""
        return []

    def margin(self, code: str, page_size: int = 30) -> list:
        """融资融券明细 —— a-stock-data 无真实源，诚实返回空（不读任何东财缓存）。"""
        return []

    # ── 健康度 ──────────────────────────────────────────────────────────

    def health(self) -> Dict[str, str]:
        """报告各数据源实时可达性（不写缓存，轻量探测）"""
        out: Dict[str, str] = {}

        # mootdx（日线 + 实时报价，信号主通道）
        try:
            df = _fetch_daily_bars_raw("600519", max_bars=2)
            out["mootdx"] = "ok" if df is not None else "degraded"
        except Exception as e:
            out["mootdx"] = f"error:{type(e).__name__}"
        try:
            q = _mootdx_batch_quote_raw(["600519"])
            out["mootdx_quote"] = "ok" if q else "degraded"
        except Exception as e:
            out["mootdx_quote"] = f"error:{type(e).__name__}"

        # 腾讯
        try:
            q = _tencent_batch_quote_raw(["600519"])
            out["tencent"] = "ok" if q else "degraded"
        except Exception as e:
            out["tencent"] = f"error:{type(e).__name__}"

        # 同花顺
        try:
            h = _ths_hot_reason_raw()
            out["ths"] = "ok" if h is not None else "degraded"
        except Exception as e:
            out["ths"] = f"error:{type(e).__name__}"

        # 新浪（历史财报三表，a-stock-data 通道，带缓存）
        try:
            s = get_provider().financial_statements("600519", "profit")
            out["sina"] = "ok" if s else "degraded"
        except Exception as e:
            out["sina"] = f"error:{type(e).__name__}"

        return out


# ═══════════════════════════════════════════════════════════════════════
# 原始取数实现（被 DataProvider 方法调用，亦可被 signal_engine 委托包装）
# ═══════════════════════════════════════════════════════════════════════

def _tencent_batch_quote_raw(codes: List[str]) -> Dict[str, dict]:
    if not codes:
        return {}
    prefixed = [f"{_get_prefix(c)}{c}" for c in codes]
    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = resp.read().decode("gbk")
    except Exception:
        return {}
    result = {}
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
            "pe_ttm": float(vals[39]) if vals[39] else 0,
            "pb": float(vals[46]) if vals[46] else 0,
            "mcap_yi": float(vals[44]) if vals[44] else 0,
            "float_mcap_yi": float(vals[45]) if vals[45] else 0,
            "turnover_pct": float(vals[38]) if vals[38] else 0,
            "amount_wan": float(vals[37]) if vals[37] else 0,
            "vol_ratio": float(vals[49]) if vals[49] else 0,
        }
    return result


def _sina_realtime_names(codes: List[str]) -> Dict[str, str]:
    """新浪实时行情批量取股票名称（a-stock-data 通道，不封IP）。

    mootdx quotes 实时报价不含名称，腾讯被代理屏蔽时改由新浪
    hq.sinajs.cn 批量取名称（一次调用覆盖全池）。返回 {6位代码: 名称}。
    """
    if not codes:
        return {}
    prefixed = [_get_prefix(c) + c for c in codes]
    url = "https://hq.sinajs.cn/list=" + ",".join(prefixed)
    try:
        r = requests.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://finance.sina.com.cn/",
            },
            timeout=10,
        )
        r.encoding = "gbk"
        text = r.text
    except Exception as e:
        print(f"[sina_names] 失败: {e}")
        return {}
    names: Dict[str, str] = {}
    for line in text.strip().split("\n"):
        if "=" not in line or '"' not in line:
            continue
        # 形如 var hq_str_sh600519="贵州茅台,1184.98,...";
        key = line.split("_")[-1].split("=")[0]
        m = re.search(r"\d{6}", key)
        if not m:
            continue
        code = m.group(0)
        inside = line.split('"')[1]
        arr = inside.split(",")
        if arr and arr[0]:
            names[code] = arr[0].strip()
    return names


def _mootdx_batch_quote_raw(codes: List[str]) -> Dict[str, dict]:
    """通达信(TCP 7709) 真实行情主通道 —— 替代被代理屏蔽的腾讯/东财。

    数据源（全部在 a-stock-data 体系内、零外部依赖）：
      · mootdx quotes   → 实时价/昨收/开/高/低/量(手)/额(元)
      · 新浪实时行情     → 股票名称（mootdx quotes 无名称）
      · mootdx 财务快照 → 总股本/流通股/每股净资产(BVPS)
      · 新浪年报净利润   → EPS = 净利润 / 总股本 → 真实 PE(TTM 近似)
    推导：PE = 价/EPS，PB = 价/BVPS，市值 = 价×总股本，
          换手率 = 量(手)×100 / 流通股 ×100。
    返回结构与 _tencent_batch_quote_raw 完全一致，signal_engine 无需改动。
    """
    if not codes or not MOOTDX_AVAILABLE:
        return {}
    # 名称（新浪，一次批量）
    names = _sina_realtime_names(codes)
    # 实时报价（mootdx，一次批量）
    try:
        client = Quotes.factory(market='std')
        qdf = client.quotes(symbol=list(codes))
    except Exception as e:
        print(f"[mootdx_quote] 实时报价失败: {e}")
        return {}
    if qdf is None or not hasattr(qdf, "iterrows"):
        return {}
    prov = get_provider()
    result: Dict[str, dict] = {}
    for _, row in qdf.iterrows():
        raw_code = str(row.get("code", "")).strip()
        m = re.search(r"\d{6}", raw_code)
        code = m.group(0) if m else raw_code
        if not code or len(code) != 6:
            continue
        try:
            price = float(row.get("price") or 0)
            last_close = float(row.get("last_close") or 0)
            vol = float(row.get("vol") or 0)         # 手
            amount = float(row.get("amount") or 0)   # 元
            open_ = float(row.get("open") or 0)
            high = float(row.get("high") or 0)
            low = float(row.get("low") or 0)
        except Exception:
            continue
        change_amt = (price - last_close) if last_close else 0
        change_pct = (change_amt / last_close * 100) if last_close else 0

        # 股本 / 每股净资产（mootdx 财务快照，带 1d 缓存，避免每只重复 TCP）
        total_shares = float_shares = bvps = 0.0
        fin = prov.financial(code)
        if fin and fin.get("rows"):
            frow = fin["rows"][0]
            try:
                total_shares = float(frow.get("zongguben") or 0)
                float_shares = float(frow.get("liutongguben") or 0)
                bvps = float(frow.get("meigujingzichan") or 0)
            except Exception:
                pass

        # 净利润（新浪年报）→ EPS，市值/PE/PB
        eps = pe_ttm = pb = mcap_yi = float_mcap_yi = 0.0
        try:
            stmt = prov.financial_statements(code, "profit")
            if stmt and stmt.get("net_profit"):
                np_wan = stmt["net_profit"][0]   # 最新年报，单位：万元
                if np_wan and total_shares:
                    eps = float(np_wan) * 1e4 / total_shares  # 元
        except Exception:
            pass
        if eps > 0 and price > 0:
            pe_ttm = price / eps
        if bvps > 0 and price > 0:
            pb = price / bvps
        # 真实 ROE = EPS / BVPS（两者均为可靠每股值，比率不受快照绝对值缩放影响）
        roe = round(eps / bvps * 100, 1) if (eps > 0 and bvps > 0) else 0
        if total_shares:
            mcap_yi = price * total_shares / 1e8
        if float_shares:
            float_mcap_yi = price * float_shares / 1e8
        # 换手率 = 成交量(手)×100 / 流通股 ×100
        turnover_pct = (vol * 100 / float_shares * 100) if float_shares else 0
        amount_wan = amount / 1e4

        result[code] = {
            "name": names.get(code, ""),
            "price": round(price, 2),
            "last_close": round(last_close, 2),
            "open": round(open_, 2),
            "change_amt": round(change_amt, 2),
            "change_pct": round(change_pct, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "amount_wan": round(amount_wan, 1),
            "turnover_pct": round(turnover_pct, 3),
            "pe_ttm": round(pe_ttm, 2),
            "amplitude_pct": round((high - low) / last_close * 100, 2) if last_close else 0,
            "mcap_yi": round(mcap_yi, 1),
            "float_mcap_yi": round(float_mcap_yi, 1),
            "pb": round(pb, 2),
            "roe": roe,
            "limit_up": round(last_close * 1.1, 2),
            "limit_down": round(last_close * 0.9, 2),
            "vol_ratio": 1.0,
            "pe_static": round(pe_ttm, 2),
        }
    return result


def _mootdx_finance_snapshot_raw(code: str) -> dict:
    """通达信财务快照 — symbol 必须是字符串（mootdx 内部 get_stock_market 要求）。

    注：早期代码误传 int(code)，会触发 AssertionError 被吞 → financial 永远返回空，
    导致成长/质量因子长期拿不到真实数据。此处修正为字符串。
    """
    if not MOOTDX_AVAILABLE:
        return {}
    try:
        client = Quotes.factory(market='std')
        fin = client.finance(symbol=code)
        if fin is None:
            return {}
        # fin 可能是 DataFrame 或 dict；统一转成 dict 列表便于缓存/消费
        if hasattr(fin, "to_dict"):
            return {"rows": fin.to_dict(orient="records"), "columns": list(fin.columns)}
        return fin if isinstance(fin, dict) else {"rows": [fin]}
    except Exception as e:
        print(f"[finance] mootdx 快照失败 {code}: {e}")
        return {}


def _sina_quarterly_raw(code: str) -> Optional[dict]:
    """新浪财报三表（季度）— 取最新一期的营收/净利润/营业成本/合同负债/经营现金流。

    返回结构（单位：元）：
      {
        "period": "2026-03-31",
        "revenue": float,              # 营业总收入
        "revenue_yoy": float|None,     # 营收同比(%)
        "profit": float,               # 净利润
        "profit_yoy": float|None,      # 净利润同比(%)
        "gross_margin": float|None,    # 毛利率(%) = (营收-营业成本)/营收*100
        "contract_liability": float|None,  # 合同负债
        "operating_cash_flow": float|None, # 经营活动现金流净额
      }
    不可达或解析失败返回 None（诚实降级）。
    """
    prefix = "sh" if code.startswith("6") else "sz"
    paper_code = f"{prefix}{code}"
    base = "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022"
    headers = {"User-Agent": UA}

    def _fetch(report_type: str, num: int = 4) -> List[dict]:
        try:
            params = {"paperCode": paper_code, "source": report_type,
                      "type": "0", "page": "1", "num": str(num)}
            r = requests.get(base, params=params, headers=headers, timeout=15)
            report_list = r.json().get("result", {}).get("data", {}).get("report_list", {}) or {}
            rows = []
            for period in sorted(report_list.keys(), reverse=True)[:num]:
                obj = report_list[period]
                rec = {"报告期": f"{period[:4]}-{period[4:6]}-{period[6:8]}"}
                for it in obj.get("data", []) or []:
                    title = it.get("item_title", "")
                    if not title or it.get("item_value") is None:
                        continue
                    rec[title] = it.get("item_value")
                    tongbi = it.get("item_tongbi")
                    if tongbi not in (None, ""):
                        rec[title + "_同比"] = tongbi
                rows.append(rec)
            return rows
        except Exception:
            return []

    def _to_float(v):
        if v is None:
            return None
        try:
            s = str(v).replace(",", "").replace("%", "").replace("亿", "e8").replace("万", "e4")
            return float(s)
        except Exception:
            return None

    # 三表并发抓取（单只股票内并行），把串行 3 次请求压缩到 1 次耗时
    from concurrent.futures import ThreadPoolExecutor
    try:
        with ThreadPoolExecutor(max_workers=3) as _ex:
            lrb, fzb, llb = list(_ex.map(lambda rt: _fetch(rt), ["lrb", "fzb", "llb"]))
    except Exception:
        lrb, fzb, llb = _fetch("lrb"), _fetch("fzb"), _fetch("llb")
    if not lrb:
        return None

    latest = lrb[0]  # 最新一期利润表
    period = latest.get("报告期", "")

    revenue = _to_float(latest.get("营业总收入") or latest.get("营业收入"))
    revenue_yoy = _to_float(latest.get("营业总收入_同比") or latest.get("营业收入_同比"))
    profit = _to_float(latest.get("净利润"))
    profit_yoy = _to_float(latest.get("净利润_同比"))
    cost = _to_float(latest.get("营业成本") or latest.get("营业总成本"))

    # 毛利率 = (营收 - 营业成本) / 营收 * 100
    gross_margin = None
    if revenue and cost is not None and revenue != 0:
        gross_margin = round((revenue - cost) / revenue * 100, 2)

    # 合同负债 / 总资产 / 总负债（资产负债表最新期）
    contract_liability = None
    total_assets = None
    total_liabilities = None
    if fzb:
        contract_liability = _to_float(fzb[0].get("合同负债"))
        total_assets = _to_float(fzb[0].get("资产总计") or fzb[0].get("总资产"))
        total_liabilities = _to_float(fzb[0].get("负债合计") or fzb[0].get("总负债"))

    # 经营现金流（现金流量表最新期）
    operating_cash_flow = None
    if llb:
        ocf = (llb[0].get("经营活动产生的现金流量净额")
               or llb[0].get("经营活动现金流入小计"))
        operating_cash_flow = _to_float(ocf)

    # 净利率(%) = 净利润 / 营业总收入 * 100
    net_margin = None
    if revenue and profit is not None and revenue != 0:
        net_margin = round(profit / revenue * 100, 2)

    # 资产负债率(%) = 负债合计 / 资产总计 * 100
    debt_ratio = None
    if total_assets and total_liabilities is not None and total_assets != 0:
        debt_ratio = round(total_liabilities / total_assets * 100, 2)

    return {
        "period": period,
        "revenue": revenue,
        "revenue_yoy": revenue_yoy,
        "profit": profit,
        "profit_yoy": profit_yoy,
        "gross_margin": gross_margin,
        "net_margin": net_margin,
        "debt_ratio": debt_ratio,
        "contract_liability": contract_liability,
        "operating_cash_flow": operating_cash_flow,
    }


def _sina_profit_raw(code: str) -> Optional[dict]:
    """新浪历史利润表 — a-stock-data §6.4 sina_financial_report JSON 端点（不封IP）。

    改用与 _sina_quarterly_raw 同源的 quotes.sina.cn JSON API（而非旧 HTML 表格端点），
    对金融股(保险/银行)也能取到 营业收入 / 净利润，从而算出营收同比。
    返回结构：
      {"dates": ["2025-12-31", ...降序], "total_revenue":[...], "net_profit":[...], "eps":[...]}
    total_revenue 优先取 营业总收入，缺失时回退 营业收入（金融股只有 营业收入）。
    不可达或解析失败返回 None（诚实降级）。
    """
    prefix = "sh" if code.startswith("6") else "sz"
    paper_code = f"{prefix}{code}"
    base = "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022"
    headers = {"User-Agent": UA}

    def _to_float(v):
        if v is None:
            return None
        try:
            s = str(v).replace(",", "").replace("%", "").replace("亿", "e8").replace("万", "e4")
            return float(s)
        except Exception:
            return None

    try:
        params = {"paperCode": paper_code, "source": "lrb",
                  "type": "0", "page": "1", "num": "12"}
        r = requests.get(base, params=params, headers=headers, timeout=15)
        report_list = r.json().get("result", {}).get("data", {}).get("report_list", {}) or {}
    except Exception as e:
        print(f"[sina_profit] 不可达 {code}: {e}")
        return None
    if not report_list:
        return None

    rows = []
    for period in sorted(report_list.keys(), reverse=True)[:12]:
        obj = report_list[period]
        rec = {"报告期": f"{period[:4]}-{period[4:6]}-{period[6:8]}"}
        for it in obj.get("data", []) or []:
            t = it.get("item_title", "")
            if not t or it.get("item_value") is None:
                continue
            rec[t] = it.get("item_value")
        rows.append(rec)
    if not rows:
        return None

    # 仅取年报（12-31），按年降序
    annual = [r for r in rows if r.get("报告期", "").endswith("12-31")]
    if not annual:
        annual = rows
    annual_sorted = sorted(annual, key=lambda r: r.get("报告期", ""), reverse=True)

    def pick(kws):
        out = []
        for r in annual_sorted:
            val = None
            for kw in kws:
                if kw in r and r[kw] not in (None, ""):
                    val = _to_float(r[kw])
                    break
            out.append(val)
        return out

    return {
        "dates": [r.get("报告期") for r in annual_sorted],
        "total_revenue": pick(["营业总收入", "营业收入"]),
        "net_profit": pick(["净利润"]),
        "eps": pick(["基本每股收益"]),
    }


def _fetch_daily_bars_raw(code: str, max_bars: int = 800) -> Optional[pd.DataFrame]:
    """a-stock-data 行情层原始实现：mootdx TCP 7709 日线。失败返回 None。"""
    if not MOOTDX_AVAILABLE:
        return None
    m = re.search(r"\d{6}", code or "")
    if not m:
        return None
    code6 = m.group(0)
    try:
        client = Quotes.factory(market='std')
        df = client.bars(symbol=code6, category=4, offset=max_bars)
    except Exception as e:
        print(f"[fetch_daily_bars] mootdx 失败 {code}: {e}")
        return None
    if df is None or df.empty:
        return None
    if not isinstance(df.index, pd.DatetimeIndex):
        if "datetime" in df.columns:
            df = df.copy()
            df["datetime"] = pd.to_datetime(df["datetime"])
            df = df.set_index("datetime")
        else:
            return None
    df = df[~df.index.duplicated(keep="last")].sort_index()
    keep = [c for c in ("open", "close", "high", "low", "vol", "amount", "volume")
            if c in df.columns]
    df = df[keep]
    return df


def _bars_to_records(df: pd.DataFrame) -> List[dict]:
    recs = []
    for idx, row in df.iterrows():
        recs.append({
            "date": str(idx.date()) if hasattr(idx, "date") else str(idx),
            "open": float(row.get("open", 0) or 0),
            "close": float(row.get("close", 0) or 0),
            "high": float(row.get("high", 0) or 0),
            "low": float(row.get("low", 0) or 0),
            "vol": float(row.get("vol", 0) or 0),
            "amount": float(row.get("amount", 0) or 0),
        })
    return recs


def _bars_from_records(records: Any) -> Optional[pd.DataFrame]:
    if not records:
        return None
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    return df


def _stock_fund_flow_120d_raw(code: str) -> list:
    """个股资金流120日 —— a-stock-data 无真实源（腾讯 ff_ 接口已废弃、新浪 vMF 空、mootdx 无），
    诚实返回空，绝不编造主力净流入（P0 已否决反因果伪因子）。"""
    return []


def _industry_comparison_raw() -> List[dict]:
    """行业板块排名 —— a-stock-data 无板块接口（mootdx/腾讯/同花顺/新浪均无板块行情），
    诚实返回空。主线策略的板块加成暂降级（P3 主线择时会补板块主线）。"""
    return []


def _ths_hot_reason_raw(date_str: str = None) -> pd.DataFrame:
    """同花顺当日强势股 + 题材归因"""
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
    url = (
        f"http://zx.10jqka.com.cn/event/api/getharden/"
        f"date/{date_str}/orderby/date/orderway/desc/charset/GBK/"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/117.0.0.0"
    }
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
    except Exception:
        return pd.DataFrame()
    if data.get("errocode", 0) != 0:
        return pd.DataFrame()
    return pd.DataFrame(data.get("data") or [])


def _daily_dragon_tiger_raw(date_str: str = None) -> List[dict]:
    """全市场龙虎榜 —— a-stock-data 无真实源（mootdx 无 bill、新浪 JSON 失效、腾讯无），
    诚实返回空。情绪信号改由同花顺热点(强势股)替代（见 enrich_with_sentiment）。"""
    return []


def _margin_trading_raw(code: str, page_size: int = 30) -> list:
    """融资融券明细 —— a-stock-data 无真实源，诚实返回空。margin_change_pct 因子保持 None。"""
    return []


def _df_to_payload(df: pd.DataFrame) -> dict:
    return {"columns": list(df.columns), "records": df.to_dict(orient="records")}


def _df_from_payload(payload: dict) -> pd.DataFrame:
    if not payload:
        return pd.DataFrame()
    return pd.DataFrame(payload.get("records", []), columns=payload.get("columns"))


# ═══════════════════════════════════════════════════════════════════════
# 模块级委托包装（保持 signal_engine 历史 API 不变）
# ═══════════════════════════════════════════════════════════════════════

_provider_singleton: Optional[DataProvider] = None


def get_provider() -> DataProvider:
    """返回进程级 DataProvider 单例（缓存目录共享）"""
    global _provider_singleton
    if _provider_singleton is None:
        _provider_singleton = DataProvider()
    return _provider_singleton


def tencent_batch_quote(codes: List[str]) -> Dict[str, dict]:
    return get_provider().quote(codes)


def mootdx_finance_snapshot(code: str) -> dict:
    return get_provider().financial(code)


def financial_statements(code: str, stmt: str = "profit") -> Optional[dict]:
    return get_provider().financial_statements(code, stmt)


def fetch_daily_bars(code: str, start: str = None, end: str = None,
                     max_bars: int = 800) -> Optional[pd.DataFrame]:
    return get_provider().daily_bars(code, start=start, end=end, max_bars=max_bars)


def stock_fund_flow_120d(code: str) -> list:
    return get_provider().fund_flow_120d(code)


def industry_comparison() -> List[dict]:
    return get_provider().industry_ranking()


def ths_hot_reason(date_str: str = None) -> pd.DataFrame:
    return get_provider().hot_stocks(date_str)


def daily_dragon_tiger(date_str: str = None) -> List[dict]:
    return get_provider().dragon_tiger(date_str)


def margin_trading(code: str, page_size: int = 30) -> list:
    return get_provider().margin(code, page_size)


def data_provider_health() -> Dict[str, str]:
    """供外部（如 API 路由）查询数据源健康度"""
    return get_provider().health()
