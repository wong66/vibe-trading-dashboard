/**
 * A股量化决策 — 复盘雷达页面（v2：4 面板重写）
 *
 * 数据全部来自 a-stock-data（后端 review_panels.build_review_panels）：
 *   1. 行业轮动  : 今日涨幅最大行业 + 资金流入板块（东财行业涨跌 + 板块资金流 f62/f184）
 *   2. 题材归因  : 以题材维度聚合强势股（概念驱动视角，同花顺 getharden 题材标签）
 *   3. 涨停归因  : 以连板高度聚合涨停股（打板视角，几天几板）
 *   4. 短线情绪  : 涨停/跌停/最高连板/连板(2板+) / 封板率/炸板率/晋级率（akshare 东财涨停四池）
 *
 * 设计原则（与后端一致）：
 *   - 每个面板独立容错：available=False 时显示诚实空态，绝不渲染假数字。
 *   - 涨红跌绿（A股习惯）。
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactElement } from "react";
import {
  RefreshCw, Layers, Flame, Flag, BarChart3, TrendingUp,
  CalendarDays, Target, ShieldAlert, Plus, Zap, Gauge,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useECharts } from "@/hooks/useECharts";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { request, api } from "@/lib/api";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────

interface SectorRow {
  name: string;
  code: string;
  change_pct: number;
  up_count: number;
  down_count: number;
  leader: string;
  top_stocks?: { code: string; name: string; change_pct: number }[];
}

interface CapitalRow {
  code: string;
  name: string;
  change_pct: number;
  main_net_yi: number;
  main_net_pct: number;
}

interface ThemeHeatItem {
  theme: string;
  count: number;
  samples: { code: string; name: string }[];
  avg_change: number | null;
}

interface SectorRotation {
  available: boolean;
  source?: string;           // "eastmoney" | "ths_fallback" | "none"
  top_gain: SectorRow[];
  capital_inflow: CapitalRow[];
  total_industries: number;
  theme_heat?: ThemeHeatItem[]; // 东财不可用时的题材热度降级
}

interface ThemeFinData {
  period?: string;
  revenue?: number | null;
  revenue_yoy?: number | null;
  profit?: number | null;
  profit_yoy?: number | null;
  gross_margin?: number | null;
  net_margin?: number | null;       // 净利率(%)
  debt_ratio?: number | null;       // 资产负债率(%)
  contract_liability?: number | null;
  operating_cash_flow?: number | null;
}

interface ThemePick {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  fin: ThemeFinData | null;
  buy: {
    buy_low: number | null;
    buy_high: number | null;
    stop_loss: number | null;
    note: string;
  };
  evidence: string;
  serenity_analysis?: string;  // Serenity 完整评分卡文本
}

interface ThemeItem {
  theme: string;
  count: number;
  samples: { code: string; name: string }[];
  reason?: string;  // LLM 生成的题材驱动原因（政策/新闻/事件）
  top_picks?: ThemePick[];      // 当日涨幅 Top3 + 财报 + 买卖指导
  serenity_picks?: ThemePick[]; // Serenity基本面精选（独立选股，可能与top_picks完全不同）
}

interface StrongStock {
  code: string;
  name: string;
  reason: string;
  themes: string[];
  change_pct: number | null;
  boards: number;
  price: number | null;
  realtime_pct: number | null;
}

interface ThemeAttribution {
  available: boolean;
  themes: ThemeItem[];
  stocks: StrongStock[];
  note: string;
  building?: boolean;  // 后端同步构建超时，后台异步补全中
}

interface LimitupAttribution {
  available: boolean;
  stocks: StrongStock[];
  theme_summary: { theme: string; count: number }[];
  max_board: number;
}

interface LianbanStock {
  code: string;
  name: string;
  boards: number;
  price: number;
  pct: number;
  amount: number;   // 成交额, 元
  float_cap: number; // 流通市值, 元
  industry: string;
}

interface ShortTermEmotion {
  date?: string;
  zt_count: number;
  dt_count: number;
  zb_count: number;
  max_boards: number;
  lianban_count: number;
  ladder: { board: number; count: number }[];
  lianban_stocks: LianbanStock[];
  seal_rate: number | null;
  break_rate: number | null;
  promotion_rate: number | null;
  yzt_count: number;
}

interface ReviewData {
  date: string;
  sector_rotation: SectorRotation;
  theme_attribution: ThemeAttribution;
  limitup_attribution: LimitupAttribution;
  short_term_emotion?: ShortTermEmotion;
  strategy_suggestions: StrategySuggestions;
  building?: boolean;  // 后端同步构建超时，后台异步补全中（前端自动轮询）
  market_sentiment: Partial<MarketSentiment>;
}

// ── VS 每日复盘同款数据类型 ──────────────────────────────────────────

interface MarketSentiment {
  up: number; down: number; flat: number;
  zt: number; zt_real: number; dt: number; dt_real: number;
  active: string;
  breadth: string; speculation: string;
  date: string;
}

// ── 第 5 面板：策略信号 ──────────────────────────────────────────────

interface StrategyStock {
  code: string;
  name: string;
  price?: number | null;
  buy_range?: string;
  stop_loss?: string;
  target?: string;
  note?: string;
  params_note?: string;
  risk_reward?: string;
}

interface StrategyCard {
  type: "主线延续" | "连板接力" | "题材埋伏";
  title: string;
  confidence: "高" | "中" | "低";
  rationale: string;
  action: string;
  trade_logic?: string;
  stocks: StrategyStock[];
}

interface RiskAlert {
  level: "高" | "中" | "低";
  text: string;
}

interface MarketTemp {
  cycle: string;
  score: number;
  desc: string;
}

interface StrategySuggestions {
  available: boolean;
  market_temp?: MarketTemp;
  strategies: StrategyCard[];
  risk_alerts: RiskAlert[];
  note: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, digits = 2): ReactElement {
  if (v == null || (typeof v === "number" && Number.isNaN(v))) {
    return <span className="text-muted-foreground">盘中</span>;
  }
  const up = v > 0;
  const txt = `${up ? "+" : ""}${v.toFixed(digits)}%`;
  return <span className={up ? "text-red-500" : "text-green-500"}>{txt}</span>;
}

function boardLabel(b: number): string {
  if (!b || b <= 1) return "首板";
  return `${b}连板`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

// 金额(元) → 亿/万 紧凑格式（财报展示用）
function fmtFinYi(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
}

// 小数(0.063) → 带符号百分比字符串（+6.3%）；None→空串
function fmtPctRaw(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return ` ${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

// 同比涨跌色：涨红跌绿（A股惯例）
function pctColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "text-muted-foreground";
  return v >= 0 ? "text-red-500" : "text-green-500";
}

// 个股代码 → 同花顺个股页（新窗口打开）
function thsUrl(code: string): string {
  const m = /^(\d{6})/.exec(code);
  return `https://stockpage.10jqka.com.cn/${m ? m[1] : code}/`;
}

// 可点击跳转同花顺的个股名（复盘雷达所有个股共用）
function StockNameLink({
  code, name, className,
}: { code: string; name: string; className?: string }) {
  return (
    <a
      href={thsUrl(code)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-medium truncate hover:text-primary hover:underline", className)}
      title={`在同花顺查看 ${name}`}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </a>
  );
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Shared sub-components ─────────────────────────────────────────────

function SectionTitle({
  icon: Icon, title, sub,
}: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <span className="text-[10px] text-muted-foreground font-normal">{sub}</span>}
    </div>
  );
}

function EmptyHint({ msg }: { msg: string }) {
  return (
    <div className="h-24 w-full flex items-center justify-center text-xs text-muted-foreground">
      {msg}
    </div>
  );
}

function Tag({
  children, active, onClick,
}: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "bg-muted/40 hover:bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── Panel 1: 行业轮动 ──────────────────────────────────────────────────

function SectorRotationPanel({ data }: { data: SectorRotation }) {
  const { ref: inflowRef, setOption: setInflowOption, visible: inflowVisible } = useECharts();
  const { ref: outflowRef, setOption: setOutflowOption, visible: outflowVisible } = useECharts();

  const topInflow = useMemo(
    () => [...(data.capital_inflow || [])].sort((a, b) => b.main_net_yi - a.main_net_yi).slice(0, 12),
    [data.capital_inflow],
  );

  const topOutflow = useMemo(
    () => [...(data.capital_inflow || [])]
        .filter(c => (c.main_net_yi || 0) < 0)
        .sort((a, b) => a.main_net_yi - b.main_net_yi)
        .slice(0, 12),
    [data.capital_inflow],
  );

  useEffect(() => {
    if (!inflowVisible || !topInflow.length) return;
    const paired = topInflow
      .map(r => ({ name: r.name, v: r.main_net_yi, chg: r.change_pct }))
      .reverse();
    const names = paired.map(p => p.name);
    setInflowOption({
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (p: any) => {
          const d = p[0];
          const chg = d.data?.change_pct;
          const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${chg}%)` : "";
          return `${d.name}<br/>今日净流入: ${d.value >= 0 ? "+" : ""}${d.value}亿${chgStr}`;
        },
      },
      grid: { top: 8, right: 120, bottom: 4, left: 80, containLabel: false },
      xAxis: {
        type: "value" as const,
        show: false,
        axisLabel: { color: "#4b5563", fontSize: 11, fontWeight: 500, formatter: "{value}亿" },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { color: "#374151", fontSize: 11, fontWeight: 500 },
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar" as const,
          data: paired.map(p => ({
            value: p.v,
            itemStyle: { color: p.v >= 0 ? "#ef4444" : "#22c55e", borderRadius: 3 },
            label: {
              rich: {
                v: { color: "#1f2937", fontSize: 11, fontWeight: 600 },
                c: { color: p.chg != null ? (p.chg > 0 ? "#ef4444" : "#22c55e") : "#6b7280", fontSize: 11, fontWeight: 600 },
              },
            },
            change_pct: p.chg,
          })),
          barWidth: "60%",
          label: {
            show: true, position: "right",
            formatter: (p: any) => {
              const chg = p.data?.change_pct;
              const base = `${p.value >= 0 ? "+" : ""}${Number(p.value).toFixed(1)}`;
              if (chg == null) return `{v|${base}}`;
              return `{v|${base}} {c|(${chg > 0 ? "+" : ""}${chg}%)}`;
            },
          },
        },
      ],
    });
  }, [inflowVisible, topInflow, setInflowOption]);

  // ── 流出条形图（主力净流出 TOP，绿条向左）──
  useEffect(() => {
    if (!outflowVisible || !topOutflow.length) return;
    const paired = topOutflow
      .map(r => ({ name: r.name, v: r.main_net_yi, chg: r.change_pct }))
      .reverse();
    const names = paired.map(p => p.name);
    setOutflowOption({
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (p: any) => {
          const d = p[0];
          const chg = d.data?.change_pct;
          const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${chg}%)` : "";
          return `${d.name}<br/>今日净流出: ${d.value}亿${chgStr}`;
        },
      },
      grid: { top: 8, right: 120, bottom: 4, left: 80, containLabel: false },
      xAxis: {
        type: "value" as const,
        show: false,
        axisLabel: { color: "#4b5563", fontSize: 11, fontWeight: 500, formatter: "{value}亿" },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { color: "#374151", fontSize: 11, fontWeight: 500 },
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar" as const,
          data: paired.map(p => ({
            value: p.v,
            itemStyle: { color: "#22c55e", borderRadius: 3 },
            label: {
              rich: {
                v: { color: "#1f2937", fontSize: 11, fontWeight: 600 },
                c: { color: p.chg != null ? (p.chg > 0 ? "#ef4444" : "#22c55e") : "#6b7280", fontSize: 11, fontWeight: 600 },
              },
            },
            change_pct: p.chg,
          })),
          barWidth: "60%",
          label: {
            show: true, position: "right",
            formatter: (p: any) => {
              const chg = p.data?.change_pct;
              const base = `${Number(p.value).toFixed(1)}`;
              if (chg == null) return `{v|${base}}`;
              return `{v|${base}} {c|(${chg > 0 ? "+" : ""}${chg}%)}`;
            },
          },
        },
      ],
    });
  }, [outflowVisible, topOutflow, setOutflowOption]);

  if (!data.available) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <SectionTitle icon={Layers} title="行业轮动" sub="今日涨幅 + 资金流入" />
        <EmptyHint msg="行业数据暂不可用（盘中或数据源中断）" />
      </div>
    );
  }

  // ── 东财不可用时：题材热度降级视图 ──
  if (data.source === "ths_fallback" && data.theme_heat?.length) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <SectionTitle
          icon={Layers}
          title="行业轮动"
          sub="题材热度（东财行业数据暂不可用，从强势股题材聚合）"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 左：题材热度排行（原始内容，不动） */}
          <div className="lg:col-span-1">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-1.5 font-medium">#</th>
                    <th className="text-left py-1.5 font-medium">题材</th>
                    <th className="text-right py-1.5 font-medium">热度</th>
                    <th className="text-left py-1.5 font-medium">代表个股</th>
                  </tr>
                </thead>
                <tbody>
                  {data.theme_heat.map((item, idx) => (
                    <tr key={item.theme} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 tabular-nums text-muted-foreground">{idx + 1}</td>
                      <td className="py-1.5 font-medium">{item.theme}</td>
                      <td className="py-1.5 text-right">
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
                          {item.count}只
                        </span>
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {item.samples.map(s => s.name).join("、")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 中：资金流入 */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-2 font-medium">资金流入（今日净流入）</p>
            {topInflow.length ? (
              <>
                <div ref={inflowRef} className="h-64 w-full" />
                <div className="mt-1 text-[10px] text-muted-foreground">单位：亿元（红=净流入）</div>
              </>
            ) : (
              <EmptyHint msg="暂无流入数据" />
            )}
          </div>

          {/* 右：资金流出 */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-2 font-medium">资金流出（今日净流出）</p>
            {topOutflow.length ? (
              <>
                <div ref={outflowRef} className="h-64 w-full" />
                <div className="mt-1 text-[10px] text-muted-foreground">单位：亿元（绿=净流出）</div>
              </>
            ) : (
              <EmptyHint msg="暂无流出数据" />
            )}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          热度 = 今日强势股中包含该题材的股票数量。东财 push2 被代理屏蔽时自动降级为此视图。
        </p>
      </div>
    );
  }

  // ── 正常模式：东财行业 + 资金流 ──
  return (
    <div className="rounded-xl border bg-card p-4">
      <SectionTitle
        icon={Layers}
        title="行业轮动"
        sub={`今日涨幅 TOP + 资金流入 · 共 ${data.total_industries} 个行业`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 涨幅最大行业（左侧，原始内容不动） */}
        <div>
          <p className="text-[11px] text-muted-foreground mb-2 font-medium">涨幅最大行业 TOP</p>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-1.5 font-medium">行业</th>
                  <th className="text-right py-1.5 font-medium">涨跌幅</th>
                  <th className="text-right py-1.5 font-medium">涨/跌</th>
                  <th className="text-left py-1.5 font-medium">代表个股</th>
                </tr>
              </thead>
              <tbody>
                {data.top_gain.map(r => (
                  <tr key={r.code} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-medium truncate max-w-[90px]">{r.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtPct(r.change_pct)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.up_count}/{r.down_count}</td>
                    <td className="py-1.5 text-muted-foreground truncate max-w-[160px]">
                      {r.top_stocks && r.top_stocks.length > 0
                        ? r.top_stocks.map((s: any) => s.name).join("、")
                        : r.leader || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 资金流入（中间） */}
        <div>
          <p className="text-[11px] text-muted-foreground mb-2 font-medium">资金流入（今日净流入）</p>
          {topInflow.length ? (
            <>
              <div ref={inflowRef} className="h-64 w-full" />
              <div className="mt-1 text-[10px] text-muted-foreground">单位：亿元（红=净流入）</div>
            </>
          ) : (
            <EmptyHint msg="暂无流入数据" />
          )}
        </div>

        {/* 资金流出（右侧，新加） */}
        <div>
          <p className="text-[11px] text-muted-foreground mb-2 font-medium">资金流出（今日净流出）</p>
          {topOutflow.length ? (
            <>
              <div ref={outflowRef} className="h-64 w-full" />
              <div className="mt-1 text-[10px] text-muted-foreground">单位：亿元（绿=净流出）</div>
            </>
          ) : (
            <EmptyHint msg="暂无流出数据" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Panel 2: 题材归因 ──────────────────────────────────────────────────

function ThemeAttributionPanel({ data }: { data: ThemeAttribution }) {
  const [expanded, setExpanded] = useState(false);

  if (!data.available) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <SectionTitle icon={Flame} title="题材归因" sub="题材驱动 · 概念维度" />
        <EmptyHint msg={data.building ? "题材数据正在后台生成中…" : "题材数据暂不可用（同花顺接口中断）"} />
      </div>
    );
  }

  // 以题材维度聚合：每个题材一块，下列其强势股（看「今天哪些概念在驱动」）
  const themes = expanded ? data.themes : data.themes.slice(0, 6);

  return (
    <div className="rounded-xl border bg-card p-4">
      <SectionTitle
        icon={Flame}
        title="题材归因"
        sub={`${data.themes.length} 个题材驱动 · ${data.stocks.length} 只强势股`}
      />
      <p className="-mt-2 mb-3 text-[10px] text-muted-foreground">
        按题材聚合 · 看「今天哪些概念在驱动市场」
      </p>

      <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1">
        {themes.map(t => {
          const members = data.stocks.filter(s => s.themes.includes(t.theme));
          if (!members.length) return null;
          return (
            <div key={t.theme} className="rounded-lg border border-border/50 p-2.5">
              {/* 题材头部 */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300 px-2 py-0.5 text-[11px] font-semibold">
                  {t.theme}
                </span>
                <span className="text-[10px] text-muted-foreground">{t.count} 只相关</span>
              </div>
              {t.reason && (
                <p className="text-[11px] leading-relaxed mb-2 px-1 py-1 rounded bg-blue-50/60 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  💡 {t.reason}
                </p>
              )}

              {/* 个股列表（简洁；财务/买卖指导在「策略信号」面板的题材精选双列中展示） */}
              <div className="space-y-1">
                {members.slice(0, 8).map(s => (
                  <div
                    key={s.code}
                    className="flex items-center justify-between gap-1.5 text-xs py-1 px-1.5 rounded-md bg-muted/30"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <StockNameLink code={s.code} name={s.name} />
                      <span className="text-muted-foreground shrink-0 text-[10px]">{s.code}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="tabular-nums font-medium">{fmtPrice(s.price)}</span>
                      {fmtPct(s.realtime_pct ?? s.change_pct)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {data.themes.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-2 px-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          {expanded ? "收起" : `展开全部 ${data.themes.length} 个题材`}
        </button>
      )}

      <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{data.note}</p>
    </div>
  );
}

// ── 题材精选双列：左=当天涨幅Top3 | 右=Serenity基本面精选（独立选股） ──

/** 左侧单行：涨幅排名 + 名称代码 + 价格 + 涨幅 + [展开]财务 */
function GainerRow({ p, rank }: { p: ThemePick; rank: number }) {
  const [open, setOpen] = useState(false);
  const fin = p.fin;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 min-w-0 py-1.5 px-2 rounded-md bg-muted/30 text-xs">
        <span className="shrink-0 text-[11px] font-bold text-orange-600 dark:text-orange-400">
          {rank}
        </span>
        <StockNameLink code={p.code} name={p.name} />
        <span className="text-muted-foreground shrink-0 text-[10px]">{p.code}</span>
        <span className="tabular-nums font-medium shrink-0 ml-auto">{fmtPrice(p.price)}</span>
        {fmtPct(p.change_pct)}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="shrink-0 ml-1 px-1.5 py-0.5 text-[10px] border border-border/50 rounded hover:bg-accent transition-colors"
        >
          {open ? "收起" : "展开"}
        </button>
      </div>
      {/* 展开时：财务五指标 */}
      {open && fin && (
        <div className="ml-7 mr-2 px-2 py-1.5 rounded-md bg-card/60 border border-border/30 grid grid-cols-3 gap-x-3 gap-y-0.5 text-[9px] leading-tight">
          <span className="text-muted-foreground">
            营收<span className="tabular-nums text-foreground ml-0.5">{fmtFinYi(fin.revenue)}</span>
            <span className={pctColor(fin.revenue_yoy)}>{fmtPctRaw(fin.revenue_yoy)}</span>
          </span>
          <span className="text-muted-foreground">
            净利<span className="tabular-nums text-foreground ml-0.5">{fmtFinYi(fin.profit)}</span>
            <span className={pctColor(fin.profit_yoy)}>{fmtPctRaw(fin.profit_yoy)}</span>
          </span>
          <span className="text-muted-foreground">
            毛利率<span className="tabular-nums text-foreground ml-0.5">{fin.gross_margin != null ? fin.gross_margin.toFixed(1) + "%" : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            净利率<span className="tabular-nums text-foreground ml-0.5">{fin.net_margin != null ? fin.net_margin.toFixed(1) + "%" : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            负债率<span className="tabular-nums text-foreground ml-0.5">{fin.debt_ratio != null ? fin.debt_ratio.toFixed(1) + "%" : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            现金流<span className="tabular-nums text-foreground ml-0.5">{fmtFinYi(fin.operating_cash_flow)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** 右侧 Serenity 单只个股卡：展开显示完整 Serenity 评分卡 */
function SerenityCard({ p }: { p: ThemePick }) {
  const [open, setOpen] = useState(false);
  const fin = p.fin;
  return (
    <div className="rounded-md border border-border/40 bg-card/50 text-xs">
      {/* 头部：名称 + 价格涨跌 + 展开 */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <StockNameLink code={p.code} name={p.name} />
          <span className="tabular-nums font-medium shrink-0">{fmtPrice(p.price)}</span>
          {fmtPct(p.change_pct)}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="shrink-0 px-1.5 py-0.5 text-[9px] border border-border/40 rounded hover:bg-accent transition-colors"
        >
          {open ? "收起" : "展开"}
        </button>
      </div>

      {/* 常显：买卖指导 */}
      <div className="px-2 pb-1 text-[9px] leading-tight">
        {p.buy.buy_low != null && p.buy.buy_high != null ? (
          <span className="text-green-600 dark:text-green-400 font-medium">
            买 {p.buy.buy_low}~{p.buy.buy_high} · 止损 {p.buy.stop_loss}
          </span>
        ) : (
          <span className="text-orange-600 dark:text-orange-400">{p.buy.note}</span>
        )}
      </div>

      {/* 展开时：财务摘要 + 🔑关键证据 + 完整 Serenity 评分卡 */}
      {open && (
        <div className="px-2 pb-1.5 pt-1 border-t border-border/30 space-y-1.5">
          {/* 财务摘要行（紧凑一行） */}
          {fin && (
            <div className="text-[9px] leading-tight space-y-0.5">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span>营收<span className="text-foreground tabular-nums">{fmtFinYi(fin.revenue)}</span><span className={pctColor(fin.revenue_yoy)}>{fmtPctRaw(fin.revenue_yoy)}</span></span>
                <span>净利<span className="text-foreground tabular-nums">{fmtFinYi(fin.profit)}</span><span className={pctColor(fin.profit_yoy)}>{fmtPctRaw(fin.profit_yoy)}</span></span>
                <span>毛利率<span className="text-foreground tabular-nums">{fin.gross_margin != null ? fin.gross_margin.toFixed(1) + "%" : "—"}</span></span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span>合同负债<span className="text-foreground tabular-nums">{fmtFinYi(fin.contract_liability)}</span></span>
                <span>经营现金流<span className="text-foreground tabular-nums">{fmtFinYi(fin.operating_cash_flow)}</span></span>
              </div>
            </div>
          )}

          {/* 🔑 关键证据 */}
          {p.evidence && (
            <p className="text-[9px] leading-tight text-blue-700 dark:text-blue-300">
              🔑 {p.evidence}
            </p>
          )}

          {/* ── Serenity 完整评分卡 ── */}
          {p.serenity_analysis ? (
            <div className="rounded-sm bg-amber-50/70 dark:bg-amber-950/20 px-2 py-1.5 text-[9px] leading-relaxed text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
              {p.serenity_analysis.split(/(?=【)/).map((seg, i) =>
                seg.startsWith("【") ? (
                  <span key={i}>
                    <strong>{seg.slice(0, seg.indexOf("】") + 1)}</strong>
                    {seg.slice(seg.indexOf("】") + 1)}
                  </span>
                ) : <span key={i}>{seg}</span>
              )}
            </div>
          ) : (
            fin && <p className="text-[9px] text-muted-foreground italic">Serenity 评分卡生成中…</p>
          )}
        </div>
      )}
    </div>
  );
}

function ThemePicksBlock({ themes, onRefreshSerenity }: { themes: ThemeItem[]; onRefreshSerenity?: () => void }) {
  const themesWithPicks = themes.filter(
    t => (t.top_picks && t.top_picks.length > 0) || (t.serenity_picks && t.serenity_picks.length > 0)
  );
  if (!themesWithPicks.length) return null;
  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold">题材精选 · 买卖指导</span>
        <span className="text-[10px] text-muted-foreground">左=当日强势 | 右=Serenity基本面精选</span>
      </div>
      <div className="space-y-3 max-h-[36rem] overflow-y-auto pr-1">
        {themesWithPicks.map(t => {
          const gainers = t.top_picks || [];
          const serenity = t.serenity_picks || [];
          return (
            <div key={t.theme} className="rounded-lg border border-border/50 p-2.5">
              {/* 题材头部 */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300 px-2 py-0.5 text-[11px] font-semibold">
                  {t.theme}
                </span>
                <span className="text-[10px] text-muted-foreground">{t.count} 只相关</span>
              </div>
              {t.reason && (
                <p className="text-[11px] leading-relaxed mb-2 px-1 py-1 rounded bg-blue-50/60 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  💡 {t.reason}
                </p>
              )}

              {/* 左右双列：左=涨幅Top | 右=Serenity精选 */}
              <div className="grid grid-cols-2 gap-3">
                {/* ── 左列：当日涨幅 Top3 ── */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-foreground/70 mb-1">
                    当日强势股
                  </div>
                  {gainers.length > 0 ? (
                    gainers.map((p, i) => <GainerRow key={`g-${p.code}`} p={p} rank={i + 1} />)
                  ) : (
                    <p className="text-[10px] text-muted-foreground px-1">暂无数据</p>
                  )}
                </div>

                {/* ── 右列：Serenity 基本面精选（独立选股） ── */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-foreground/70 mb-1 flex items-center gap-1">
                    <span>serenity</span>
                    {onRefreshSerenity && (
                      <button
                        type="button"
                        onClick={onRefreshSerenity}
                        className="ml-auto inline-flex items-center gap-0.5 rounded-md border border-amber-300/40 bg-amber-50/70 px-1 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-100 hover:border-amber-400/50 active:scale-[0.97] transition-all dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-400"
                        title="⚡ 重新分析 Serenity 基本面精选（消耗 token）"
                      >
                        <Zap className="h-2.5 w-2.5" />
                        AI
                      </button>
                    )}
                  </div>
                  {serenity.length > 0 ? (
                    serenity.map(p => <SerenityCard key={`s-${p.code}`} p={p} />)
                  ) : (
                    <p className="text-[10px] text-muted-foreground px-1">正在分析…</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel 3: 涨停归因 ──────────────────────────────────────────────────

function LimitupAttributionPanel({ data }: { data: LimitupAttribution }) {
  const [filter, setFilter] = useState<string | null>(null);

  if (!data.available) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <SectionTitle icon={Flag} title="涨停归因" sub="连板高度 · 打板维度" />
        <EmptyHint msg="涨停数据暂不可用" />
      </div>
    );
  }

  const visible = filter
    ? data.stocks.filter(s => s.themes.includes(filter))
    : data.stocks;
  // 按连板高度分组（高 → 低），突出「几天几板」
  const boardLevels = Array.from(new Set(visible.map(s => s.boards))).sort((a, b) => b - a);

  return (
    <div className="rounded-xl border bg-card p-4">
      <SectionTitle
        icon={Flag}
        title="涨停归因"
        sub={`${data.stocks.length} 只涨停 · 最高 ${boardLabel(data.max_board)}`}
      />
      <p className="-mt-2 mb-3 text-[10px] text-muted-foreground">
        按连板高度聚合 · 看「今天谁涨停、到了几板」
      </p>

      {/* 题材筛选 */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Tag active={filter === null} onClick={() => setFilter(null)}>
          全部 <span className="text-muted-foreground">×{data.stocks.length}</span>
        </Tag>
        {data.theme_summary.slice(0, 6).map(t => (
          <Tag key={t.theme} active={filter === t.theme} onClick={() => setFilter(filter === t.theme ? null : t.theme)}>
            {t.theme} <span className="text-muted-foreground">×{t.count}</span>
          </Tag>
        ))}
        {data.theme_summary.length > 6 && (
          <span className="text-[10px] text-muted-foreground">+{data.theme_summary.length - 6}…</span>
        )}
      </div>

      {/* 连板阶梯分组 */}
      <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1">
        {boardLevels.map(b => {
          const group = visible.filter(s => s.boards === b);
          if (!group.length) return null;
          return (
            <div key={b} className="rounded-lg border border-border/50 p-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-bold tabular-nums",
                    b > 1
                      ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300",
                  )}
                >
                  {boardLabel(b)}
                </span>
                <span className="text-[10px] text-muted-foreground">{group.length} 只</span>
              </div>
              <div className="space-y-1">
                {group.map(s => (
                  <div
                    key={s.code}
                    className="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded-md hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StockNameLink code={s.code} name={s.name} />
                        <span className="text-muted-foreground shrink-0">{s.code}</span>
                        <span className="tabular-nums font-medium shrink-0">{fmtPrice(s.price)}</span>
                        <span className="shrink-0 tabular-nums">{fmtPct(s.realtime_pct ?? s.change_pct)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {s.themes.join(" · ") || s.reason || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!visible.length && <EmptyHint msg="该题材下暂无涨停个股" />}
      </div>
    </div>
  );
}

// ── 第 5 面板：策略信号（规则合成现有 4 面板） ──────────────────────────

function _confColor(c: string): string {
  if (c === "高") return "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400";
  if (c === "中") return "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400";
  return "text-foreground bg-slate-100 dark:bg-slate-800 dark:text-foreground";
}

function _typeColor(t: string): string {
  if (t === "主线延续") return "text-red-500";
  if (t === "连板接力") return "text-orange-500";
  return "text-blue-500";
}

function _typeIcon(t: string): React.ElementType {
  if (t === "连板接力") return TrendingUp;
  if (t === "题材埋伏") return Zap;
  return Target;
}

function StrategyRadarPanel({
  data,
  date,
  themes,
  onRefreshSerenity,
}: {
  data: StrategySuggestions;
  date: string;
  themes?: ThemeItem[];
  onRefreshSerenity?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const addPlan = async (stock: StrategyStock, strategy: StrategyCard) => {
    setBusy(stock.code);
    try {
      // 解析后端返回的字符串型价格区间为结构化 PlanField
      function parseRange(r: string | undefined): [number | null, number | null] {
        if (!r) return [null, null];
        const parts = r.split("～");
        if (parts.length === 2) {
          return [parseFloat(parts[0]) || null, parseFloat(parts[1]) || null];
        }
        const v = parseFloat(r);
        return [isNaN(v) ? null : v, null];
      }
      function parsePrice(p: string | undefined): number | null {
        if (!p) return null;
        const v = parseFloat(p);
        return isNaN(v) ? null : v;
      }
      const [brLow, brHigh] = parseRange(stock.buy_range);

      await api.createPlan({
        trade_id: `STRAT-${date}-${stock.code}`,
        signal_id: `STRAT-${date}-${stock.code}`,
        stock_code: stock.code,
        stock_name: stock.name,
        fields: {
          reason: `[${strategy.type}] ${strategy.rationale}\n策略逻辑：${strategy.trade_logic || ""}`,
          buy_range_low: brLow,
          buy_range_high: brHigh,
          stop_loss_price: parsePrice(stock.stop_loss),
          target_price: parsePrice(stock.target),
          note: [stock.note || "", stock.params_note || "", stock.risk_reward ? `盈亏比${stock.risk_reward}` : ""]
            .filter(Boolean).join(" · "),
        },
        status: "未执行",
        created_at: new Date().toISOString(),
      });
      toast.success(`已加入交易计划：${stock.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加入计划失败");
    } finally {
      setBusy(null);
    }
  };

  if (!data.available) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <SectionTitle icon={Target} title="策略信号" sub="由现有面板规则合成" />
        <EmptyHint msg="当前数据不足，暂无可合成的策略（等待收盘或数据源恢复）" />
      </div>
    );
  }

  const mkt = data.market_temp;
  // 市场温度颜色
  const cycleColor = (c?: string) => {
    switch (c) {
      case "上行": return "text-green-600 bg-green-50 dark:bg-green-900/20";
      case "混沌": return "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20";
      case "退潮": return "text-orange-600 bg-orange-50 dark:bg-orange-900/20";
      case "冰点": return "text-blue-600 bg-blue-50 dark:bg-blue-900/20";
      default: return "text-muted-foreground bg-muted";
    }
  };
  // 温度计分数条颜色
  const scoreColor = (s: number) => {
    if (s >= 70) return "bg-green-500";
    if (s >= 45) return "bg-yellow-500";
    if (s >= 25) return "bg-orange-500";
    return "bg-blue-500";
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <SectionTitle icon={Target} title="策略信号" sub="行业轮动 × 题材归因 × 涨停打板（规则合成）" />

      {/* 市场温度计 */}
      {mkt && (
        <div className={cn("rounded-lg border p-2.5 mb-3 flex items-center gap-3", cycleColor(mkt.cycle))}>
          <span className="text-[10px] font-semibold shrink-0">市场周期</span>
          <span className="text-xs font-bold">{mkt.cycle}</span>
          {/* 分数条 */}
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", scoreColor(mkt.score))}
                style={{ width: `${mkt.score}%` }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums">{mkt.score}</span>
          </div>
          <span className="text-[11px] hidden sm:inline">{mkt.desc}</span>
        </div>
      )}

      {/* 策略卡：两列并排，股票默认收起、展开后两列网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.strategies.map((s, i) => {
          const Icon = _typeIcon(s.type);
          const key = `${s.type}-${i}`;
          const isExpanded = expanded.has(key);
          return (
            <div key={key} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <Icon className={cn("h-3.5 w-3.5", _typeColor(s.type))} />
                <span className={cn("text-xs font-semibold", _typeColor(s.type))}>{s.type}</span>
                <span className="text-sm font-medium">{s.title}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold", _confColor(s.confidence))}>
                  置信度 {s.confidence}
                </span>
              </div>
              <p className="text-[11px] text-foreground leading-relaxed mb-2">{s.rationale}</p>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-foreground">操作：</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{s.action}</span>
              </div>
              {s.trade_logic && (
                <div className="mb-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[10px] leading-relaxed text-foreground">{s.trade_logic}</p>
                </div>
              )}
              {s.stocks.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(prev => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    className="mt-1 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/40"
                  >
                    {isExpanded ? (
                      <>收起 <ChevronUp className="h-3 w-3" /></>
                    ) : (
                      <>展开 {s.stocks.length} 只股票 <ChevronDown className="h-3 w-3" /></>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {s.stocks.map(st => (
                        <div
                          key={st.code}
                          className="rounded-md border border-border/60 bg-background p-2"
                        >
                          <div className="flex items-start gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <StockNameLink code={st.code} name={st.name} />
                                <span className="text-[10px] font-mono text-foreground">{st.code}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                                {st.price != null && <span className="tabular-nums">{fmtPrice(st.price)}</span>}
                                {st.buy_range && <span className="text-emerald-600 dark:text-emerald-400">{st.buy_range}</span>}
                                {st.risk_reward && <span className="text-amber-600 dark:text-amber-400">{st.risk_reward}</span>}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addPlan(st, s)}
                              disabled={busy === st.code}
                              className="shrink-0 inline-flex items-center justify-center rounded-sm hover:bg-primary/10 transition-colors disabled:opacity-50 p-0.5"
                              title={
                                st.buy_range
                                  ? `${st.name}（${s.type}） · 买点:${st.buy_range} 止损:${st.stop_loss} 目标:${st.target}${st.risk_reward ? ' · 盈亏比' + st.risk_reward : ''}${st.params_note ? '\n' + st.params_note : ''}`
                                  : `加入交易计划：${st.name}`
                              }
                            >
                              <Plus className="h-3 w-3 text-primary shrink-0" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 题材精选 · 买卖指导（serenity 风格双列，接题材归因数据） */}
      {themes && themes.length > 0 && <ThemePicksBlock themes={themes} onRefreshSerenity={onRefreshSerenity} />}

      {/* 风险预警 */}
      {data.risk_alerts.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/10 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">风险预警</span>
          </div>
          <ul className="space-y-1">
            {data.risk_alerts.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                <span className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold mt-0.5",
                  r.level === "高"
                    ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                    : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
                )}>
                  {r.level}
                </span>
                <span className="text-muted-foreground">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">{data.note}</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

const REVIEW_CACHE_KEY = "aquant_review_cache_v1";

type CachedReview = { date: string; data: ReviewData };

function loadCachedReview(): CachedReview | null {
  try {
    const raw = localStorage.getItem(REVIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedReview;
    if (parsed && typeof parsed.date === "string" && parsed.data) return parsed;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

function saveCachedReview(date: string, data: ReviewData) {
  try {
    localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify({ date, data }));
  } catch {
    /* quota exceeded or unavailable — ignore */
  }
}

// ── VS 每日复盘同款：市场情绪 ───────────────────────────────────────
function MarketSentimentPanel({ data }: { data: Partial<MarketSentiment> }) {
  const s = data;
  const cells = s ? [
    { k: "上涨家数", v: s.up, up: true },
    { k: "下跌家数", v: s.down, up: false },
    { k: "平盘", v: s.flat, up: null },
    { k: "涨停", v: s.zt, up: true },
    { k: "真实涨停", v: s.zt_real, up: true },
    { k: "跌停", v: s.dt, up: false },
    { k: "真实跌停", v: s.dt_real, up: false },
    { k: "活跃度", v: s.active, up: null },
  ] : [];

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><Gauge className="h-4 w-4" /> 市场情绪</h3>
        {s?.date && <span className="text-[11px] text-muted-foreground/50">{s.date}</span>}
      </div>
      {!s?.breadth ? (
        <p className="py-4 text-center text-sm text-muted-foreground/60">暂无数据：可能是非交易时段或数据源暂不可用</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-2">
          {/* 左侧：大盘宽度 + 题材投机 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {[
              { k: "大盘宽度", v: s.breadth, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
              { k: "题材投机", v: s.speculation, hint: "冰点 / 偏弱 / 中性 / 偏强 / 普涨" },
            ].map((m) => (
              <div key={m.k} className="rounded-lg bg-muted/25 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{m.k}</span>
                  <span className="text-[10px] text-muted-foreground/50">（{m.hint}）</span>
                </div>
                <p className="mt-0.5 text-xl font-bold text-orange-500">{m.v}</p>
              </div>
            ))}
          </div>
          {/* 右侧：8个指标 */}
          <div className="grid grid-cols-4 gap-1.5">
            {cells.map((c) => (
              <div key={c.k} className="rounded-lg bg-muted/20 px-1 py-1.5 text-center">
                <p className="truncate text-[10px] text-muted-foreground">{c.k}</p>
                <p className={cn("mt-0.5 font-mono text-xs font-bold", c.up === null ? "text-foreground" : c.up ? "text-danger" : "text-success")}>{c.v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel 4: 短线情绪（与 VR 每日复盘同口径，东财涨停四池真实值） ──

function fmtYi(v: number | null | undefined): string {
  if (v == null) return "—";
  const yi = v / 1e8;
  if (Math.abs(yi) >= 10000) return `${(yi / 10000).toFixed(2)} 万亿`;
  return `${yi.toFixed(2)} 亿`;
}

function ShortTermEmotionPanel({ data }: { data?: Partial<ShortTermEmotion> }) {
  if (!data || (data.zt_count == null && data.dt_count == null)) {
    return (
      <div className="rounded-xl border bg-card p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Flame className="h-4 w-4" /> 短线情绪
        </h3>
        <p className="py-4 text-center text-sm text-muted-foreground/60">
          暂无数据：可能是非交易时段或东财涨停池暂不可用
        </p>
      </div>
    );
  }

  const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  const cells = [
    { k: "涨停", v: data.zt_count, color: "text-danger" },
    { k: "跌停", v: data.dt_count, color: "text-success" },
    { k: "最高连板", v: data.max_boards ? `${data.max_boards} 板` : "—", color: "text-orange-500" },
    { k: "连板(2板+)", v: data.lianban_count, color: "text-danger" },
    { k: "封板率", v: pct(data.seal_rate), color: "text-blue-500" },
    { k: "炸板率", v: pct(data.break_rate), color: "text-amber-500" },
    { k: "晋级率", v: pct(data.promotion_rate), color: "text-purple-500" },
  ];

  const stocks = data.lianban_stocks ?? [];
  const ladder = data.ladder ?? [];

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Flame className="h-4 w-4" /> 短线情绪
        </h3>
        {data.date && <span className="text-[11px] text-muted-foreground/50">{data.date}</span>}
      </div>

      {/* 7 指标 + 连板高度 */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {cells.map((c) => (
          <div key={c.k} className="rounded-lg bg-muted/20 px-1 py-1.5 text-center">
            <p className="truncate text-[10px] text-muted-foreground">{c.k}</p>
            <p className={cn("mt-0.5 font-mono text-sm font-bold", c.color)}>{c.v}</p>
          </div>
        ))}
        <div className="rounded-lg bg-muted/20 px-1 py-1.5 text-center">
          <p className="truncate text-[10px] text-muted-foreground">连板高度</p>
          <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
            {ladder.map((l) => `${l.board}板${l.count}`).join(" / ") || "—"}
          </p>
        </div>
      </div>

      {/* 连板股表 */}
      {stocks.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <p className="text-[11px] font-medium text-muted-foreground px-2 py-1.5 bg-muted/30">
            连板股（2板以上）· 共 {stocks.length} 只
          </p>
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left font-medium px-2 py-1">名称</th>
                  <th className="text-right font-medium px-1 py-1">连板</th>
                  <th className="text-right font-medium px-1 py-1">最新价</th>
                  <th className="text-right font-medium px-1 py-1">涨跌幅</th>
                  <th className="text-right font-medium px-1 py-1">成交额</th>
                  <th className="text-left font-medium px-2 py-1">行业</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <tr key={s.code} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-2 py-1 truncate max-w-[96px]">
                      <StockNameLink code={s.code} name={s.name} />
                    </td>
                    <td className={cn("text-right px-1 py-1 font-bold tabular-nums", s.boards > 1 ? "text-danger" : "text-orange-500")}>
                      {boardLabel(s.boards)}
                    </td>
                    <td className="text-right px-1 py-1 tabular-nums text-foreground">{fmtPrice(s.price)}</td>
                    <td className="text-right px-1 py-1 tabular-nums">{fmtPct(s.pct)}</td>
                    <td className="text-right px-1 py-1 tabular-nums text-muted-foreground">{fmtYi(s.amount)}</td>
                    <td className="px-2 py-1 truncate max-w-[88px] text-muted-foreground">{s.industry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70 mt-2">
        数据来源：akshare 东财涨停四池（涨停 / 炸板 / 跌停 / 昨涨停），与 VR 每日复盘同口径
      </p>
    </div>
  );
}

export function AquantReview() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [date, setDate] = useState<string>(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开页面自动刷新基础面板（行业轮动/题材归因/涨停等），但 Serenity 基本面精选走本地缓存
  // forceRefreshAI=true 时后端强制重新调用 LLM（消耗 token），默认走 LLM 缓存不烧 token
  const fetchDashboard = useCallback(async (opts?: { fromCache?: boolean; forceRefreshAI?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const parts: string[] = [];
      if (date) parts.push(`date=${date}`);
      if (opts?.forceRefreshAI) parts.push("force_refresh=1");
      const qs = parts.length ? `?${parts.join("&")}` : "";
      const res = await request<ReviewData>(`/aquant/review/dashboard${qs}`);
      const fromCache = opts?.fromCache !== false;
      // 自动刷新：用本地缓存的 serenity_picks 替换 API 返回的 serenity_picks，避免每次打开都消耗 token
      if (fromCache && res.theme_attribution?.themes) {
        const cached = loadCachedReview();
        if (cached && cached.date === date && cached.data?.theme_attribution?.themes) {
          const cachedSerenityByTheme = new Map(
            cached.data.theme_attribution.themes.map(t => [t.theme, t.serenity_picks])
          );
          res.theme_attribution = {
            ...res.theme_attribution,
            themes: res.theme_attribution.themes.map(t => ({
              ...t,
              serenity_picks: cachedSerenityByTheme.get(t.theme) ?? t.serenity_picks,
            })),
          };
        }
      }
      setData(res);
      // 只有手动刷新（Serenity 按钮 / 全局刷新）才写入缓存，覆盖旧的 serenity 数据
      if (opts?.fromCache === false) {
        saveCachedReview(date, res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "复盘数据加载失败");
      toast.error("复盘数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchDashboard({ fromCache: true }); }, [fetchDashboard]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between shrink-0 gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            复盘雷达
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            a-stock-data · 行业轮动 / 题材归因 / 涨停归因 / 短线情绪
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <CalendarDays className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border bg-card pl-7 pr-2 py-1.5 text-xs text-foreground"
            />
          </div>
          <button
            onClick={() => fetchDashboard({ fromCache: false })}
            className="p-1.5 rounded-md border bg-card hover:bg-muted text-muted-foreground transition-colors"
            title="刷新全部（走缓存，不烧 token）"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => fetchDashboard({ fromCache: false, forceRefreshAI: true })}
            className="inline-flex items-center gap-0.5 rounded-md border border-amber-300/50 bg-amber-50/80 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 shadow-sm hover:bg-amber-100 hover:border-amber-400/60 active:scale-[0.97] transition-all dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60"
            title="⚡ 刷新 AI 分析（消耗 token）"
          >
            <Zap className="h-2.5 w-2.5" />
            <span>AI</span>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && !data && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {data?.building && (
          <div className="rounded-xl border border-blue-300/40 bg-blue-50/60 dark:bg-blue-950/30 p-4 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            复盘数据量较大，正在后台生成（行业轮动 + 题材归因 + 涨停 + 财报 + 买卖指导），约 1~2 分钟，可点击右上角刷新按钮手动获取最新数据…
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* VS 每日复盘同款：市场情绪（顶部） */}
            <MarketSentimentPanel data={data.market_sentiment ?? {}} />

            {/* 面板 1：行业轮动（全宽） */}
            <SectorRotationPanel data={data.sector_rotation ?? { available: false, sectors: [] }} />

            {/* 面板 2+3：题材归因（左） + 涨停归因（右） 并排 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ThemeAttributionPanel data={data.theme_attribution ?? { available: false, themes: [] }} />
              <LimitupAttributionPanel data={data.limitup_attribution ?? { available: false, stocks: [], max_board: 0 }} />
            </div>

            {/* 面板 4：短线情绪（全宽，与 VR 每日复盘同口径） */}
            <ShortTermEmotionPanel data={data.short_term_emotion} />

            {/* 面板 5：策略信号（全宽） */}
            <StrategyRadarPanel
              data={data.strategy_suggestions ?? { available: false, strategies: [] }}
              date={data.date ?? ''}
              themes={data.theme_attribution?.themes}
              onRefreshSerenity={() => fetchDashboard({ fromCache: false, forceRefreshAI: true })}
            />

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              数据日期：{data.date} · 涨停归因由同花顺 getharden 推导
            </p>
          </>
        ) : (
          <div className="rounded-xl border bg-card p-8 flex flex-col items-center justify-center text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-foreground font-medium">复盘数据尚未加载</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              点击右上角刷新按钮，获取今日复盘雷达数据（按需加载，节省资源）
            </p>
            <button
              onClick={() => fetchDashboard({ fromCache: false })}
              className="mt-4 inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              立即加载复盘数据
            </button>
          </div>
        )}
      </div>
    </div>
  );
}