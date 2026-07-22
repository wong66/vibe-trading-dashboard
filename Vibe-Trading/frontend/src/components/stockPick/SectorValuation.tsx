import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { type KlineItem } from "@/lib/stockPickData";

export function SectorValuation({ klineData, sector }: { klineData: KlineItem[]; sector: string }) {
  const stats = useMemo(() => {
    const peList = klineData.map(d => d.pe).filter((v): v is number => v !== undefined);
    const pbList = klineData.map(d => d.pb).filter((v): v is number => v !== undefined);
    if (peList.length === 0) return null;

    const sorted = [...peList].sort((a, b) => a - b);
    const lastPE = peList[peList.length - 1];
    const lastPB = pbList[pbList.length - 1];
    const medianPE = sorted[Math.floor(sorted.length / 2)];
    const minPE = sorted[0];
    const maxPE = sorted[sorted.length - 1];
    const percentile = Math.round((peList.filter(v => v <= lastPE).length / peList.length) * 100);

    let status: { text: string; color: string; bg: string };
    if (percentile >= 75) status = { text: "高估", color: "text-rose-600", bg: "bg-rose-50" };
    else if (percentile >= 50) status = { text: "合理偏贵", color: "text-amber-600", bg: "bg-amber-50" };
    else if (percentile >= 25) status = { text: "合理", color: "text-emerald-600", bg: "bg-emerald-50" };
    else status = { text: "低估", color: "text-blue-600", bg: "bg-blue-50" };

    return { lastPE, lastPB, medianPE, minPE, maxPE, percentile, status };
  }, [klineData]);

  if (!stats) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{sector} 行业估值</span>
          <span className="text-xs text-muted-foreground">暂无数据</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{sector} 行业估值</span>
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", stats.status.bg, stats.status.color)}>
            {stats.status.text}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">基于近 3 个月数据</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">PE(TTM)</p>
          <p className="text-2xl font-bold text-foreground">{stats.lastPE.toFixed(1)}x</p>
          <p className="text-xs text-muted-foreground">中位数 {stats.medianPE.toFixed(1)}x</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">PB</p>
          <p className="text-2xl font-bold text-foreground">{stats.lastPB?.toFixed(1) ?? "-"}x</p>
          <p className="text-xs text-muted-foreground">当前估值</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">历史分位</p>
          <p className="text-2xl font-bold text-foreground">{stats.percentile}%</p>
          <p className="text-xs text-muted-foreground">近 3 个月</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">PE 区间</p>
          <p className="text-lg font-bold text-foreground">
            {stats.minPE.toFixed(1)}x ~ {stats.maxPE.toFixed(1)}x
          </p>
          <p className="text-xs text-muted-foreground">最低 / 最高</p>
        </div>
      </div>

      {/* Percentile bar */}
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-rose-500 rounded-full"
          style={{ width: `${stats.percentile}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>低估</span>
        <span>历史分位 {stats.percentile}%</span>
        <span>高估</span>
      </div>
    </div>
  );
}
