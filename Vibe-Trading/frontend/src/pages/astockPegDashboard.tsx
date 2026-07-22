import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Plus, X, Search, AlertCircle, Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PEG_API, changeColor, pegColor, SortHeader, SectionHeader } from "@/lib/astockPegHelpers";
import type { QuotesData, LiveStock, SortField, SortOrder } from "@/lib/astockPegHelpers";

export function DashboardTab() {
  const [data, setData] = useState<QuotesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${PEG_API}/quotes`);
      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      const json: QuotesData = await resp.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAdd() {
    if (!ticker.trim()) return;
    setAdding(true);
    try {
      const resp = await fetch(`${PEG_API}/stocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.trim() }),
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error || "添加失败");
      }
      setTicker("");
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(t: string) {
    setDeleting(t);
    try {
      const resp = await fetch(`${PEG_API}/stocks/${t}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("删除失败");
      await refresh();
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleting(null);
    }
  }

  async function handleAnalyze(t: string) {
    setAnalyzing(t);
    try {
      const resp = await fetch(`${PEG_API}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const body = await resp.json();
      if (!resp.ok && resp.status !== 409) throw new Error(body.error || "分析提交失败");
      toast.success("已提交 PEG 分析，请切换到「PEG 分析」标签查看");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "分析提交失败");
    } finally {
      setAnalyzing(null);
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      if (sortOrder === "asc") { setSortOrder("desc"); }
      else if (sortOrder === "desc") { setSortField(null); setSortOrder(null); }
      else { setSortOrder("asc"); }
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function getSortedWatchlist(raw: LiveStock[] | undefined): LiveStock[] | undefined {
    if (!raw || !sortField || !sortOrder) return raw;
    return [...raw].sort((a, b) => {
      let va: string | number | null | undefined;
      let vb: string | number | null | undefined;
      switch (sortField) {
        case "name": va = a.name; vb = b.name; break;
        case "ticker": va = a.ticker; vb = b.ticker; break;
        case "price": va = a.price; vb = b.price; break;
        case "changePct": va = a.changePct; vb = b.changePct; break;
        case "peTtm": va = a.peTtm; vb = b.peTtm; break;
        case "pb": va = a.pb; vb = b.pb; break;
        case "marketCap": va = a.marketCap; vb = b.marketCap; break;
        case "peg": va = a.peg; vb = b.peg; break;
        default: return 0;
      }
      if (va == null) va = Infinity;
      if (vb == null) vb = Infinity;
      if (typeof va === "string" && typeof vb === "string") {
        return sortOrder === "asc" ? va.localeCompare(vb, "zh-CN") : vb.localeCompare(va, "zh-CN");
      }
      const na = Number(va);
      const nb = Number(vb);
      return sortOrder === "asc" ? na - nb : nb - na;
    });
  }

  const sortedWatchlist = getSortedWatchlist(data?.watchlist);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={BarChart3}
        title="自选股行情"
        subtitle="添加股票代码监控实时行情，点击「分析」进入 AI PEG 估值分析"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {loading ? "刷新中..." : "刷新行情"}
          </button>
          {data && (
            <span className="text-xs text-muted-foreground">
              {new Date(data.timestamp).toLocaleTimeString("zh-CN")}
            </span>
          )}
        </div>
      </SectionHeader>

      {/* Add stock */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="代码或名称，如 600519 / 贵州茅台"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !ticker.trim()}
          className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          添加
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-danger/30 bg-danger/5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <SortHeader field="name" label="名称" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="ticker" label="代码" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="price" label="现价" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="changePct" label="涨跌" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="peTtm" label="PE(TTM)" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="pb" label="PB" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="marketCap" label="市值(亿)" align="right" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <SortHeader field="peg" label="PEG" align="center" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
                <th className="text-center font-medium text-muted-foreground px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">加载中...</td></tr>
              ) : sortedWatchlist?.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">暂无自选股票 — 输入代码或股票名称添加</td></tr>
              ) : (
                sortedWatchlist?.map((s) => (
                  <tr key={s.ticker} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{s.ticker}</td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">{s.price?.toFixed(2) ?? "--"}</td>
                    <td className={cn("px-4 py-3 text-right font-mono", changeColor(s.changePct))}>
                      {s.changePct != null ? `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%` : "--"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">{s.peTtm?.toFixed(1) ?? "--"}</td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">{s.pb?.toFixed(2) ?? "--"}</td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">{s.marketCap?.toFixed(0) ?? "--"}</td>
                    <td className={cn("px-4 py-3 text-center font-mono", pegColor(s.peg))}>
                      {s.peg > 0 ? s.peg.toFixed(2) : "--"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleAnalyze(s.ticker)}
                          disabled={analyzing === s.ticker}
                          className="text-primary hover:text-primary/80 text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          {analyzing === s.ticker ? "提交中..." : "分析"}
                        </button>
                        <button
                          onClick={() => handleDelete(s.ticker)}
                          disabled={deleting === s.ticker}
                          className="text-muted-foreground hover:text-danger text-xs px-1 transition-colors"
                        >
                          {deleting === s.ticker ? "..." : <X className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
