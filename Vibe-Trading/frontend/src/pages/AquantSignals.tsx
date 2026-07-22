/**
 * A股量化决策 — 主线决策页面
 *
 * 上仪表盘（市场温度 + 风格分类 + 一句话描述）+ 下信号列表
 * 四种视图切换：评分 / 板块分组 / 新信号 / 因子维度
 */

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp, RefreshCw, BarChart3, Sparkles,
  Play, HelpCircle,
  Thermometer, ShieldCheck, PieChart,
} from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { request } from "@/lib/api";
import { toast } from "sonner";
import { SignalDetailPanel } from "@/components/aquant/SignalDetailPanel";
import { MarketDashboard } from "@/components/aquant/MarketDashboard";
import { SectorHeatmap } from "@/components/aquant/SectorHeatmap";
import { SignalStats } from "@/components/aquant/SignalStats";
import { SignalFactorOverview } from "@/components/aquant/SignalFactorOverview";
import type { MarketData } from "@/components/aquant/MarketDashboard";
import type { SectorHeatItem } from "@/components/aquant/SectorHeatmap";

// ── Types ──────────────────────────────────────────────────────────────

interface Factor {
  pe_ttm?: number;           // 真实 PE(TTM) 倍数
  pe_percentile?: number;    // PE 历史百分位(0-100)
  pb?: number;               // 真实 PB 倍数
  pb_percentile?: number;
  roe?: number;
  revenue_growth?: number;
  net_profit_growth?: number;
  gross_margin_change?: number;
  market_cap_yi?: number;
  is_st?: boolean;
  // V2 扩展
  main_flow_20d?: number;
  dragon_tiger_signal?: number;
  ret_20d?: number;
  vol_ratio?: number;
  debt_ratio?: number;
  margin_change_pct?: number;
  net_margin?: number;
  gross_margin?: number;
  deducted_profit_growth?: number;  // 扣非净利同比(%)
  // V3 扩展：当日行情
  price?: number;
  change_pct?: number;
  change_amount?: number;
}

interface SectorScore {
  signal_density?: number;
  capital_flow?: number;
  leader_effect?: number;
  total?: number;
}

interface SignalRecord {
  signal_id: string;
  date: string;
  stock_code: string;
  stock_name: string;
  score: number;
  factors: Factor;
  sector: string;
  sector_score?: SectorScore;
  ai_suggestion?: string;
  suggested_weight?: number | null;     // 组合建议仓位(%)，P4 定仓风控回填
  main_line_sector?: string | null;     // 主线板块(P3 择时注入)
  data_coverage?: number | null;      // 有效因子覆盖率(0-100)
}

// ── P6：主线市场状态（来自 market_state，MarketTemperature.asdict） ──
interface MarketState {
  value: number;                 // 综合温度 0-100
  label: string;                 // 一句话描述
  style: string;                 // 价值/成长/题材/防御
  capital_flow: string;          // 资金流向描述
  breadth_temp?: number;
  fund_temp?: number;
  sentiment_temp?: number;
  breadth?: { breadth_pct?: number; [k: string]: any };
  northbound?: { total_yi?: number; [k: string]: any };
  [k: string]: any;
}

// ── P6：组合定仓方案（来自 portfolio.PortfolioPlan） ──
interface PositionSuggestion {
  stock_code: string;
  stock_name: string;
  score: number;
  sector: string;
  weight: number;                // 建议仓位 (%)
  is_main_line: boolean;
  reason: string;
}
interface RejectedHolding {
  stock_code: string;
  stock_name: string;
  score: number;
  reason: string;
}
interface PortfolioPlan {
  total_position: number;        // 总仓位上限 (%)
  allocated_position: number;    // 实际配置总仓位 (%)
  max_holdings: number;
  suggested_positions: PositionSuggestion[];
  rejected: RejectedHolding[];
  risk_controls: string[];
}

interface SignalsResponse {
  date: string | null;
  total_signals: number;
  signals: SignalRecord[];
  market_state?: MarketState | null;
  portfolio?: PortfolioPlan | null;
}


interface MarketStateResponse {
  status: string;
  temperature: MarketData;
  indexes?: Record<string, any>;
  breadth?: any;
  northbound?: any;
  sector_heat?: SectorHeatItem[];
}

interface GenerateResponse {
  status: string;
  date: string;
  total_signals?: number;
  pool?: string;
  pool_size?: number;
  message?: string;
  signals?: SignalRecord[];
  market_state?: MarketState | null;
  portfolio?: PortfolioPlan | null;
}

// ── Sub-components ─────────────────────────────────────────────────────

function SignalRow({ sig, rank, onClick }: { sig: SignalRecord; rank: number; onClick: () => void }) {
  const ret20d = sig.factors.ret_20d ?? 0;

  // 当日行情
  const price = sig.factors.price ?? 0;
  const changePct = sig.factors.change_pct ?? 0;
  const isUpToday = changePct >= 0;

  // ── 财务因子 ──
  const pe = sig.factors.pe_ttm;           // 真实 PE(TTM) 倍数
  const roe = sig.factors.roe;             // 不兜底，null 显示 "—"
  const revenueGrowth = sig.factors.revenue_growth;
  const netProfitGrowth = sig.factors.net_profit_growth;
  const grossMargin = sig.factors.gross_margin;
  const netMargin = sig.factors.net_margin;
  const dedProfitGrowth = sig.factors.deducted_profit_growth;
  const sc = sig.score;

  const hasPriceData = price > 0;

  // 格式化财务指标
  const fmt = (v: number | null | undefined, unit = "%") =>
    v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}${unit}` : "—";

  // 毛利率文本
  const gmText = grossMargin != null
    ? `${grossMargin.toFixed(1)}%`
    : "—";   // 缺失显示 "—"，不误导为金融

  return (
    <div
      onClick={onClick}
      className={cn(
        "grid grid-cols-[auto_100px_auto_auto_1fr] gap-x-3.5 px-3 py-2 rounded-xl border bg-card hover:shadow-sm transition-all cursor-pointer group items-center",
        "hover:border-primary/30",
      )}
    >
      {/* 列1：排名 */}
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
        rank <= 3 ? "bg-[#fef2f2] text-[#ef4444]" : "bg-primary/10 text-primary",
      )}>
        {rank}
      </div>

      {/* 列2：名称 + 代码（固定宽度，溢出截断） */}
      <div className="min-w-0 overflow-hidden">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold whitespace-nowrap truncate leading-tight" title={sig.stock_name}>{sig.stock_name}</span>
          <span className="text-[9px] font-mono text-muted-foreground/70 shrink-0">{sig.stock_code}</span>
        </div>
        <div className="flex items-center gap-1 mt-px">
          {sig.factors.is_st && (
            <span className="text-[8px] px-0.5 py-px rounded bg-red-100 text-red-600 dark:bg-red-900/30 font-medium">ST</span>
          )}
          {ret20d > 5 && (
            <span className="text-[8px] px-0.5 rounded bg-[#fef2f2] text-[#ef4444]">
              强势{ret20d.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {/* 列3：价格 / 20日涨幅 */}
      <div className="flex items-baseline gap-0.5 shrink-0 justify-end mr-3">
        {hasPriceData ? (
          <>
            <span className="text-xs font-bold tabular-nums leading-tight">{price.toFixed(2)}</span>
            <span className={cn("text-[9px] font-medium tabular-nums", isUpToday ? "text-[#ef4444]" : "text-[#22c55e]")}>
              {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </>
        ) : ret20d != null && ret20d !== 0 ? (
          <span className={cn("text-[10px] font-bold tabular-nums", ret20d > 0 ? "text-[#ef4444]" : "text-[#22c55e]")}>
            {ret20d > 0 ? "+" : ""}{ret20d.toFixed(1)}%
          </span>
        ) : null}
      </div>

      {/* 列4：综合评分 + 条形图 */}
      <div className="flex items-center gap-1 shrink-0 mr-3">
        <span className={cn(
          "text-sm font-bold tabular-nums leading-none",
          sc >= 80 ? "text-[#ef4444]" : sc >= 60 ? "text-amber-500" : "text-muted-foreground",
        )}>{sc.toFixed(1)}</span>
        {/* 信号强度条形图 */}
        <div className="w-12 h-1.5 rounded-full bg-muted/60 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              sc >= 80 ? "bg-[#ef4444]" : sc >= 60 ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(0, sc))}%` }}
          />
        </div>
        {sig.suggested_weight != null && (
          <span className="text-[9px] px-0.5 rounded bg-primary/10 text-primary font-medium tabular-nums">
            {sig.suggested_weight.toFixed(1)}%
          </span>
        )}
      </div>

      {/* 列5：财务指标（PE / ROE / 营收 / 净利 / 毛利 / 扣非 / 净利率） */}
      <div className="hidden lg:flex items-center gap-x-2.5 text-[9px] min-w-0">
        <span className="text-muted-foreground/60 shrink-0">PE:<b className="font-mono ml-0.5">{pe != null && pe > 0 ? pe.toFixed(0) : "—"}</b></span>
        <span className="text-muted-foreground/60 shrink-0">ROE:<b className={cn("font-mono ml-0.5", roe != null && roe > 15 ? "text-[#ef4444]" : "")}>{roe != null ? `${roe.toFixed(1)}%` : "—"}</b></span>
        <span className={cn("font-mono font-semibold shrink-0", (revenueGrowth ?? 0) > 0 ? "text-[#ef4444]" : (revenueGrowth ?? 0) < 0 ? "text-[#22c55e]" : "text-muted-foreground")}>营收:{fmt(revenueGrowth)}</span>
        <span className={cn("font-mono font-semibold shrink-0", (netProfitGrowth ?? 0) > 0 ? "text-[#ef4444]" : (netProfitGrowth ?? 0) < 0 ? "text-[#22c55e]" : "text-muted-foreground")}>净利:{fmt(netProfitGrowth)}</span>
        <span className="font-mono shrink-0">毛利:<b>{gmText}</b></span>
        {dedProfitGrowth != null && (
          <span className={cn("font-mono font-semibold shrink-0", dedProfitGrowth > 0 ? "text-[#ef4444]" : dedProfitGrowth < 0 ? "text-[#22c55e]" : "")}>扣非:{fmt(dedProfitGrowth)}</span>
        )}
        {netMargin != null && (
          <span className="font-mono shrink-0">净利率:<b>{netMargin.toFixed(1)}%</b></span>
        )}
      </div>

      {/* 中屏精简版：只显示核心指标 */}
      <div className="hidden md:flex lg:hidden items-center gap-x-2 text-[9px] min-w-0 col-start-5">
        <span className="text-muted-foreground/60 shrink-0">PE:<b className="font-mono ml-0.5">{pe != null && pe > 0 ? pe.toFixed(0) : "—"}</b></span>
        <span className="text-muted-foreground/60 shrink-0">ROE:<b className={cn("font-mono ml-0.5", roe != null && roe > 15 ? "text-[#ef4444]" : "")}>{roe != null ? `${roe.toFixed(1)}%` : "—"}</b></span>
        <span className={cn("font-mono font-semibold shrink-0", (revenueGrowth ?? 0) > 0 ? "text-[#ef4444]" : (revenueGrowth ?? 0) < 0 ? "text-[#22c55e]" : "text-muted-foreground")}>营收:{fmt(revenueGrowth)}</span>
        <span className={cn("font-mono font-semibold shrink-0", (netProfitGrowth ?? 0) > 0 ? "text-[#ef4444]" : (netProfitGrowth ?? 0) < 0 ? "text-[#22c55e]" : "text-muted-foreground")}>净利:{fmt(netProfitGrowth)}</span>
        <span className="font-mono shrink-0">毛利:<b>{gmText}</b></span>
        {dedProfitGrowth != null && (
          <span className={cn("font-mono font-semibold shrink-0", dedProfitGrowth > 0 ? "text-[#ef4444]" : dedProfitGrowth < 0 ? "text-[#22c55e]" : "")}>扣非:{fmt(dedProfitGrowth)}</span>
        )}
      </div>
    </div>
  );
}

function SignalList({
  signals,
  viewMode,
  sectorFilter,
  onSelect,
}: {
  signals: SignalRecord[];
  viewMode: string;
  sectorFilter: string;
  onSelect: (sig: SignalRecord) => void;
}) {
  // 普通列表（评分/新信号/因子维度）
  if (viewMode !== "sector") {
    return (
      <div className="space-y-2">
        {signals.map((sig, idx) => (
          <SignalRow
            key={sig.signal_id}
            sig={sig}
            rank={idx + 1}
            onClick={() => onSelect(sig)}
          />
        ))}
      </div>
    );
  }

  // 板块分组视图
  const filtered =
    sectorFilter === "all"
      ? signals
      : signals.filter((s) => s.sector === sectorFilter);

  const groups = new Map<string, SignalRecord[]>();
  for (const sig of filtered) {
    const sec = sig.sector || "未分类";
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec)!.push(sig);
  }

  // 保持后端排序，但板块按首字母排
  const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "zh-CN")
  );

  return (
    <div className="space-y-4">
      {sortedGroups.map(([sector, items]) => (
        <div key={sector} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs font-semibold text-foreground">{sector}</span>
            <span className="text-[10px] text-muted-foreground">
              {items.length} 只
            </span>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <div className="space-y-2">
            {items.map((sig) => (
              <SignalRow
                key={sig.signal_id}
                sig={sig}
                rank={signals.findIndex((s) => s.signal_id === sig.signal_id) + 1}
                onClick={() => onSelect(sig)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── P6：择时总览卡片（风格 / 仓位上限 / 主线板块） ─────────────────────

function deriveMainLineFromSignals(signals: SignalRecord[]): string[] {
  /** 从信号列表按评分加权聚合出 TOP3 主线板块（后端主线板块降级时的兜底） */
  if (signals.length === 0) return [];
  const weightMap = new Map<string, number>();
  for (const sig of signals) {
    const sec = sig.sector || "未分类";
    // 排除"其他"和"未分类"，避免无意义的兜底板块
    if (sec === "其他" || sec === "未分类") continue;
    // 用 score 作为权重（最低 1 避免 0 权重），突出高分板块
    const w = Math.max(1, sig.score);
    weightMap.set(sec, (weightMap.get(sec) || 0) + w);
  }
  const derived = Array.from(weightMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sec]) => sec);
  // 如果排除后没有任何有效板块，返回空（让前端展示降级提示）
  return derived;
}

function TimingSummaryCard({
  marketState,
  mainLineSectors,
  positionCap,
  signals,
}: {
  marketState: MarketState | null;
  mainLineSectors: string[];
  positionCap?: number;
  signals?: SignalRecord[];
}) {
  if (!marketState) return null;
  // 后端主线板块为空时，用信号聚合兜底
  const effectiveMainLine = mainLineSectors.length > 0
    ? mainLineSectors
    : deriveMainLineFromSignals(signals || []);
  const temp = marketState.value ?? 0;
  const tempColor =
    temp >= 70 ? "text-[#ef4444]" : temp >= 40 ? "text-amber-500" : "text-[#22c55e]";
  const styleCls: Record<string, string> = {
    成长: "bg-purple-100 text-purple-600 dark:bg-purple-900/30",
    价值: "bg-blue-100 text-blue-600 dark:bg-blue-900/30",
    题材: "bg-amber-100 text-amber-600 dark:bg-amber-900/30",
    防御: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30",
  };
  const sc = styleCls[marketState.style] || "bg-muted text-muted-foreground";
  const capColor =
    (positionCap ?? 0) >= 80 ? "text-[#ef4444]" : (positionCap ?? 0) >= 60 ? "text-amber-500" : "text-[#22c55e]";

  return (
    <div className="px-5 py-3 border-b bg-card/40">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Thermometer className="h-3.5 w-3.5" /> 择时总览
        </span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", sc)}>
          {marketState.style || "—"}
        </span>
        <span className={cn("text-sm font-bold tabular-nums", tempColor)}>
          {temp}
          <span className="text-[10px] font-normal text-muted-foreground ml-0.5">° 温度</span>
        </span>
        <span className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">
          {marketState.label}
        </span>
      </div>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">建议仓位上限</span>
          <span className={cn("text-2xl font-bold tabular-nums leading-none", capColor)}>
            {positionCap != null ? `${positionCap}%` : "—"}
          </span>
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            主线板块
            {mainLineSectors.length === 0 && effectiveMainLine.length > 0 && (
              <span className="text-[9px] text-primary/60">（信号派生）</span>
            )}
          </span>
          <div className="flex flex-wrap gap-1">
            {effectiveMainLine.length > 0 ? (
              effectiveMainLine.map((s) => (
                <span
                  key={s}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 font-medium"
                >
                  {s}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground">暂无（数据源降级）</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── P6：组合定仓方案卡片 ───────────────────────────────────────────────

function PortfolioCard({ portfolio }: { portfolio: PortfolioPlan | null }) {
  if (!portfolio) return null;
  const { total_position, allocated_position, max_holdings, suggested_positions, rejected, risk_controls } =
    portfolio;
  const capColor =
    total_position >= 80 ? "text-[#ef4444]" : total_position >= 60 ? "text-amber-500" : "text-[#22c55e]";

  return (
    <div className="px-5 py-3 border-b bg-card/40 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <PieChart className="h-3.5 w-3.5" /> 组合定仓方案
        </span>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>仓位上限 <b className={cn("tabular-nums", capColor)}>{total_position}%</b></span>
          <span>实际配置 <b className="tabular-nums">{allocated_position}%</b></span>
          <span>持股≤{max_holdings}</span>
        </div>
      </div>

      {/* 建议持仓 */}
      {suggested_positions.length > 0 && (
        <div className="space-y-1.5">
          {suggested_positions.map((p, i) => (
            <div key={p.stock_code} className="flex items-center gap-2">
              <span className="w-4 text-[10px] text-muted-foreground tabular-nums text-right shrink-0">
                {i + 1}
              </span>
              <div className="w-28 shrink-0 truncate text-xs font-medium" title={p.stock_name}>
                {p.stock_name}
              </div>
              <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, p.weight))}%` }}
                />
              </div>
              <span className="w-12 text-right text-[11px] font-semibold tabular-nums text-primary shrink-0">
                {p.weight.toFixed(1)}%
              </span>
              {p.is_main_line && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 font-medium shrink-0">
                  主线
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 风控提示 */}
      {risk_controls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {risk_controls.map((r, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 flex items-center gap-1"
            >
              <ShieldCheck className="h-3 w-3" /> {r}
            </span>
          ))}
        </div>
      )}

      {/* 剔除原因 */}
      {rejected.length > 0 && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            已剔除 {rejected.length} 只（点击查看原因）
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-2">
            {rejected.map((r) => (
              <li key={r.stock_code} className="flex gap-1">
                <span className="text-red-500 shrink-0">✕</span>
                <span>
                  <b>{r.stock_name}</b>（{r.stock_code}）：{r.reason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

const VIEW_MODES = [
  {
    key: "score",
    label: "评分排序",
    description: "按综合评分从高到低展示，高分表示估值、质量、成长、动量、资金等多维度均较优。",
  },
  {
    key: "sector",
    label: "板块分组",
    description: "按所属板块分组，组内仍按评分排序，便于聚焦强势板块和板块内龙头。",
  },
  {
    key: "new",
    label: "新信号",
    description: "今日首次入选或相比上一交易日评分跃升明显的信号，代表新增机会。",
  },
  {
    key: "factor",
    label: "因子维度",
    description: "按 PE 历史百分位排序，快速筛选估值分位较低、安全边际较高的标的。",
  },
];

export function AquantSignals() {
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [totalSignals, setTotalSignals] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState("score");
  const [limit, setLimit] = useState(20);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [marketSectors, setMarketSectors] = useState<SectorHeatItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<SignalRecord | null>(null);
  // 板块分组筛选
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  // P6：主线市场状态 + 组合定仓方案
  const [marketState, setMarketState] = useState<MarketState | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioPlan | null>(null);

  const fetchSignals = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await request<SignalsResponse>(
        `/aquant/signals/latest?view_mode=${viewMode}&limit=${limit}`
      );
      setSignals(res.signals || []);
      setTotalSignals(res.total_signals || 0);
      setDate(res.date);
      setMarketState(res.market_state ?? null);
      setPortfolio(res.portfolio ?? null);
    } catch {
      setSignals([]);
      setTotalSignals(0);
      setDate(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [viewMode, limit]);

  useEffect(() => {
    fetchSignals();
  }, [viewMode, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMarketData = useCallback(async () => {
    setMarketLoading(true);
    try {
      const res = await request<MarketStateResponse>(`/aquant/market/temperature`);
      if (res.status === "success" && res.temperature) {
        setMarketData(res.temperature);
        setMarketSectors(res.sector_heat || []);
      }
    } catch {
      // ignore
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => { fetchMarketData(); }, [fetchMarketData]);

  const handleRefresh = () => fetchSignals(true);

  // ── 生成信号 ──
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await request<GenerateResponse>("/aquant/signals/generate", {
        method: "POST",
        body: JSON.stringify({ force: true, pool: "watchlist", top_n: 20 }),
        headers: { "Content-Type": "application/json" },
      });

      if (res.status === "success") {
        toast.success(`信号生成完成！共 ${res.total_signals} 条`, {
          description: `选股池: ${res.pool} (${res.pool_size}只) → ${res.total_signals}条信号`,
        });
        // P6：捕获择时与组合定仓方案
        setMarketState(res.market_state ?? null);
        setPortfolio(res.portfolio ?? null);
        // 如果返回了信号数据，直接展示
        if (res.signals && res.signals.length > 0) {
          setSignals(res.signals);
          setTotalSignals(res.total_signals ?? res.signals.length);
          setDate(res.date);
        } else {
          fetchSignals(true);
        }
      } else if (res.status === "warning") {
        toast.warning(res.message || "信号引擎未就绪");
      } else {
        toast.error(res.message || "生成失败");
      }
    } catch (err: any) {
      toast.error(`生成失败: ${err.message || "未知错误"}`);
    } finally {
      setGenerating(false);
    }
  };

  // P6：聚合主线板块（来自各信号 main_line_sector）
  const mainLineSectors = Array.from(
    new Set(
      signals
        .map((s) => s.main_line_sector)
        .filter((x): x is string => Boolean(x))
        .flatMap((ml) => ml.split(/[,，]/).map((x) => x.trim()))
        .filter(Boolean),
    ),
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── 左侧：信号列表 ── */}
      <div className={cn(
        "flex flex-col min-h-0 transition-all duration-300",
        selectedSignal ? "w-[55%]" : "w-full",
      )}>
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              主线决策
            </h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {date ? `信号日期: ${date}` : "暂无信号数据"} · 共 {totalSignals} 条
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all",
                "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              title="基于a-stock-data实时数据生成信号"
            >
              <Sparkles className={cn("h-3.5 w-3.5", generating && "animate-pulse")} />
              {generating ? "生成中..." : "生成信号"}
            </button>

            {/* 数量调节 */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs border rounded px-2 py-1 bg-card text-foreground"
            >
              {[5, 10, 20, 50, 100].map(n => (
                <option key={n} value={n}>{n}条</option>
              ))}
            </select>
            {/* 刷新 */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-md border bg-card hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
              title="刷新信号"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* 市场仪表盘 */}
        <MarketDashboard data={marketData} loading={marketLoading} />

        {/* 板块热力图 */}
        <SectorHeatmap
          sectors={marketSectors}
          loading={marketLoading}
          signals={signals}
        />

        {/* 信号统计 */}
        <SignalStats signals={signals} loading={loading && signals.length === 0} />

        {/* P6：择时总览（独立行） */}
        <TimingSummaryCard
          marketState={marketState}
          mainLineSectors={mainLineSectors}
          positionCap={portfolio?.total_position}
          signals={signals}
        />

        {/* P6：组合定仓 + 因子概览（一行并排） */}
        <div className="grid grid-cols-4 gap-2">
          <PortfolioCard portfolio={portfolio} />
          <SignalFactorOverview signals={signals} loading={loading && signals.length === 0} />
        </div>

        {/* View mode tabs + 筛选 */}
        <div className="px-5 py-2 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto">
            {VIEW_MODES.map(({ key, label, description }) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                title={description}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1",
                  viewMode === key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
                {viewMode === key && (
                  <HelpCircle className="h-3 w-3 opacity-50" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {viewMode === "sector" && (
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="text-xs border rounded px-2 py-1 bg-card text-foreground"
              >
                <option value="all">全部板块</option>
                {Array.from(new Set(signals.map((s) => s.sector).filter(Boolean)))
                  .sort((a, b) => a.localeCompare(b, "zh-CN"))
                  .map((sec) => (
                    <option key={sec} value={sec}>{sec}</option>
                  ))}
              </select>
            )}
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-help"
              title={VIEW_MODES.find((m) => m.key === viewMode)?.description}
            >
              <HelpCircle className="h-3 w-3" />
              {VIEW_MODES.find((m) => m.key === viewMode)?.description}
            </span>
          </div>
        </div>

        {/* Signal list — 外层已 overflow-y-auto，此处自然流布局即可 */}
        <div className="p-4 space-y-2">
          {generating && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="relative">
                <RefreshCw className="h-10 w-10 animate-spin opacity-20" />
                <Sparkles className="h-5 w-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary animate-pulse" />
              </div>
              <p className="text-sm font-medium mt-3">正在生成信号...</p>
              <p className="text-xs opacity-60 mt-1">
                扫描选股池 · 拉取行情 · 计算因子 · 综合评分
              </p>
            </div>
          )}
          {!generating && loading && signals.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-12" />
              </div>
            ))
          ) : !generating && signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <BarChart3 className="h-12 w-12 opacity-20 mb-3" />
              <p className="text-sm font-medium">暂无信号</p>
              <p className="text-xs opacity-60 mt-1">
                {date ? "今日信号为空，请检查数据源" : "盘后自动扫描后将在此展示"}
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 mt-4 text-xs px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                立即生成信号
              </button>
            </div>
          ) : (
            <SignalList
              signals={signals}
              viewMode={viewMode}
              sectorFilter={sectorFilter}
              onSelect={setSelectedSignal}
            />
          )}
        </div>
      </div>

      {/* ── 右侧：信号详情面板 ── */}
      {selectedSignal && (
        <div className="w-[45%] shrink-0 border-l animate-in slide-in-from-right duration-300">
          <SignalDetailPanel
            signal={selectedSignal}
            onClose={() => setSelectedSignal(null)}
          />
        </div>
      )}
    </div>
  );
}
