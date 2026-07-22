import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, RefreshCw, Plus, X, Search, BarChart3,
} from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import {
  api, type StockQuote,
} from "@/lib/api";
import { toast } from "sonner";
import { changeColor, fmtPrice } from "@/utils/stockBoard";
import { type WatchlistItem, loadWatchlist, saveWatchlist } from "@/lib/watchlist";
import { SearchDialog } from "@/components/stockBoard/SearchDialog";
import { StockDetailPanel } from "@/components/stockBoard/StockDetailPanel";

// ── Stock row in watchlist ───────────────────────────────────────────
function StockRow({
  item, data, loading, active, onSelect, onRemove,
}: {
  item: WatchlistItem;
  data?: StockQuote;
  loading: boolean;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card">
        <Skeleton className="h-5 w-8 rounded" />
        <Skeleton className="h-4 w-20" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
      </div>
    );
  }
  const hasData = data && !data.error;
  const pct = data?.change_pct ?? 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-card hover:shadow-sm transition-all group cursor-pointer min-w-0",
        active ? "border-primary ring-1 ring-primary/40 bg-primary/5" : "hover:border-border/80",
      )}
      onClick={onSelect}
    >
      <span className={cn(
        "text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 self-start mt-1",
        item.market === "A" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
      )}>{item.market}股</span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium truncate leading-tight" title={hasData ? data!.name : item.code}>
          {hasData ? data!.name : item.code}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground leading-tight">{item.code}</span>
      </div>
      {hasData ? (
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          <span className="text-sm font-semibold tabular-nums leading-tight">{fmtPrice(data!.price)}</span>
          <span className={cn("text-[11px] font-mono font-semibold tabular-nums leading-tight flex items-center gap-0.5", changeColor(pct))}>
            {pct > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : pct < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : null}
            {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        </div>
      ) : data?.error ? (
        <span className="text-xs text-danger/70 shrink-0">获取失败</span>
      ) : <span className="text-xs text-muted-foreground shrink-0">—</span>}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="p-1 text-muted-foreground hover:text-danger rounded opacity-0 group-hover:opacity-100 transition-all shrink-0 self-start mt-0.5"
        title="移除"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Stock detail panel (8 sections) ──────────────────────────────────

// ── Page ─────────────────────────────────────────────────────────────

export function StockBoard() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => loadWatchlist());
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    const list = loadWatchlist();
    return list.length > 0 ? list[0].code : null;
  });

  const codesA = watchlist.filter(w => w.market === "A").map(w => w.code);
  const codesUS = watchlist.filter(w => w.market === "US").map(w => w.code);
  const existingCodes = new Set(watchlist.map(w => w.code));

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const res = await api.getMarketData({ stocks_a: codesA, stocks_us: codesUS });
      setQuotes({ ...res.stocks_a, ...res.stocks_us });
    } catch (e) {
      setError(e instanceof Error ? e.message : "行情数据获取失败");
    } finally { setLoading(false); setRefreshing(false); }
  }, [codesA.join(","), codesUS.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // 单一 effect：初始加载 + 自选列表变更时刷新，消除重复请求
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      // 首次挂载：只请求一次
      mountedRef.current = true;
      fetchData();
    } else {
      // 自选列表变化（增删股票）→ 刷新
      fetchData(true);
    }
  }, [codesA.join(","), codesUS.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = (item: WatchlistItem) => {
    if (existingCodes.has(item.code)) { toast.error("该股票已在看板中"); return; }
    const next = [...watchlist, item];
    setWatchlist(next); saveWatchlist(next);
    setActiveCode(item.code);
    fetchData(true);
  };
  const handleRemove = (code: string) => {
    const next = watchlist.filter(w => w.code !== code);
    setWatchlist(next); saveWatchlist(next);
    if (activeCode === code) setActiveCode(next[0]?.code ?? null);
  };

  const activeItem = watchlist.find(w => w.code === activeCode) ?? null;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left watchlist */}
      <aside className="w-56 border-r bg-card/30 flex flex-col shrink-0">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">个股看板</h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">{watchlist.length} 只自选股</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchData(true)} disabled={refreshing}
              className="p-1.5 rounded-md border bg-card hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
              title="刷新行情"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
        </div>

        {error && (
          <div className="m-3 text-xs text-danger border border-danger/30 rounded p-2 bg-danger/5">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {watchlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12 px-4">
              <Search className="h-10 w-10 opacity-30 mb-3" />
              <p className="text-sm font-medium mb-1">暂无自选股</p>
              <p className="text-xs opacity-60 mb-4 text-center">点击「添加」开始构建你的看板</p>
              <button
                onClick={() => setShowSearch(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" />添加第一只股票
              </button>
            </div>
          ) : (
            <>
              {watchlist.filter(w => w.market === "A").length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-1">
                    A 股 ({watchlist.filter(w => w.market === "A").length})
                  </p>
                  {watchlist.filter(w => w.market === "A").map(item => (
                    <StockRow
                      key={item.code} item={item} data={quotes[item.code]} loading={loading}
                      active={activeCode === item.code} onSelect={() => setActiveCode(item.code)} onRemove={() => handleRemove(item.code)}
                    />
                  ))}
                </div>
              )}
              {watchlist.filter(w => w.market === "US").length > 0 && (
                <div className="space-y-1.5 mt-3">
                  <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-1">
                    美股 ({watchlist.filter(w => w.market === "US").length})
                  </p>
                  {watchlist.filter(w => w.market === "US").map(item => (
                    <StockRow
                      key={item.code} item={item} data={quotes[item.code]} loading={loading}
                      active={activeCode === item.code} onSelect={() => setActiveCode(item.code)} onRemove={() => handleRemove(item.code)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Right detail */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {activeItem ? (
          <div>
            <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b px-5 py-3 flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    activeItem.market === "A" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
                  )}>{activeItem.market}股</span>
                  <span className="text-sm font-mono text-muted-foreground">{activeItem.code}</span>
                  <h2 className="text-base font-semibold">{quotes[activeItem.code]?.name || activeItem.code}</h2>
                </div>
                {quotes[activeItem.code] && !quotes[activeItem.code].error && (
                  <p className="text-xs text-muted-foreground/70 mt-0.5">
                    现价 <span className="font-semibold text-foreground">{fmtPrice(quotes[activeItem.code].price)}</span>
                    <span className={cn("ml-2 font-mono", changeColor(quotes[activeItem.code].change_pct))}>
                      {quotes[activeItem.code].change_pct > 0 ? "+" : ""}{quotes[activeItem.code].change_pct.toFixed(2)}%
                    </span>
                  </p>
                )}
              </div>
            </div>
            <StockDetailPanel item={activeItem} quote={quotes[activeItem.code] ?? null} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <BarChart3 className="h-16 w-16 opacity-20 mb-3" />
            <p className="text-sm">从左侧选择一只股票开始分析</p>
          </div>
        )}
      </main>

      <SearchDialog open={showSearch} onClose={() => setShowSearch(false)} onAdd={handleAdd} existingCodes={existingCodes} />
    </div>
  );
}
