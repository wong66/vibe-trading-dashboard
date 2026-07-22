#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块资金流 · 动态折线图渲染器

读取 collector 产出的 data/<date>.jsonl (每天多帧, 每帧一个板块净流入快照),
渲染成 9:16 竖屏 动态折线 MP4 + 终帧 PNG。
  - X 轴: 时间(盘中 9:30 -> 15:00)
  - Y 轴: 主力净流入(亿元)
  - 颜色: 终值为正=红(净流入/涨), 终值为负=绿(净流出/跌), 遵循 A股习惯
  - 动态: 线条沿时间轴从左到右逐点描出(模拟视频里"折线实时生长")

依赖: matplotlib, numpy, ffmpeg(导出 MP4; 缺失时自动回退 GIF)

用法:
  python3 render.py 2026-07-16                 # 渲染真实数据
  python3 render.py 2026-07-16 --demo          # 无真实数据时用合成数据演示
  python3 render.py 2026-07-16 --names 半导体,存储芯片   # 强制画指定板块
  python3 render.py 2026-07-16 --top 12        # 取终值前 12 的板块
"""
import os
import json
import argparse
import datetime
import random

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

RED = "#e23b3b"      # 净流入(涨)
GREEN = "#1a9e4b"    # 净流出(跌)
INK = "#1a1a1a"
MUTED = "#888888"


def _setup_cjk_font():
    """注册一个覆盖中文的字体, 否则板块名会显示为方块。"""
    from matplotlib import font_manager
    candidates = [
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
    ]
    for fp in candidates:
        if not os.path.exists(fp):
            continue
        try:
            font_manager.fontManager.addfont(fp)
            name = font_manager.FontProperties(fname=fp).get_name()
            plt.rcParams["font.sans-serif"] = [name]
            plt.rcParams["axes.unicode_minus"] = False
            print(f"[font] 已注册 CJK 字体: {name} ({fp})")
            return
        except Exception as e:
            print(f"[font] 注册失败 {fp}: {e}")
    print("[font] 未找到 CJK 字体, 中文可能显示为方块")


_setup_cjk_font()


def load_frames(date, data_dir):
    path = os.path.join(data_dir, f"{date}.jsonl")
    if not os.path.exists(path):
        return None
    frames = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            frames.append(json.loads(line))
    frames.sort(key=lambda x: x["epoch"])
    return frames


def make_demo(date):
    """合成全天轨迹(仅用于无真实数据时演示渲染效果, 非真实行情)。"""
    random.seed(20260716)
    names = ["半导体", "存储芯片", "人工智能", "半导体设备", "消费电子",
             "光伏设备", "白酒", "银行", "证券", "汽车零部件"]
    # 漂移: 科技/概念类净流入(正), 防守类净流出(负)
    drift = {"半导体": 0.9, "存储芯片": 1.1, "人工智能": 0.6, "半导体设备": 0.7,
             "消费电子": 0.4, "光伏设备": -0.2, "白酒": -0.8, "银行": -0.5,
             "证券": 0.1, "汽车零部件": 0.2}
    start = datetime.datetime.strptime(f"{date} 09:30:00", "%Y-%m-%d %H:%M:%S")
    frames, vals = [], {n: random.uniform(-1, 1) for n in names}
    for i in range(23):                      # 9:30 -> 15:00, 每 15 分钟一帧
        ts = start + datetime.timedelta(minutes=15 * i)
        for n in names:
            vals[n] += drift[n] + random.uniform(-0.4, 0.4)
        frames.append({
            "ts": ts.strftime("%Y-%m-%dT%H:%M:%S"),
            "epoch": int(ts.timestamp()),
            "sectors": {n: round(vals[n], 3) for n in names},
        })
    return frames


def render(date, data_dir, out_dir, top=10, names=None, demo=False):
    frames = make_demo(date) if demo else load_frames(date, data_dir)
    if not frames:
        print(f"[render] 无数据: {date}  (加 --demo 生成演示数据)")
        return

    times = [datetime.datetime.fromtimestamp(fr["epoch"]) for fr in frames]
    xlabels = [t.strftime("%H:%M") for t in times]

    all_names, final = set(), frames[-1]["sectors"]
    for fr in frames:
        all_names.update(fr["sectors"].keys())

    chosen = [n for n in (names or []) if n in all_names]
    rest = sorted([n for n in all_names if n not in chosen],
                  key=lambda n: final.get(n, 0), reverse=True)
    chosen += rest[:max(0, top - len(chosen))]
    chosen = chosen[:top]

    series, colors = {}, {}
    for n in chosen:
        y, last = [], 0.0
        for fr in frames:
            v = fr["sectors"].get(n)
            last = v if v is not None else last
            y.append(last)
        series[n] = np.array(y, dtype=float)
        colors[n] = RED if final.get(n, 0) >= 0 else GREEN

    X = np.arange(len(frames))
    ymax = max(s.max() for s in series.values()) * 1.12
    ymin = min(s.min() for s in series.values()) * 1.12

    fig, ax = plt.subplots(figsize=(7.2, 12.8), dpi=100)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    lines, dots = {}, {}
    for n in chosen:
        ln, = ax.plot([], [], color=colors[n], linewidth=3.2, label=n)
        lines[n] = ln
        d, = ax.plot([], [], "o", color=colors[n], markersize=9)
        dots[n] = d

    ax.set_xlim(0, len(frames) - 1)
    ax.set_ylim(ymin, ymax)
    ax.set_xticks(X)
    ax.set_xticklabels(xlabels, rotation=45, ha="right", fontsize=12, color=MUTED)
    ax.tick_params(axis="y", labelsize=13)
    ax.set_ylabel("主力净流入 (亿元)", fontsize=14, color=INK)
    ax.axhline(0, color="#cccccc", linewidth=1)
    ax.grid(axis="y", color="#eeeeee", linewidth=1)
    ax.set_title(f"{date} 板块资金流向 · 盘中", fontsize=20,
                 color=INK, fontweight="bold", pad=16)
    ax.legend(loc="upper left", fontsize=12, frameon=False)
    ttext = ax.text(0.98, 0.02, "", transform=ax.transAxes, ha="right",
                    va="bottom", fontsize=16, color=MUTED, fontweight="bold")

    def upd(k):
        for n in chosen:
            lines[n].set_data(X[:k + 1], series[n][:k + 1])
            dots[n].set_data([X[k]], [series[n][k]])
        ttext.set_text(xlabels[min(k, len(xlabels) - 1)])
        return list(lines.values()) + list(dots.values()) + [ttext]

    anim = FuncAnimation(fig, upd, frames=len(frames),
                         interval=350, blit=False, repeat=False)
    os.makedirs(out_dir, exist_ok=True)
    mp4 = os.path.join(out_dir, f"{date}_sectorflow.mp4")
    png = os.path.join(out_dir, f"{date}_sectorflow.png")
    try:
        anim.save(mp4, writer="ffmpeg", fps=6, bitrate=1800)
        print(f"[render] MP4 -> {mp4}")
    except Exception as e:
        print(f"[render] ffmpeg 失败({e}), 回退 GIF")
        anim.save(mp4.replace(".mp4", ".gif"), writer="pillow", fps=6)
    upd(len(frames) - 1)
    fig.savefig(png, dpi=100)
    print(f"[render] PNG -> {png}")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date")
    ap.add_argument("--data-dir",
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    ap.add_argument("--out-dir",
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--names", default="", help="强制包含板块, 逗号分隔, 如 半导体,存储芯片")
    ap.add_argument("--demo", action="store_true", help="无真实数据时用合成数据演示")
    args = ap.parse_args()
    names = [x.strip() for x in args.names.split(",") if x.strip()] or None
    render(args.date, args.data_dir, args.out_dir,
           top=args.top, names=names, demo=args.demo)


if __name__ == "__main__":
    main()
