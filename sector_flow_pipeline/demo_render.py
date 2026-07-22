#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""样例渲染: 用今天真实的同花顺收盘数据作终点, 重建一条 9:30->15:00 的
板块资金流折线轨迹, 喂给 render.py 生成 MP4/PNG。

说明: 收盘值(各板块净额)是真实的同花顺数据; 盘中路径为合理重建(因为现在已过
收盘, 只抓得到收盘这一帧)。仅用于预览视频观感, 不影响正式采集器的逻辑。
"""
import sys, os, json, math, random, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collector as C

PIPE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(PIPE, "data")
OUT_DATE = "2026-07-17"

# 采集器在交易时段的真实触发点(18 帧)
SLOTS = (
    ["09:30", "09:45", "10:00", "10:15", "10:30", "10:45",
     "11:00", "11:15", "11:30"] +
    ["13:00", "13:15", "13:30", "13:45", "14:00", "14:15",
     "14:30", "14:45", "15:00"]
)


def smoothstep(f):
    return f * f * (3 - 2 * f)


def build_frames(real):
    """real: {板块名: 收盘净额(亿)} -> 多帧快照, 终点=真实值, 路径合理重建。"""
    names = list(real.keys())
    random.seed(20260717)
    frames = []
    n = len(SLOTS)
    for i, slot in enumerate(SLOTS):
        f = i / (n - 1)
        ss = smoothstep(f)
        ts = f"{OUT_DATE}T{slot}:00"
        epoch = int(datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S").timestamp())
        sectors = {}
        for name in names:
            E = real[name]
            base = E * ss
            # 盘中自然波动(振幅随 |E| 缩放, 收盘收敛到 E)
            wiggle = E * 0.18 * math.sin(2 * math.pi * (f * 2.3 + hash(name) % 7 / 7.0))
            val = base + wiggle * (1 - f)  # 越接近收盘波动越小
            if i == n - 1:
                val = E  # 终点精确等于真实收盘值
            sectors[name] = round(val, 3)
        frames.append({
            "ts": ts, "epoch": epoch,
            "count": len(sectors), "sectors": sectors,
        })
    return frames


def main():
    print(f"[{datetime.datetime.now():%H:%M:%S}] 拉取真实同花顺收盘快照 ...")
    real = C.fetch_sector_netflow()
    if not real:
        print("  [错误] 同花顺拉取为空 (可能沙箱代理挡了 THS)")
        sys.exit(1)
    print(f"  真实板块数={len(real)}")

    # 选板块: 按 |净额| 取前 12, 并强制纳入 半导体 / 存储芯片
    by_abs = sorted(real.items(), key=lambda kv: abs(kv[1]), reverse=True)
    picked = [n for n, _ in by_abs[:12]]
    for forced in ("半导体", "存储芯片"):
        if forced in real and forced not in picked:
            picked.append(forced)
    sub = {n: real[n] for n in picked}

    frames = build_frames(sub)
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, f"{OUT_DATE}.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        for fr in frames:
            f.write(json.dumps(fr, ensure_ascii=False) + "\n")
    print(f"  已生成 {len(frames)} 帧 -> {path}")
    print(f"  选中板块({len(sub)}): {', '.join(sub.keys())}")
    print("  --names 参数:", ",".join(sub.keys()))


if __name__ == "__main__":
    main()
