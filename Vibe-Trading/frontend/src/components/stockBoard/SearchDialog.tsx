import { useState, useCallback } from "react";
import { Search, Plus } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { api, type StockSearchResult } from "@/lib/api";
import { toast } from "sonner";
import type { WatchlistItem } from "@/lib/watchlist";

export interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (item: WatchlistItem) => void;
  existingCodes: Set<string>;
}

export function SearchDialog({
  open, onClose, onAdd, existingCodes,
}: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const res = await api.searchStocks(q);
      setResults(res.results || []);
    } catch {
      toast.error("搜索失败，请稍后重试");
      setResults([]);
    } finally { setSearching(false); }
  }, [query]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doSearch();
    if (e.key === "Escape") { setQuery(""); setResults([]); setSearched(false); onClose(); }
  };
  const resetAndClose = () => { setQuery(""); setResults([]); setSearched(false); onClose(); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={resetAndClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative bg-card border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">添加个股</h3>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border bg-background focus-within:border-primary transition-colors">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              autoFocus value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="代码或名称，如 600519 / 茅台 / AAPL"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <button
            onClick={doSearch} disabled={searching || !query.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {searching ? "搜索中…" : "搜索"}
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {searching ? (
            <div className="space-y-2 py-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
          ) : searched && results.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-6">未找到匹配的股票</p>
          ) : results.map((r) => {
            const exists = existingCodes.has(r.code);
            return (
              <div
                key={`${r.market}:${r.code}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                  exists ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/60 cursor-pointer",
                )}
                onClick={() => {
                  if (exists) return;
                  onAdd({ code: r.code, market: r.market, addedAt: Date.now() });
                  toast.success(`已添加 ${r.name}（${r.code}）`);
                  resetAndClose();
                }}
              >
                <span className={cn(
                  "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                  r.market === "A" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
                )}>{r.market}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{r.code}</p>
                </div>
                {exists ? <span className="text-xs text-muted-foreground">已添加</span> : <Plus className="h-4 w-4 text-muted-foreground" />}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground/60">支持 A 股代码/名称、美股代码（AAPL、MSFT 等）</p>
      </div>
    </div>
  );
}
