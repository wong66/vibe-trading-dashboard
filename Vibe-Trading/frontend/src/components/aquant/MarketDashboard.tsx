/**
 * 市场仪表盘组件 — 展示指数行情、市场广度、北向资金、分维度温度
 *
 * 指数行情：独立调用 GET /market-data（与「行情总览」同一接口），
 *           不依赖 /aquant/market/temperature 的 indexes 字段（该字段缺美股）。
 * 温度/广度/北向/风格：仍来自 /aquant/market/temperature。
 */

import { useState, useEffect } from "react";
import {
  TrendingUp, TrendingDown,
  Activity, Globe,
  Thermometer, Zap, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/Skeleton";
import { api, type IndexQuote as ApiIndexQuote } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────

interface IndexQuote {
  name: string;
  price: number;
  change_pct: number;
  change_amt?: number;
}

interface MarketBreadth {
  up_count: number;
  down_count: number;
  total: number;
  ad_ratio: number;
  breadth_pct: number;
  industry_count?: number;
}

interface NorthboundFlow {
  hgt_yi: number;
  sgt_yi: number;
  total_yi: number;
  direction: string;
  available: boolean;
}

interface MarketData {
  value: number;
  label: string;
  style: string;
  capital_flow: string;
  breadth_temp?: number;
  fund_temp?: number;
  sentiment_temp?: number;
  breadth?: MarketBreadth;
  northbound?: NorthboundFlow;
}

interface Props {
  data: MarketData | null;
  loading?: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────

// 与「行情总览」Overview.tsx INDICES 完全一致
const INDEX_ORDER = [
  { code: "sh000001", label: "上证指数" },
  { code: "sh000300", label: "沪深300" },
  { code: "sz399006", label: "创业板指" },
  { code: "IXIC",     label: "纳斯达克" },
  { code: "GSPC",     label: "标普500" },
  { code: "DJI",      label: "道琼斯" },
];

function formatChange(pct: number) {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatChangeAmt(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────

/** 完全复刻 Overview.tsx 的 IndexCard 样式 */
function IndexCard({
  label, data, loading,
}: {
  label: string;
  data?: IndexQuote;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-28 rounded-xl" />;
  }

  if (!data) {
    return (
      <div className="border border-[#ef4444]/30 rounded-xl p-4 bg-[#ef4444]/5 space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-[#ef4444]/70">暂无数据</p>
      </div>
    );
  }

  const up = (data.change_amt ?? 0) > 0;
  const down = (data.change_amt ?? 0) < 0;

  return (
    <div className="border rounded-xl p-3 bg-card space-y-1">
      <p className="text-[11px] text-muted-foreground truncate" title={data.name}>
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums leading-tight">
        {data.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
      <div className={cn(
        "flex items-center gap-1 text-xs font-mono tabular-nums",
        up ? "text-[#ef4444]" : down ? "text-[#22c55e]" : "text-muted-foreground",
      )}>
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : down ? <TrendingDown className="h-3.5 w-3.5" /> : null}
        <span>{formatChangeAmt(data.change_amt ?? (data.price * data.change_pct / 100))}</span>
        <span className="ml-1">({formatChange(data.change_pct)})</span>
      </div>
    </div>
  );
}

/**
 * 市场广度 — 有真实数据时显示涨跌分布条；无数据时不渲染（避免空白）。
 */
function BreadthBar({
  breadth,
}: {
  breadth: MarketBreadth;
}) {
  if (breadth.total <= 0) return null;

  const total = Math.max(breadth.total, 1);
  const upPct = (breadth.up_count / total) * 100;
  const downPct = (breadth.down_count / total) * 100;
  const neutralPct = 100 - upPct - downPct;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground flex items-center gap-1">
            <Activity className="h-3.5 w-3.5" />
            市场广度
          </span>
          <span className="text-[10px] text-muted-foreground">
            涨跌比 {breadth.ad_ratio.toFixed(2)} · 上涨占比 {breadth.breadth_pct.toFixed(1)}%
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-muted/50 overflow-hidden flex">
          <div className="h-full bg-[#ef4444]" style={{ width: `${upPct}%` }} title={`涨 ${breadth.up_count}`} />
          <div className="h-full bg-[#9ca3af]" style={{ width: `${neutralPct}%` }} title={`平 ${total - breadth.up_count - breadth.down_count}`} />
          <div className="h-full bg-[#22c55e]" style={{ width: `${downPct}%` }} title={`跌 ${breadth.down_count}`} />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[#ef4444] font-medium">涨 {breadth.up_count.toLocaleString()}</span>
          <span className="text-[#9ca3af]">平 {Math.max(0, total - breadth.up_count - breadth.down_count).toLocaleString()}</span>
          <span className="text-[#22c55e] font-medium">跌 {breadth.down_count.toLocaleString()}</span>
        </div>
      </div>
    );
}

function NorthboundCard({ flow }: { flow: NorthboundFlow }) {
  if (!flow.available) {
    return (
      <div className="flex flex-col gap-2 px-3 pb-2.5 pt-2 rounded-xl border bg-card">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Globe className="h-3.5 w-3.5" />
          北向资金
        </span>
        <span className="text-xs text-muted-foreground">数据暂不可用</span>
      </div>
    );
  }

  const isInflow = flow.total_yi >= 0;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2 rounded-xl border bg-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <Globe className="h-3.5 w-3.5" />
          北向资金
        </span>
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded font-medium",
          isInflow ? "bg-[#fef2f2] text-[#ef4444]" : "bg-[#f0fdf4] text-[#22c55e]",
        )}>
          {isInflow ? "流入" : "流出"}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn(
          "text-lg font-bold tabular-nums",
          isInflow ? "text-[#ef4444]" : "text-[#22c55e]",
        )}>
          {isInflow ? "+" : ""}{flow.total_yi.toFixed(1)}亿
        </span>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>沪股通 {flow.hgt_yi > 0 ? "+" : ""}{flow.hgt_yi.toFixed(1)}亿</span>
        <span>深股通 {flow.sgt_yi > 0 ? "+" : ""}{flow.sgt_yi.toFixed(1)}亿</span>
      </div>
    </div>
  );
}

function TempDimension({
  label, value, icon: Icon, colorClass,
}: { label: string; value: number; icon: any; colorClass: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1">
          <Icon className={cn("h-3.5 w-3.5", colorClass)} />
          {label}
        </span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full", colorClass.replace("text-", "bg-"))}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function MarketDashboard({ data, loading: propsLoading }: Props) {
  // ── 独立获取指数数据（与总览页同源：GET /market-data）──────────
  const [indexMap, setIndexMap] = useState<Record<string, IndexQuote>>({});
  const [indexLoading, setIndexLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIndexLoading(true);
    const codes = INDEX_ORDER.map(i => i.code);
    api.getMarketData({ indices: codes, stocks_a: [], stocks_us: [] })
      .then(res => {
        if (!cancelled) {
          // 映射为统一格式
          const map: Record<string, IndexQuote> = {};
          for (const [code, q] of Object.entries(res.indices)) {
            const iq = q as unknown as ApiIndexQuote;
            if (iq && !iq.error) {
              map[code] = {
                name: iq.name || code,
                price: iq.price,
                change_pct: iq.change_pct,
                change_amt: iq.change_amt ?? (iq.price * iq.change_pct / 100),
              };
            }
          }
          setIndexMap(map);
        }
      })
      .catch(() => { /* keep existing state */ })
      .finally(() => { if (!cancelled) setIndexLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── 骨架屏 ─────────────────────────────────────────────────────
  if (propsLoading || !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 border-b bg-card/30">
        <div className="lg:col-span-2 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ── 主渲染 ─────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3 border-b bg-card/30 items-start">
      {/* 左侧：指数行情（独立数据源）+ 市场广度 */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <BarChart3 className="h-3.5 w-3.5" />
            指数行情
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {INDEX_ORDER.map(({ code, label }) => (
            <IndexCard
              key={code}
              label={label}
              data={indexMap[code]}
              loading={indexLoading}
            />
          ))}
        </div>

        {data.breadth && <BreadthBar breadth={data.breadth} />}
      </div>

      {/* 右侧：温度 + 北向（一行并排） */}
      <div className="space-y-3">
        {/* 温度 + 北向 一行两列 */}
        <div className="grid grid-cols-2 gap-3 items-start">
          {/* 综合温度 */}
          <div className="px-3 pb-2.5 pt-2 rounded-xl border bg-card">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5" />
                综合温度
              </span>
              <span className={cn(
                "text-lg font-bold tabular-nums",
                data.value > 70 ? "text-[#ef4444]" : data.value > 40 ? "text-amber-500" : "text-[#22c55e]",
              )}>
                {data.value}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{data.label}</p>
            <div className="mt-1.5 space-y-1">
              <TempDimension
                label="广度温度"
                value={data.breadth_temp ?? 50}
                icon={BarChart3}
                colorClass="text-blue-500"
              />
              <TempDimension
                label="资金温度"
                value={data.fund_temp ?? 50}
                icon={Zap}
                colorClass="text-amber-500"
              />
              <TempDimension
                label="情绪温度"
                value={data.sentiment_temp ?? 50}
                icon={Activity}
                colorClass="text-purple-500"
              />
            </div>
          </div>

          {/* 北向资金 */}
          {data.northbound ? <NorthboundCard flow={data.northbound} /> : (
            <div className="px-3 pb-2.5 pt-2 rounded-xl border bg-card flex items-center justify-center">
              <span className="text-[10px] text-muted-foreground">北向数据暂不可用</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { MarketData, IndexQuote, MarketBreadth, NorthboundFlow };
