import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity, TrendingUp, AlertCircle, RefreshCw,
  Loader2, Search, FileText, Download,
  LineChart as LineChartIcon, Newspaper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  TABS, PEG_API, changeColor, pegColor, statusLabel, pegRatingBadge,
  sortByTime,
  SortHeader, SectionHeader, StatCard, NewsRow,
} from "@/lib/astockPegHelpers";
import type {
  TabKey, AnalysisRecord, SectorData, NewsData, SortField, SortOrder,
} from "@/lib/astockPegHelpers";
import { DashboardTab } from "./astockPegDashboard";

// ════════════════════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════════════════════

export function AstockPeg() {
  const [tab, setTab] = useState<TabKey>("dashboard");

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "analysis" && <AnalysisTab />}
      {tab === "sector" && <SectorTab />}
      {tab === "news" && <NewsTab />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tab 2: Analysis (PEG 分析)
// ════════════════════════════════════════════════════════════════════════

function AnalysisTab() {
  const [ticker, setTicker] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentReport, setCurrentReport] = useState<AnalysisRecord | null>(null);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const resp = await fetch(`${PEG_API}/analysis`);
      if (resp.ok) {
        const data: AnalysisRecord[] = await resp.json();
        setHistory(data.sort((a, b) => b.date.localeCompare(a.date)));
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const resp = await fetch(`${PEG_API}/analysis/${id}`);
      if (!resp.ok) return;
      const data: AnalysisRecord = await resp.json();
      setCurrentReport(data);
      if (data.status === "completed" || data.status === "failed") {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        loadHistory();
      }
    } catch { /* noop */ }
  }, [loadHistory]);

  useEffect(() => {
    if (!currentId) return;
    pollStatus(currentId);
    pollingRef.current = setInterval(() => pollStatus(currentId), 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [currentId, pollStatus]);

  async function handleSubmit() {
    if (!ticker || ticker.length !== 6) return;
    setSubmitting(true);
    setError(null);
    setCurrentReport(null);
    try {
      const resp = await fetch(`${PEG_API}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "提交失败");
      setCurrentId(data.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  function handleViewHistory(record: AnalysisRecord) {
    setCurrentId(record.id);
    setCurrentReport(null);
  }

  const st = currentReport ? statusLabel(currentReport.status) : null;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Activity}
        title="PEG 个股分析"
        subtitle="输入代码后系统将采集行情+研报+财务数据，AI 生成 PEG 估值分析报告"
      />

      {/* Input */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="输入6位股票代码"
          maxLength={6}
          className="px-4 py-2 text-sm font-mono rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none w-48"
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || ticker.length !== 6}
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          {submitting ? "提交中..." : "开始 PEG 分析"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>

      {/* Current report */}
      {currentReport && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-base font-semibold text-foreground">
              {currentReport.name || currentReport.ticker}
              <span className="ml-2 text-xs font-mono text-muted-foreground">{currentReport.ticker}</span>
            </h3>
            <span className={cn("px-2 py-0.5 text-[11px] font-semibold rounded border", st!.className,
              "border-current")}>
              {st!.text}
            </span>
            {currentReport.pegRating && (() => {
              const badge = pegRatingBadge(currentReport.pegRating);
              if (!badge) return null;
              return (
                <span className={cn("px-2 py-0.5 text-[11px] font-semibold rounded border border-current", badge.className)}>
                  PEG: {badge.text}
                </span>
              );
            })()}
          </div>

          {(currentReport.status === "collecting" || currentReport.status === "analyzing") && (
            <div className="flex items-center gap-3 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                {currentReport.status === "collecting" ? "正在采集股票数据..." : "AI 正在生成 PEG 分析报告..."}
              </span>
            </div>
          )}

          {currentReport.status === "failed" && (
            <div className="py-4 px-4 rounded-lg border border-danger/30 bg-danger/5 text-sm text-danger">
              分析失败: {currentReport.error || "未知错误"}
            </div>
          )}

          {currentReport.report && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1" />
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出
                </button>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 mb-4 text-xs text-amber-800 dark:text-amber-200">
                ⚠️ 以下内容由 AI 自动生成，仅供学习研究与技术演示，不构成任何投资建议。投资有风险，决策请咨询持牌专业机构。
              </div>
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {currentReport.report}
                </Markdown>
              </article>
            </>
          )}
        </div>
      )}

      {/* History */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">历史分析</h3>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">暂无历史分析记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">日期</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">代码</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">名称</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">PEG评级</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">状态</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">结论</th>
                  <th className="text-center font-medium text-muted-foreground px-4 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const s = statusLabel(r.status);
                  const badge = pegRatingBadge(r.pegRating);
                  return (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{r.date}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{r.ticker}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.name || "--"}</td>
                      <td className="px-4 py-2.5">
                        {badge ? <span className={cn("text-xs font-medium", badge.className)}>{badge.text}</span>
                               : <span className="text-xs text-muted-foreground/60">--</span>}
                      </td>
                      <td className="px-4 py-2.5"><span className={s.className}>{s.text}</span></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{r.conclusion || "--"}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.status === "completed" && (
                          <button
                            onClick={() => handleViewHistory(r)}
                            className="text-primary hover:underline text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors"
                          >
                            查看
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tab 3: Sector (板块对比)
// ════════════════════════════════════════════════════════════════════════

function SectorTab() {
  const [data, setData] = useState<SectorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTickers, setCustomTickers] = useState("");
  const [currentSector, setCurrentSector] = useState("");
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  async function fetchSector(label: string, tickers: string) {
    setLoading(true);
    setError(null);
    setCurrentSector(label);
    try {
      const resp = await fetch(`${PEG_API}/sector?tickers=${tickers}`);
      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      const json: SectorData = await resp.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCustomSearch() {
    const cleaned = customTickers.replace(/\s+/g, ",").replace(/，/g, ",");
    if (!cleaned) return;
    const parts = cleaned.split(",").filter((t) => t.trim());
    if (parts.length === 1) {
      setLoading(true);
      setError(null);
      setCurrentSector("检测行业中...");
      try {
        const resp = await fetch(`${PEG_API}/sector/detect?ticker=${encodeURIComponent(parts[0].trim())}`);
        const d = await resp.json();
        if (!resp.ok) throw new Error(d.error || "行业检测失败");
        await fetchSector(d.industry, d.tickers.join(","));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "行业检测失败");
        setLoading(false);
      }
      return;
    }
    const codes = parts.filter((t) => /^\d{6}$/.test(t.trim()));
    if (codes.length > 0) {
      fetchSector("自定义板块", codes.join(","));
      return;
    }
    setError("多个输入时请使用6位股票代码，或只输入单个股票代码/名称进行行业检测");
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      if (sortOrder === "asc") { setSortOrder("desc"); }
      else if (sortOrder === "desc") { setSortField(null); setSortOrder(null); }
      else { setSortOrder("asc"); }
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function getSortedSectorStocks(raw: SectorData["stocks"] | undefined): SectorData["stocks"] | undefined {
    if (!raw || !sortField || !sortOrder) return raw;
    const sorted = [...raw];
    const avgPe = data?.stats.avgPe ?? 0;
    sorted.sort((a, b) => {
      let vA: number, vB: number;
      switch (sortField) {
        case "name": vA = a.name.localeCompare(b.name); vB = 0; break;
        case "ticker": vA = a.ticker.localeCompare(b.ticker); vB = 0; break;
        case "price": vA = a.price; vB = b.price; break;
        case "changePct": vA = a.changePct; vB = b.changePct; break;
        case "peTtm": vA = a.peTtm; vB = b.peTtm; break;
        case "pb": vA = a.pb; vB = b.pb; break;
        case "marketCap": vA = a.marketCap; vB = b.marketCap; break;
        case "vsSectorAvg": {
          vA = avgPe > 0 ? (a.peTtm - avgPe) / avgPe : 0;
          vB = avgPe > 0 ? (b.peTtm - avgPe) / avgPe : 0;
          break;
        }
        default: return 0;
      }
      if (sortField === "name" || sortField === "ticker") {
        return sortOrder === "asc" ? vA - vB : vB - vA;
      }
      return sortOrder === "asc" ? vA - vB : vB - vA;
    });
    return sorted;
  }

  const sortedStocks = getSortedSectorStocks(data?.stocks);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={LineChartIcon}
        title="板块 PEG 对比"
        subtitle="输入股票代码或名称，自动查找所属行业，查看板块市值前20名的 PE 分布"
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <input
            type="text"
            value={customTickers}
            onChange={(e) => setCustomTickers(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCustomSearch()}
            placeholder="输入股票代码或名称（自动查行业），或多个代码逗号分隔"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>
        <button
          onClick={handleCustomSearch}
          disabled={loading || !customTickers.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          查询
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-danger/30 bg-danger/5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              {currentSector} — 市值前 {data.stats.count} 名
            </h3>
            <span className="text-xs text-muted-foreground">
              {new Date(data.timestamp).toLocaleTimeString("zh-CN")}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard label="板块平均 PE" value={`${data.stats.avgPe}x`} />
            <StatCard label="板块中位 PE" value={`${data.stats.medianPe}x`} />
            <StatCard label="覆盖股票数" value={`${data.stats.count}`} />
            <StatCard label="总市值" value={`${data.stats.totalMarketCap.toFixed(0)} 亿`} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5">#</th>
                  <SortHeader field="name" label="名称" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="ticker" label="代码" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="price" label="现价" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="changePct" label="涨跌" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="peTtm" label="PE(TTM)" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="pb" label="PB" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="marketCap" label="总市值(亿)" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                  <SortHeader field="vsSectorAvg" label="vs 板块均PE" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {(sortedStocks ?? data.stocks).map((s, i) => {
                  const vsSector = data.stats.avgPe > 0
                    ? ((s.peTtm - data.stats.avgPe) / data.stats.avgPe) * 100 : 0;
                  return (
                    <tr key={s.ticker} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">{s.name}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{s.ticker}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">{s.price.toFixed(2)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-mono", changeColor(s.changePct))}>
                        {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                      </td>
                      <td className={cn("px-3 py-2.5 text-right font-mono", pegColor(s.peTtm))}>
                        {s.peTtm.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">{s.pb.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">{s.marketCap.toFixed(0)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-mono", vsSector > 0 ? "text-danger" : "text-success")}>
                        {vsSector >= 0 ? "+" : ""}{vsSector.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <LineChartIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-base text-muted-foreground">输入代码开始分析</p>
          <p className="text-xs text-muted-foreground/60 mt-2">
            输入任意6位股票代码，自动查找所属行业并展示板块 PE 对比
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tab 4: News (新闻公告)
// ════════════════════════════════════════════════════════════════════════

function NewsTab() {
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${PEG_API}/news`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const json: NewsData = await resp.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const stockNews = data ? sortByTime(data.stock_news) : [];
  const marketNews = data ? sortByTime(data.market_news) : [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Newspaper}
        title="新闻公告"
        subtitle="实时采集个股新闻、市场快讯和公告信息"
      >
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-muted-foreground">
              更新于 {new Date(data.collected_at).toLocaleTimeString("zh-CN")}
            </span>
          )}
          <button
            onClick={fetchNews}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {loading ? "加载中..." : "刷新"}
          </button>
        </div>
      </SectionHeader>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-danger/30 bg-danger/5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-3 py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">正在采集新闻数据，可能需要 10-30 秒...</span>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Stock News */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                个股新闻
                <span className="ml-2 text-muted-foreground font-normal">{stockNews.length}</span>
              </h3>
            </div>
            <div className="divide-y divide-border/60 max-h-[calc(100vh-280px)] overflow-y-auto">
              {stockNews.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无个股新闻</p>
              ) : (
                stockNews.map((item, idx) => <NewsRow key={`stock-${idx}`} item={item} showTicker />)
              )}
            </div>
          </div>

          {/* Market News */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                市场快讯
                <span className="ml-2 text-muted-foreground font-normal">{marketNews.length}</span>
              </h3>
            </div>
            <div className="divide-y divide-border/60 max-h-[calc(100vh-280px)] overflow-y-auto">
              {marketNews.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无市场快讯</p>
              ) : (
                marketNews.map((item, idx) => <NewsRow key={`market-${idx}`} item={item} />)
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
