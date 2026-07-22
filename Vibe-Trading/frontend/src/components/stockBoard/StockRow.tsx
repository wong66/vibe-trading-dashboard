import { TrendingUp, TrendingDown, X } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import type { StockQuote } from "@/lib/api";
import { changeColor, fmtPrice } from "@/utils/stockBoard";
import type { WatchlistItem } from "@/lib/watchlist";

export interface StockRowProps {
  item: WatchlistItem;
  data?: StockQuote;
  loading: boolean;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function StockRow({
  item, data, loading, active, onSelect, onRemove,
}: StockRowProps) {
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
