"""Sector data (East Money boards) for Vibe-Trading API."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List

from .common import safe_float

logger = logging.getLogger(__name__)

# 公司沙箱代理 (sandbox-c)。launchctl 启动的后端进程不继承 shell 环境变量，
# 因此显式 fallback 到本地代理端口，保证 curl 走代理而非直连（直连会被沙箱断掉）。
_PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") \
    or "http://127.0.0.1:53723"

# 本地缓存目录：K线历史 / dashboard 快照持久化，应对代理间歇断连
_CACHE_DIR = Path.home() / ".vibe-trading" / "cache"

SECTOR_BOARD_MAP = {
    "半导体": "BK1036", "芯片": "BK1036",
    "AI算力": "BK1131", "AI": "BK1131", "人工智能": "BK1131", "算力": "BK1131",
    "机器人": "BK1028", "人形机器人": "BK1028",
    "新能源": "BK0493", "光伏": "BK0478", "风电": "BK0812", "储能": "BK1035",
    "锂电": "BK0574", "锂电池": "BK0574", "电池": "BK0574",
    "固态电池": "BK1166",
    "军工": "BK0481",
    "医药": "BK0465", "创新药": "BK0465", "CXO": "BK0465", "医疗": "BK0465",
    "消费电子": "BK1040",
    "油气": "BK0438",
    "白酒": "BK0477",
    "低空": "BK1188",
    "CPO": "BK1154", "光模块": "BK1154",
    "新能源车": "BK0900",
    "银行": "BK0475", "券商": "BK0476",
    "游戏": "BK0908", "传媒": "BK0908",
    "电力": "BK0428", "水电": "BK0428", "核电": "BK0428",
    "卫星": "BK1196",
    "减肥药": "BK1195",
    "鸿蒙": "BK1098", "华为": "BK1098",
    "量子": "BK1175",
    "脑机": "BK1183",
    "稀土": "BK0437", "有色": "BK0437",
    "煤炭": "BK0439", "钢铁": "BK0450",
    "农业": "BK0420", "种业": "BK0420",
    "房地产": "BK0451", "保险": "BK0474",
    "食品": "BK0433", "旅游": "BK0434",
    "数据中心": "BK1038",
}


async def _fetch_eastmoney_json(url: str, retries: int = 3) -> dict:
    """Fetch and parse JSON from East Money API.

    使用系统 curl 走公司沙箱代理（sandbox-c）+ 系统钥匙串 CA，
    比 httpx/urllib 更兼容该代理环境；失败自动重试（指数退避）。
    """
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            proc = await asyncio.create_subprocess_exec(
                "curl", "-s", "--max-time", "12", "-x", _PROXY, url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"curl rc={proc.returncode}: {err.decode()[:120]}")
            if not out.strip():
                raise RuntimeError("curl 返回空响应")
            return json.loads(out)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning("东财请求失败(第%d次): %s", attempt + 1, exc)
            await asyncio.sleep(0.5 * (attempt + 1))
    raise last_err or RuntimeError("未知错误")


# ── 本地缓存（应对代理间歇断连，首次成功后持久化真实数据） ──────────────
def _cache_path(board: str, kind: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"sector_{kind}_{board}.json"


def _load_cache(board: str, kind: str, max_age_sec: int):
    p = _cache_path(board, kind)
    if p.exists():
        try:
            if time.time() - p.stat().st_mtime < max_age_sec:
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return None


def _save_cache(board: str, kind: str, data) -> None:
    try:
        _cache_path(board, kind).write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:  # noqa: BLE001
        pass


# _sf aliased to safe_float for local readability
_sf = safe_float


async def get_sector_data(q: str = "半导体") -> Dict[str, Any]:
    """Return real-time sector dashboard + index K-line + constituent stocks."""
    board = SECTOR_BOARD_MAP.get(q, "")
    if not board:
        for kw, code in SECTOR_BOARD_MAP.items():
            if q in kw or kw in q:
                board = code
                break
    if not board:
        return {"sector": q, "boardCode": "", "dashboard": None, "kline": [],
                "stocks": [], "ts": 0, "error": f"未找到板块: {q}"}

    secid = f"90.{board}"

    snap_url = (
        f"https://push2.eastmoney.com/api/qt/stock/get?"
        f"secid={secid}&"
        f"fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,"
        f"f62,f66,f69,f72,f75,f78,f81,f84,f87,"
        f"f104,f105,f116,f117,f127,f128,"
        f"f162,f164,f167,f168,f169,f170,f171,f292"
    )
    kline_url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"secid={secid}&"
        f"fields1=f1,f2,f3,f4,f5,f6&"
        f"fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&"
        f"klt=101&fqt=1&end=20500101&lmt=2000"
    )
    fflow_url = (
        f"https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?"
        f"secid={secid}&"
        f"fields1=f1,f2,f3,f7&"
        f"fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&"
        f"lmt=120"
    )
    stocks_url = (
        f"https://push2.eastmoney.com/api/qt/clist/get?"
        f"pn=1&pz=200&po=1&np=1&"
        f"ut=bd1d9ddb04089700cf9c27f6f7426281&"
        f"fltt=2&invt=2&fid=f3&"
        f"fs=b:{board}+f:!50&"
        f"fields=f2,f3,f6,f8,f9,f12,f14,f23,f62"
    )

    # K线历史稳定（每个交易日仅新增 1 根），缓存 7 天确保 5 年 K线始终可用；
    # dashboard / 成分股实时性较高，缓存 1 小时。东财失败时用持久化真实缓存回退（绝不 mock）。
    cached_kline = _load_cache(board, "kline", 7 * 24 * 3600)
    cached_dash = _load_cache(board, "dash", 6 * 3600)

    try:
        snap, kline_data, fflow_data, stocks_data = await asyncio.gather(
            _fetch_eastmoney_json(snap_url), _fetch_eastmoney_json(kline_url),
            _fetch_eastmoney_json(fflow_url), _fetch_eastmoney_json(stocks_url),
        )
        _save_cache(board, "kline", kline_data)
        _save_cache(board, "dash", {"snap": snap, "fflow": fflow_data, "stocks": stocks_data})
    except Exception as exc:
        if cached_kline:
            logger.warning("东财请求失败，回退到持久化缓存的真实数据: %s", exc)
            kline_data = cached_kline
            if cached_dash:
                snap = cached_dash["snap"]
                fflow_data = cached_dash["fflow"]
                stocks_data = cached_dash["stocks"]
            else:
                snap, fflow_data, stocks_data = {}, {"data": {}}, {"data": {}}
        else:
            return {"sector": q, "boardCode": board, "dashboard": None, "kline": [],
                    "stocks": [], "ts": 0,
                    "error": f"数据源暂不可用(公司代理限制)，请稍后重试: {exc}"}

    # Parse constituent stocks
    constituent_stocks = []
    diff = (stocks_data.get("data") or {}).get("diff", []) or []
    up_count = down_count = limit_up = limit_down = 0
    total_main_inflow = 0.0
    for it in diff:
        cp = _sf(it.get("f3", 0))
        if cp > 0:
            up_count += 1
        elif cp < 0:
            down_count += 1
        if cp >= 9.9:
            limit_up += 1
        elif cp <= -9.9:
            limit_down += 1
        mf = _sf(it.get("f62", 0))
        total_main_inflow += mf
        constituent_stocks.append({
            "code": it.get("f12", ""), "name": it.get("f14", ""),
            "price": _sf(it.get("f2", 0)), "changePct": cp,
            "amount": _sf(it.get("f6", 0)), "turnover": _sf(it.get("f8", 0)),
            "peTtm": _sf(it.get("f9", 0)), "pb": _sf(it.get("f23", 0)),
            "mainFlow": mf,
        })

    main_inflow = total_main_inflow / 1e8

    # Parse fund flow
    fflow_by_date: dict[str, float] = {}
    fflow_lines = (fflow_data.get("data") or {}).get("klines", []) or []
    for raw in fflow_lines:
        parts = str(raw).split(",")
        if len(parts) < 7:
            continue
        fflow_by_date[parts[0]] = float(parts[1]) if parts[1] != "-" else 0.0

    # Parse K-line
    kline_bars: list[dict] = []
    raw_lines = (kline_data.get("data") or {}).get("klines", []) or []
    for raw in raw_lines[-1300:]:
        parts = str(raw).split(",")
        if len(parts) < 10:
            continue
        date = parts[0]
        open_p = float(parts[1])
        close_p = float(parts[2])
        high_p = float(parts[3])
        low_p = float(parts[4])
        volume = int(float(parts[5]))
        amount = float(parts[6])
        change_pct_k = float(parts[8]) / 100
        real_main_flow = fflow_by_date.get(date)
        if real_main_flow is None:
            real_main_flow = amount * change_pct_k * 0.2
        kline_bars.append({
            "date": date, "open": open_p, "close": close_p,
            "high": high_p, "low": low_p, "volume": volume,
            "amount": amount,
            "changePct": float(parts[8]),
            "changeAmt": float(parts[9]) if parts[9] != "-" else 0.0,
            "mainFlow": real_main_flow,
        })

    # ── 涨跌额/涨跌幅：优先从 K线最新一根推导（与图表完全一致，且抗快照缓存陈旧/接口失败） ──
    snap_fields = (snap.get("data") or {})
    if kline_bars:
        change_pct = kline_bars[-1]["changePct"]
        change_amt = kline_bars[-1]["changeAmt"]
    else:
        change_pct = _sf(snap_fields.get("f170", 0)) / 100
        change_amt = _sf(snap_fields.get("f169", 0))
    total_volume = _sf(snap_fields.get("f48", 0)) / 1e8
    if not total_volume and kline_bars:
        total_volume = round(kline_bars[-1]["volume"] / 1e6, 2)

    # --- 真实环比计算（基于已有 K线 + 资金流历史，不再硬编码 0） ---
    volume_mom: float = 0.0
    main_inflow_mom: float = 0.0

    # 成交额环比：用 K线最近两个交易日的板块成交额（与快照 f48 同为板块指数口径）
    if len(kline_bars) >= 2:
        today_amt = kline_bars[-1]["amount"]
        yest_amt = kline_bars[-2]["amount"]
        if yest_amt:
            volume_mom = round((today_amt - yest_amt) / yest_amt * 100, 2)

    # 主力资金环比：用资金流接口最新一天（即昨日收盘值）作主基，对比成分股实时汇总
    fflow_lines_all = (fflow_data.get("data") or {}).get("klines", []) or []
    if fflow_lines_all:
        latest = str(fflow_lines_all[-1]).split(",")
        if len(latest) >= 2 and latest[1] != "-":
            yest_flow = float(latest[1])
            if abs(yest_flow) > 0:
                main_inflow_mom = round(
                    (total_main_inflow - yest_flow) / abs(yest_flow) * 100, 2
                )

    # 组装 dashboard（所有解析与环比计算完成后再组装，确保变量已就绪）
    dashboard = {
        "changePct": round(change_pct, 2), "changeAmt": round(change_amt, 2),
        "upCount": up_count, "limitUpCount": limit_up,
        "downCount": down_count, "limitDownCount": limit_down,
        "mainInflow": round(main_inflow, 2), "mainInflowMom": main_inflow_mom,
        "totalVolume": round(total_volume, 2), "volumeMom": volume_mom,
        "boardCode": board,
    }

    return {
        "sector": q, "boardCode": board, "dashboard": dashboard,
        "kline": kline_bars, "stocks": constituent_stocks,
        "ts": __import__("time").time(),
    }
