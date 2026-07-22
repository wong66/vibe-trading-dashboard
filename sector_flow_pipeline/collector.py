#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块资金流 · 盘中快照采集器 (数据源: 同花顺 THS, 非东财)

每次调用: 拉取同花顺「行业板块(hyzjl) + 概念板块(gnzjl)」的主力净流入(净额, 亿元),
          把每个板块的当日净流入(亿元)作为一帧, 追加到 data/<date>.jsonl。

为什么用同花顺而非东财:
  - 用户公司网络下东财(push2)被代理/防火墙全断, 东财接口拿不到数据。
  - 同花顺 data.10jqka.com.cn 在用户网络可达(health()=ths ok)。
  - THS 把完整板块资金流表格(含 净额/流入/流出/涨跌幅)服务端直出在 HTML 里,
    解析 tbody 即可, 零鉴权、零 cookie, 简单可靠。

数据格式: 每个板块的 "净额(亿)" = 主力净流入, 与东财 f62 同义。
          连起来的多帧就是各板块的全天资金流折线。

用法:
  python3 collector.py                 # 采集当前一帧(默认)
  python3 collector.py --once          # 同上
  python3 collector.py --data-dir X   # 指定数据目录
"""
import sys
import os
import re
import json
import html
import time
import datetime
import argparse

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
THS_INTERVAL = 1.0          # 同花顺最小间隔(秒), 防封
_last_call = [0.0]

# 行业板块 + 概念板块 两个页面
THS_PAGES = {
    "hy": "https://data.10jqka.com.cn/funds/hyzjl/",   # 行业资金流
    "gn": "https://data.10jqka.com.cn/funds/gnzjl/",   # 概念资金流
}


def _throttle():
    elapsed = time.time() - _last_call[0]
    if elapsed < THS_INTERVAL:
        time.sleep(THS_INTERVAL - elapsed)
    _last_call[0] = time.time()


def fetch_page(url):
    """拉一页 THS 板块资金流, 返回 {板块名: 净额_亿元}。"""
    import urllib.request
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://data.10jqka.com.cn/",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    # THS 页面是 gbk 编码
    txt = raw.decode("gbk", "ignore")
    tbody = re.search(r"<tbody[^>]*>(.*?)</tbody>", txt, re.S)
    if not tbody:
        return {}
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", tbody.group(1), re.S):
        nm = re.search(r'target="_blank">([^<]+)</a>', row)
        if not nm:
            continue
        name = html.unescape(nm.group(1)).strip()
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        texts = [html.unescape(re.sub(r"<[^>]+>", "", t)).strip() for t in tds]
        if len(texts) < 7:
            continue
        net_raw = texts[6].replace("%", "").replace(",", "")
        try:
            net = float(net_raw)
        except ValueError:
            continue
        out[name] = round(net, 4)
    return out


def fetch_sector_netflow():
    """行业 + 概念 板块主力净流入合并。"""
    parts = {}
    for key, url in THS_PAGES.items():
        try:
            _throttle()
            parts.update(fetch_page(url))
        except Exception as e:
            print(f"  [warn] 拉取 {key} 失败: {e}")
    return parts


def in_trading_time(now=None):
    """只在交易时段采集: 周一~周五 9:30-11:30, 13:00-15:00。"""
    now = now or datetime.datetime.now()
    if now.weekday() >= 5:                    # 周六/日
        return False
    t = now.time()
    am = datetime.time(9, 30) <= t <= datetime.time(11, 30)
    pm = datetime.time(13, 0) <= t <= datetime.time(15, 0)
    return am or pm


def collect_once(data_dir):
    now = datetime.datetime.now()
    if not in_trading_time(now):
        print(f"[{now:%Y-%m-%d %H:%M}] 非交易时段, 跳过")
        return False
    try:
        sectors = fetch_sector_netflow()
    except Exception as e:
        print(f"[{now:%Y-%m-%d %H:%M}] 拉取失败: {e}")
        return False
    if not sectors:
        print(f"[{now:%Y-%m-%d %H:%M}] 返回为空(同花顺可能被挡), 跳过")
        return False
    snap = {
        "ts": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "epoch": int(now.timestamp()),
        "count": len(sectors),
        "sectors": sectors,
    }
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, f"{now:%Y-%m-%d}.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(snap, ensure_ascii=False) + "\n")
    print(f"[{now:%Y-%m-%d %H:%M}] 已存 {len(sectors)} 个板块 -> {path}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="采集一帧(默认行为)")
    ap.add_argument("--data-dir",
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    args = ap.parse_args()
    collect_once(args.data_dir)


if __name__ == "__main__":
    main()
