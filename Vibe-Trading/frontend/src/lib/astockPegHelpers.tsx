import type { ReactNode, ElementType } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { BarChart3, Activity, LineChart as LineChartIcon, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";

// ── API base ───────────────────────────────────────────────────────────
// 网页版：VITE_API_BASE 是主隧道地址，PEG 经主隧道打到主后端 8898，
// 由主后端在 Mac 本地把 /peg-api 代理到 3000（astock-peg），绕过 Cloudflare 自环。
// 本地开发：VITE_API_BASE 为空，退化为 /peg-api，由 vite dev proxy 转发。
const PEG_BASE: string = (import.meta as any).env?.VITE_API_BASE ?? "";
export const PEG_API = `${PEG_BASE}/peg-api`;

// ── Types ──────────────────────────────────────────────────────────────

export interface LiveStock {
  ticker: string;
  name: string;
  price: number;
  prevClose: number;
  changePct: number;
  peTtm: number;
  pb: number;
  marketCap: number;
  turnover: number;
  pe26e: number;
  cagr: number;
  peg: number;
  digestYears: number;
  sectorKey: string;
}

export interface QuotesData {
  timestamp: string;
  watchlist: LiveStock[];
}

export interface AnalysisRecord {
  id: string;
  ticker: string;
  name: string;
  date: string;
  status: "collecting" | "analyzing" | "completed" | "failed";
  conclusion?: string;
  pegRating?: string;
  error?: string;
  report?: string | null;
}

export interface SectorStock {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  peTtm: number;
  pb: number;
  marketCap: number;
  peg: number | null;
}

export interface SectorData {
  timestamp: string;
  stocks: SectorStock[];
  stats: {
    count: number;
    avgPe: number;
    medianPe: number;
    totalMarketCap: number;
  };
}

export interface NewsItem {
  category: "stock" | "market" | "announcement";
  ticker?: string;
  [key: string]: unknown;
}

export interface NewsData {
  collected_at: string;
  stock_news: NewsItem[];
  market_news: NewsItem[];
  announcements: NewsItem[];
  error?: string;
}

export type TabKey = "dashboard" | "analysis" | "sector" | "news";
export type SortField = "name" | "ticker" | "price" | "changePct" | "peTtm" | "pb" | "marketCap" | "peg" | "vsSectorAvg" | null;
export type SortOrder = "asc" | "desc" | null;

// ── Helpers ────────────────────────────────────────────────────────────

export function changeColor(v: number): string {
  if (v > 0) return "text-danger";
  if (v < 0) return "text-success";
  return "text-muted-foreground";
}

export function pegColor(peg: number): string {
  if (peg < 1) return "text-success";
  if (peg < 1.5) return "text-warning";
  return "text-danger";
}

export function statusLabel(s: AnalysisRecord["status"]): { text: string; className: string } {
  switch (s) {
    case "collecting": return { text: "数据采集中...", className: "text-warning" };
    case "analyzing": return { text: "AI 分析中...", className: "text-primary" };
    case "completed": return { text: "完成", className: "text-success" };
    case "failed": return { text: "失败", className: "text-danger" };
  }
}

export function pegRatingBadge(rating?: string): { text: string; className: string } | null {
  if (!rating) return null;
  if (rating.includes("极度低估")) return { text: "极度低估", className: "text-success" };
  if (rating.includes("低估")) return { text: "低估", className: "text-success" };
  if (rating.includes("合理")) return { text: "合理", className: "text-warning" };
  if (rating.includes("偏贵")) return { text: "偏贵", className: "text-orange-500" };
  if (rating.includes("高估")) return { text: "高估", className: "text-danger" };
  return { text: rating, className: "text-muted-foreground" };
}

// ── News helpers ───────────────────────────────────────────────────────

export function getTitle(item: NewsItem): string {
  for (const k of ["新闻标题", "title", "标题", "巨潮资讯网公告"]) {
    if (typeof item[k] === "string" && (item[k] as string).length > 0) return item[k] as string;
  }
  for (const [, v] of Object.entries(item)) {
    if (typeof v === "string" && v.length > 10 && v.length < 200) return v;
  }
  return "无标题";
}

export function getTime(item: NewsItem): string {
  for (const k of ["发布时间", "time", "datetime", "公告日期", "date"]) {
    const v = item[k];
    if (typeof v === "string" && v.length > 0 && /\d{4}[-/]\d{2}[-/]\d{2}/.test(v)) return v.slice(0, 19);
  }
  return "";
}

export function getSource(item: NewsItem): string {
  for (const k of ["文章来源", "source", "来源"]) {
    if (typeof item[k] === "string" && (item[k] as string).length > 0) return item[k] as string;
  }
  if (item.category === "market") return "财联社";
  if (item.category === "announcement") return "巨潮资讯";
  return "";
}

export function getUrl(item: NewsItem): string | null {
  for (const k of ["新闻链接", "url", "link", "公告链接"]) {
    if (typeof item[k] === "string" && (item[k] as string).startsWith("http")) return item[k] as string;
  }
  return null;
}

export function sortByTime(items: NewsItem[]): NewsItem[] {
  return [...items].filter((item) => !item.error).sort((a, b) => getTime(b).localeCompare(getTime(a)));
}

// ── Constants ──────────────────────────────────────────────────────────

export const TABS: { key: TabKey; label: string; icon: ElementType }[] = [
  { key: "dashboard", label: "自选行情", icon: BarChart3 },
  { key: "analysis", label: "PEG 分析", icon: Activity },
  { key: "sector", label: "板块对比", icon: LineChartIcon },
  { key: "news", label: "新闻公告", icon: Newspaper },
];

// ── Sortable Table Header ──────────────────────────────────────────────

export function SortHeader({
  field, label, align = "left", currentField, currentOrder, onSort,
}: {
  field: SortField;
  label: string;
  align?: "left" | "right" | "center";
  currentField: SortField | null;
  currentOrder: SortOrder | null;
  onSort: (f: SortField) => void;
}) {
  const isActive = currentField === field;
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={cn(
        "font-medium text-muted-foreground px-4 py-3 cursor-pointer select-none hover:text-foreground transition-colors",
        alignClass,
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && currentOrder === "asc" && <ArrowUp className="h-3 w-3 text-primary" />}
        {isActive && currentOrder === "desc" && <ArrowDown className="h-3 w-3 text-primary" />}
        {!isActive && <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  );
}

// ── Section Header ─────────────────────────────────────────────────────

export function SectionHeader({ icon: Icon, title, subtitle, children }: {
  icon: ElementType;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── StatCard ────────────────────────────────────────────────────────────

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold text-foreground mt-1">{value}</div>
    </div>
  );
}

// ── NewsRow ────────────────────────────────────────────────────────────

export function NewsRow({ item, showTicker }: { item: NewsItem; showTicker?: boolean }) {
  const title = getTitle(item);
  const time = getTime(item);
  const source = getSource(item);
  const url = getUrl(item);

  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-baseline gap-2">
        {showTicker && item.ticker && (
          <span className="text-[11px] font-medium text-primary shrink-0">{item.ticker}</span>
        )}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2 flex-1"
          >
            {title}
          </a>
        ) : (
          <span className="text-sm font-medium text-foreground line-clamp-2 flex-1">{title}</span>
        )}
      </div>
      <div className="flex items-center gap-3 mt-1">
        {source && <span className="text-[11px] text-muted-foreground">{source}</span>}
        {time && <span className="text-[11px] text-muted-foreground">{time}</span>}
      </div>
    </div>
  );
}
