#!/bin/bash
# 板块资金流 · 收盘后自动渲染包装脚本
# 由 launchd (com.wangzhiping.sectorflow-render.plist) 在交易日 15:05 触发。
# 职责: 算当天日期 -> 校验当天有采集数据 -> 调 render.py 出 MP4/PNG。
# 非交易日 / 无数据 时安全跳过, 不产生垃圾输出。

set -euo pipefail

DIR="/Users/wangzhiping/Claude/大A投研看板/sector_flow_pipeline"
PY="/opt/anaconda3/bin/python3"
DATE="$(date +%Y-%m-%d)"
DOW="$(date +%u)"   # 1=周一 ... 7=周日
DATA="$DIR/data/$DATE.jsonl"
LOG="$DIR/logs/render.out.log"

echo "[$(date '+%F %T')] render_daily start date=$DATE dow=$DOW" >> "$LOG"

# 周末不渲染 (launchd 已限周一~五, 这里再兜底)
if [ "$DOW" -ge 6 ]; then
  echo "[$(date '+%F %T')] 周末, 跳过" >> "$LOG"
  exit 0
fi

# 当天无采集数据 (或空文件) 则跳过, 避免生成空视频
if [ ! -s "$DATA" ]; then
  echo "[$(date '+%F %T')] 无当天数据 $DATA, 跳过 (采集器可能未跑或东财全断)" >> "$LOG"
  exit 0
fi

FRAMES="$(wc -l < "$DATA" | tr -d ' ')"
echo "[$(date '+%F %T')] 数据帧数=$FRAMES, 开始渲染" >> "$LOG"

cd "$DIR"
# 默认取终值前 12 板块, 并强制包含半导体/存储芯片 (可按需改)
"$PY" render.py "$DATE" --top 12 --names 半导体,存储芯片 >> "$LOG" 2>&1

echo "[$(date '+%F %T')] render_daily done -> output/${DATE}_sectorflow.mp4" >> "$LOG"
