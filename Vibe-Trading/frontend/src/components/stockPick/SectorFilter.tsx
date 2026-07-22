import { useState, useEffect, useRef } from "react";
import { Search, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOT_SECTORS } from "@/lib/stockPickData";

export function SectorFilter({
  sector, onSectorChange, loading,
}: {
  sector: string;
  onSectorChange: (s: string) => void;
  loading: boolean;
}) {
  const [input, setInput] = useState(sector);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setInput(sector); }, [sector]);

  // close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const confirm = (val: string) => {
    setInput(val);
    setShowDropdown(false);
    if (val.trim()) onSectorChange(val.trim());
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      {/* Input row */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(input); }}
            placeholder="请输入行业 / 概念 / 细分赛道，如：半导体材料、HBM、先进封装"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border bg-card text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
          {input && (
            <button
              onClick={() => { setInput(""); onSectorChange(""); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => confirm(input)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      {/* Dropdown suggestions */}
      {showDropdown && input && (
        <div className="absolute z-50 mt-1 w-full max-w-xl bg-card border rounded-lg shadow-lg py-1 max-h-48 overflow-auto">
          {HOT_SECTORS.filter(s => s.includes(input)).map(s => (
            <button
              key={s}
              onClick={() => confirm(s)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              {s}
            </button>
          ))}
          {input.length >= 2 && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t">
              按 Enter 搜索「{input}」
            </div>
          )}
        </div>
      )}

      {/* Hot sector tags */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">热门板块：</span>
        {HOT_SECTORS.map(s => (
          <button
            key={s}
            onClick={() => confirm(s)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              sector === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
