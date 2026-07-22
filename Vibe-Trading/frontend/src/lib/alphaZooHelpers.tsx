/**
 * 因子库 — shared constants, types, helpers, and presentational components.
 *
 * Extracted from AlphaZoo.tsx to keep the page component manageable.
 */

import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { AlphaBenchTopRow, AlphaBenchResult } from "@/lib/api";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";

/* ---------- Types ---------- */

export interface ZooCard {
  id: string;
  title: string;
  description: string;
  approxCount: number;
  accent: string;
}

export type BenchStatus = "idle" | "submitting" | "streaming" | "done" | "error";

export interface BenchProgress {
  n_done: number;
  n_total: number;
  current_alpha_id?: string;
}

/* ---------- Constants ---------- */

// IMPORTANT: The Kakushadze 101 zoo must use the author's name as the label.
// The legacy / trademark name is forbidden by a CI grep gate -- do not add it.
export const ZOO_CARDS: ZooCard[] = [
  {
    id: "qlib158",
    title: "Qlib 158",
    description:
      "微软 Qlib 完整 158 特征库，覆盖动量、波动率、成交量和滚动统计信号。",
    approxCount: 154,
    accent: "from-sky-500/20 to-sky-500/5",
  },
  {
    id: "alpha101",
    title: "Kakushadze 101 公式化因子",
    description:
      "来自 Kakushadze (2015) 的 101 个公式化因子；短周期截面信号。",
    approxCount: 101,
    accent: "from-emerald-500/20 to-emerald-500/5",
  },
  {
    id: "gtja191",
    title: "国泰君安 191",
    description:
      "国泰君安 191 因子；面向 A 股市场优化的技术与微观结构信号。",
    approxCount: 191,
    accent: "from-amber-500/20 to-amber-500/5",
  },
  {
    id: "academic",
    title: "学术异象",
    description:
      "精选学术文献中的长周期异象（价值、动量、质量、低波动等）。",
    approxCount: 6,
    accent: "from-violet-500/20 to-violet-500/5",
  },
];

export const UNIVERSE_OPTIONS = [
  { value: "csi300", label: "沪深 300（A 股）" },
  { value: "sp500", label: "标普 500（美股）" },
  { value: "btc-usdt", label: "BTC-USDT（加密货币）" },
];

export const PAGE_SIZE = 50;

export const SORT_OPTIONS = [
  { value: "ir", label: "信息比率（IR）" },
  { value: "ic_mean", label: "IC 均值" },
  { value: "ic_positive_ratio", label: "IC > 0 比例" },
  { value: "ic_count", label: "样本数" },
];

/* ---------- Pure helpers ---------- */

export function fmtNum(v: unknown, digits = 3): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function metaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/** Split a free-text id list on commas / whitespace; dedupe, preserve order. */
export function parseAlphaIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const id = raw.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Build the ECharts option object for the "by theme" breakdown bar chart
 * rendered in the bench ResultPanel.
 */
export function buildByThemeChartOption(result: AlphaBenchResult) {
  const theme = getChartTheme();
  const themeNames = Object.keys(result.by_theme || {}).sort();
  const aliveSeries = themeNames.map((k) => result.by_theme[k].alive);
  const reversedSeries = themeNames.map((k) => result.by_theme[k].reversed);
  const deadSeries = themeNames.map((k) => result.by_theme[k].dead);

  return {
    backgroundColor: "transparent" as const,
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
    legend: {
      data: ["有效", "反转", "无效"],
      textStyle: { color: theme.textColor, fontSize: 11 },
      right: 8,
      top: 4,
    },
    grid: { left: 8, right: 8, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: themeNames,
      axisLine: { lineStyle: { color: theme.axisColor } },
      axisLabel: { color: theme.textColor, fontSize: 10, rotate: themeNames.length > 6 ? 30 : 0 },
    },
    yAxis: {
      type: "value" as const,
      splitLine: { lineStyle: { color: theme.gridColor } },
      axisLabel: { color: theme.textColor, fontSize: 10 },
    },
    series: [
      { name: "有效", type: "bar" as const, stack: "n", data: aliveSeries, itemStyle: { color: theme.upColor } },
      { name: "反转", type: "bar" as const, stack: "n", data: reversedSeries, itemStyle: { color: theme.warningColor } },
      { name: "无效", type: "bar" as const, stack: "n", data: deadSeries, itemStyle: { color: theme.downColor } },
    ],
  };
}

/**
 * Initialize an ECharts instance, set its option, and wire up a ResizeObserver.
 * Returns a cleanup function that disconnects the observer and disposes the chart.
 */
export function mountECharts(
  container: HTMLDivElement,
  option: Parameters<ReturnType<typeof echarts.init>["setOption"]>[0],
): () => void {
  const chart = echarts.init(container);
  chart.setOption(option);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(container);
  return () => {
    ro.disconnect();
    chart.dispose();
  };
}

/* ---------- Presentational components ---------- */

/**
 * Render the alpha bench category as a colored badge so users can see whether
 * a row is alive / reversed / dead at a glance. The "最多反转" panel
 * mixes reversed + dead rows; the badge keeps them distinguishable.
 */
export function CategoryBadge({ category }: { category: AlphaBenchTopRow["category"] }) {
  const tone =
    category === "alive"
      ? "bg-green-500/10 text-green-700 dark:text-green-300"
      : category === "reversed"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-red-500/10 text-red-700 dark:text-red-300";
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-medium", tone)}>
      {category}
    </span>
  );
}

export function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <tr className={cn(!last && "border-b", "hover:bg-muted/20")}>
      <td className="px-4 py-2 text-xs text-muted-foreground w-1/3">{label}</td>
      <td className="px-4 py-2 text-xs font-mono break-all">{value}</td>
    </tr>
  );
}

export function ProgressPanel({
  jobId,
  progress,
}: {
  jobId: string | null;
  progress: BenchProgress | null;
}) {
  const pct = progress && progress.n_total > 0
    ? Math.min(100, Math.round((progress.n_done / progress.n_total) * 100))
    : 0;
  return (
    <div className="border rounded-xl p-4 bg-card space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {jobId ? `Job ${jobId.slice(0, 12)}…` : "Submitting…"}
        </span>
        {progress && (
          <span className="font-mono tabular-nums">
            {progress.n_done} / {progress.n_total}
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress?.current_alpha_id && (
        <p className="text-xs text-muted-foreground font-mono truncate">
          Computing: {progress.current_alpha_id}
        </p>
      )}
    </div>
  );
}

export function TopTable({ title, rows }: { title: string; rows: AlphaBenchTopRow[] }) {
  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      <div className="px-4 py-2.5 border-b bg-muted/40">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground text-center">
          无数据。
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">ID</th>
              <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">Mean IC</th>
              <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">IR</th>
              <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Theme</th>
              <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2">
                  <Link
                    to={`/alpha-zoo/${encodeURIComponent(r.id)}`}
                    className="text-primary hover:underline font-mono text-xs"
                  >
                    {r.id}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-xs">{fmtNum(r.ic_mean)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-xs">{fmtNum(r.ir)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{(r.theme || []).join(", ") || "—"}</td>
                <td className="px-4 py-2 text-xs">
                  <CategoryBadge category={r.category} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
