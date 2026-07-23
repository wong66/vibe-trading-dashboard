import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, RefreshCw, Plus, X, Search, BarChart3,
  ChevronLeft, ChevronRight,
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
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

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
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* 上部：左侧自选 + 右侧详情 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
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
      </div>

      {/* 底部可收起面板 */}
      <div className={cn(
        "border-t bg-card/30 flex flex-col transition-all duration-300 ease-in-out relative",
        bottomCollapsed ? "h-10" : "h-64",
      )}>
        {/* 折叠/展开按钮 */}
        <button
          onClick={() => setBottomCollapsed(!bottomCollapsed)}
          className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 w-8 h-5 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
          title={bottomCollapsed ? "展开底部面板" : "收起底部面板"}
        >
          {bottomCollapsed
            ? <ChevronLeft className="h-3 w-3 rotate-90" />
            : <ChevronRight className="h-3 w-3 -rotate-90" />
          }
        </button>

        {!bottomCollapsed && (
          <div className="flex-1 overflow-y-auto p-4 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">市场概览</h3>
              <span className="text-[10px] text-muted-foreground/50">实时数据</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {/* 涨跌统计卡片 */}
              {(() => {
                const values = Object.values(quotes).filter(q => q && !q.error);
                const up = values.filter(q => (q.change_pct ?? 0) > 0).length;
                const down = values.filter(q => (q.change_pct ?? 0) < 0).length;
                const flat = values.length - up - down;
                return [
                  { label: "上涨", value: up, color: "text-red-500", bg: "bg-red-50 dark:bg-red-900/20" },
                  { label: "下跌", value: down, color: "text-green-600", bg: "bg-green-50 dark:bg-green-900/20" },
                  { label: "平盘", value: flat, color: "text-muted-foreground", bg: "bg-muted/50" },
                  { label: "自选总数", value: watchlist.length, color: "text-foreground", bg: "bg-card border" },
                ].map(card => (
                  <div key={card.label} className={cn("rounded-lg p-3 flex flex-col gap-1", card.bg)}>
                    <span className="text-[10px] text-muted-foreground">{card.label}</span>
                    <span className={cn("text-lg font-bold tabular-nums", card.color)}>{card.value}</span>
                  </div>
                ));
              })()}
            </div>
            {/* 自选涨跌幅排行 */}
            {Object.values(quotes).filter(q => q && !q.error).length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">涨跌幅排行</p>
                <div className="flex gap-2 flex-wrap">
                  {[...Object.values(quotes)]
                    .filter(q => q && !q.error)
                    .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
                    .slice(0, 8)
                    .map(q => (
                      <div key={q!.code} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border text-[11px]">
                        <span className="font-medium truncate max-w-[52px]" title={q!.name}>{q!.name}</span>
                        <span className={cn("font-mono font-semibold tabular-nums", changeColor(q!.change_pct))}>
                          {q!.change_pct > 0 ? "+" : ""}{q!.change_pct.toFixed(2)}%
                        </span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
            {/* 空态 */}
            {watchlist.length === 0 && (
              <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
                添加自选股后此处显示市场概览
              </div>
            )}
          </div>
        )}
      </div>

      <SearchDialog open={showSearch} onClose={() => setShowSearch(false)} onAdd={handleAdd} existingCodes={existingCodes} />
    </div>
  );
}
