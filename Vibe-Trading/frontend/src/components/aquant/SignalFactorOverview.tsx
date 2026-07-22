/**
 * 信号因子概览卡片 — 聚合所有信号的因子数据
 *
 * 展示今日信号集的整体特征：估值分位、ROE、成长、动量、市值分布
 * 帮助用户在进入信号列表前快速把握今日机会的"性格"。
 */

import { Gauge, TrendingUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/Skeleton";

interface SignalFactor {
  pe_percentile?: number;
  pb_percentile?: number;
  roe?: number;
  revenue_growth?: number;
  net_profit_growth?: number;
  ret_20d?: number;
  market_cap_yi?: number;
  main_flow_20d?: number;
  is_st?: boolean;
}

interface Props {
  signals: { factors: SignalFactor }[];
  loading?: boolean;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

// 迷你指标条
function MetricBar({
  label, value, max = 100, unit = "", colorClass, suffix = "",
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  colorClass: string;
  suffix?: string;
}) {
  const width = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value.toFixed(unit === "%" ? 0 : 1)}{unit}{suffix}
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
        <div className={cn("h-full rounded-full", colorClass)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function SignalFactorOverview({ signals, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 px-2 py-3 border-b bg-card/20">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (signals.length === 0) return null;

  const factors = signals.map((s) => s.factors);
  const total = factors.length;

  // ── 估值维度 ──
  const pePct = factors.map((f) => f.pe_percentile ?? NaN).filter((v) => !isNaN(v));
  const pbPct = factors.map((f) => f.pb_percentile ?? NaN).filter((v) => !isNaN(v));

  // ── 质量/成长维度 ──
  const roes = factors.map((f) => f.roe ?? NaN).filter((v) => !isNaN(v));
  const revGrows = factors.map((f) => f.revenue_growth ?? NaN).filter((v) => !isNaN(v));
  const npGrows = factors.map((f) => f.net_profit_growth ?? NaN).filter((v) => !isNaN(v));

  // ── 动量维度 ──
  const ret20ds = factors.map((f) => f.ret_20d ?? NaN).filter((v) => !isNaN(v));
  const mainFlows = factors.map((f) => f.main_flow_20d ?? NaN).filter((v) => !isNaN(v));

  // ── 健康度占比 ──
  const lowPe = pePct.filter((v) => v < 30).length;           // 低估值分位（安全边际高）
  const goodRoe = roes.filter((v) => v >= 10).length;         // 高ROE
  const posRev = revGrows.filter((v) => v > 0).length;         // 正营收增长
  const posRet = ret20ds.filter((v) => v > 0).length;          // 20日上涨
  const inflow = mainFlows.filter((v) => v > 0.5).length;      // 主力流入

  // ── 市值分布 ──
  const bigCaps = factors.filter((f) => (f.market_cap_yi ?? 0) >= 1000).length;
  const midCaps = factors.filter((f) => {
    const mc = f.market_cap_yi ?? 0;
    return mc >= 200 && mc < 1000;
  }).length;
  const smallCaps = factors.filter((f) => (f.market_cap_yi ?? 0) < 200).length;

  return (
    <div className="grid grid-cols-3 gap-2 px-2 py-3 border-b bg-card/20 col-span-3">
      {/* 估值 + 质量 + 成长 */}
      <div className="p-2.5 rounded-lg border bg-card space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-0.5">
          <Gauge className="h-3.5 w-3.5 text-blue-500" />
          估值与质量
        </div>
        <MetricBar label="平均PE分位" value={avg(pePct)} unit="%" colorClass="bg-blue-500" />
        <MetricBar label="平均PB分位" value={avg(pbPct)} unit="%" colorClass="bg-cyan-500" />
        <MetricBar label="平均ROE" value={avg(roes)} unit="%" colorClass="bg-emerald-500" />
        {/* 健康度标签 */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20">
            低估值 {pct(lowPe, pePct.length)}%
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20">
            高ROE {pct(goodRoe, roes.length)}%
          </span>
        </div>
      </div>

      {/* 成长 + 动量 */}
      <div className="p-2.5 rounded-lg border bg-card space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-0.5">
          <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
          成长与动量
        </div>
        <MetricBar label="平均营收增速" value={avg(revGrows)} unit="%" colorClass="bg-purple-500" />
        <MetricBar label="平均利润增速" value={avg(npGrows)} unit="%" colorClass="bg-fuchsia-500" />
        <MetricBar label="平均20日涨幅" value={avg(ret20ds)} unit="%" colorClass="bg-orange-500" />
        <div className="flex flex-wrap gap-1 pt-0.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20">
            正增长 {pct(posRev, revGrows.length)}%
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 dark:bg-orange-900/20">
            20日上涨 {pct(posRet, ret20ds.length)}%
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-900/20">
            主力流入 {pct(inflow, mainFlows.length)}%
          </span>
        </div>
      </div>

      {/* 市值风格分布 */}
      <div className="p-2.5 rounded-lg border bg-card">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
          <Layers className="h-3.5 w-3.5 text-amber-500" />
          市值风格分布
        </div>
        <div className="space-y-1.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">大盘股 (≥1000亿)</span>
              <span className="font-semibold tabular-nums">{bigCaps}只</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct(bigCaps, total)}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">中盘股 (200-1000亿)</span>
              <span className="font-semibold tabular-nums">{midCaps}只</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct(midCaps, total)}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">小盘股 (&lt;200亿)</span>
              <span className="font-semibold tabular-nums">{smallCaps}只</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full bg-amber-300 rounded-full" style={{ width: `${pct(smallCaps, total)}%` }} />
            </div>
          </div>
        </div>
        <p className="text-[9px] text-muted-foreground/60 mt-1 leading-relaxed">
          如需更精确的板块资金流向，请接入行业板块实时接口。
        </p>
      </div>
    </div>
  );
}
