/**
 * 信号统计组件 — 展示当日信号的质量分布、板块分布、评分区间、因子健康度
 */

import { PieChart, BarChart3, Layers, Activity, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";

interface SignalRecord {
  score: number;
  sector: string;
  factors: {
    main_flow_20d?: number;
    dragon_tiger_signal?: number;
    ret_20d?: number;
    pe_percentile?: number;
    roe?: number;
    revenue_growth?: number;
  };
}

interface Props {
  signals: SignalRecord[];
  loading?: boolean;
}

export function SignalStats({ signals, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b bg-card/20">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (signals.length === 0) return null;

  const total = signals.length;
  const excellent = signals.filter((s) => s.score >= 80).length;
  const good = signals.filter((s) => s.score >= 60 && s.score < 80).length;
  const average = signals.filter((s) => s.score < 60).length;
  const withFlow = signals.filter((s) => (s.factors.main_flow_20d ?? 0) > 0.5).length;
  const withDT = signals.filter((s) => s.factors.dragon_tiger_signal === 1).length;

  // 涨跌幅分布
  const strongUp = signals.filter((s) => (s.factors.ret_20d ?? 0) > 10).length;
  const up = signals.filter((s) => (s.factors.ret_20d ?? 0) > 0 && (s.factors.ret_20d ?? 0) <= 10).length;
  const down = signals.filter((s) => (s.factors.ret_20d ?? 0) < 0).length;

  // 因子健康度
  const lowPe = signals.filter((s) => (s.factors.pe_percentile ?? 100) < 30).length;   // 低估值分位
  const highRoe = signals.filter((s) => (s.factors.roe ?? 0) >= 10).length;              // 高ROE
  const posGrowth = signals.filter((s) => (s.factors.revenue_growth ?? 0) > 0).length;  // 正增长

  // 板块分布 TOP3
  const sectorMap = new Map<string, number>();
  signals.forEach((s) => {
    sectorMap.set(s.sector, (sectorMap.get(s.sector) || 0) + 1);
  });
  const topSectors = Array.from(sectorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b bg-card/20">
      {/* 评分分布 */}
      <div className="p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <PieChart className="h-3.5 w-3.5 text-purple-500" />
          评分分布
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden flex">
            <div className="h-full bg-[#ef4444]" style={{ width: `${(excellent / total) * 100}%` }} />
            <div className="h-full bg-amber-400" style={{ width: `${(good / total) * 100}%` }} />
            <div className="h-full bg-slate-400" style={{ width: `${(average / total) * 100}%` }} />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px]">
          <span className="text-[#ef4444] font-medium">优秀 {excellent}</span>
          <span className="text-amber-500 font-medium">良好 {good}</span>
          <span className="text-muted-foreground">一般 {average}</span>
        </div>
      </div>

      {/* 资金特征 */}
      <div className="p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <BarChart3 className="h-3.5 w-3.5 text-emerald-500" />
          资金特征
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-2 rounded bg-emerald-50 dark:bg-emerald-900/20">
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{withFlow}</div>
            <div className="text-[10px] text-muted-foreground">主力流入</div>
          </div>
          <div className="text-center p-2 rounded bg-purple-50 dark:bg-purple-900/20">
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400">{withDT}</div>
            <div className="text-[10px] text-muted-foreground">龙虎榜</div>
          </div>
        </div>
      </div>

      {/* 动量分布 */}
      <div className="p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <Activity className="h-3.5 w-3.5 text-orange-500" />
          20日动量
        </div>
        <div className="space-y-1 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[#ef4444]">强涨 &gt;10%</span>
            <span className="font-medium tabular-nums">{strongUp}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-amber-500">小涨 0-10%</span>
            <span className="font-medium tabular-nums">{up}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#22c55e]">下跌</span>
            <span className="font-medium tabular-nums">{down}</span>
          </div>
        </div>
      </div>

      {/* 因子健康度 */}
      <div className="p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
          因子健康度
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">低PE分位 (&lt;30%)</span>
            <span className="font-medium text-blue-600 tabular-nums">
              {lowPe}/{total}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">高ROE (≥10%)</span>
            <span className="font-medium text-emerald-600 tabular-nums">
              {highRoe}/{total}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">正营收增长</span>
            <span className="font-medium text-purple-600 tabular-nums">
              {posGrowth}/{total}
            </span>
          </div>
        </div>
      </div>

      {/* 板块分布 TOP3（跨列整宽） */}
      <div className="col-span-2 lg:col-span-4 p-3 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <Layers className="h-3.5 w-3.5 text-blue-500" />
          板块分布 TOP3
        </div>
        <div className="grid grid-cols-3 gap-3">
          {topSectors.map(([sector, count]) => (
            <div key={sector} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/30">
              <span className="truncate font-medium">{sector}</span>
              <span className="font-semibold tabular-nums text-primary ml-2 shrink-0">{count}只</span>
            </div>
          ))}
          {topSectors.length === 0 && (
            <span className="text-[10px] text-muted-foreground">暂无板块数据</span>
          )}
        </div>
      </div>
    </div>
  );
}
