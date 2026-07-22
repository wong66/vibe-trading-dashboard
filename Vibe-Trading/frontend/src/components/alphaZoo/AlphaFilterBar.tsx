import { Search, ArrowLeftRight, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { ZOO_CARDS, UNIVERSE_OPTIONS } from "@/lib/alphaZooHelpers";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  zooFilter: string;
  onZooFilterChange: (value: string) => void;
  themeFilter: string;
  onThemeFilterChange: (value: string) => void;
  universeFilter: string;
  onUniverseFilterChange: (value: string) => void;
  themeOptions: string[];
  selectedCount: number;
  compareHref: string;
}

export function AlphaFilterBar({
  search,
  onSearchChange,
  zooFilter,
  onZooFilterChange,
  themeFilter,
  onThemeFilterChange,
  universeFilter,
  onUniverseFilterChange,
  themeOptions,
  selectedCount,
  compareHref,
}: Props) {
  return (
    <div className="flex flex-col md:flex-row md:items-end gap-3 border rounded-xl p-4 bg-card">
      <div className="flex-1 min-w-0">
        <label htmlFor="alpha-search" className="text-xs text-muted-foreground block mb-1">
          Search
        </label>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="alpha-search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter by id or nickname…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      <div className="md:w-40">
        <label htmlFor="alpha-zoo-filter" className="text-xs text-muted-foreground block mb-1">Zoo</label>
        <select
          id="alpha-zoo-filter"
          value={zooFilter}
          onChange={(e) => onZooFilterChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">全部因子库</option>
          {ZOO_CARDS.map((z) => (
            <option key={z.id} value={z.id}>
              {z.title}
            </option>
          ))}
        </select>
      </div>
      <div className="md:w-40">
        <label htmlFor="alpha-theme-filter" className="text-xs text-muted-foreground block mb-1">
          Theme
        </label>
        <select
          id="alpha-theme-filter"
          value={themeFilter}
          onChange={(e) => onThemeFilterChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">全部主题</option>
          {themeOptions.map((tname) => (
            <option key={tname} value={tname}>
              {tname}
            </option>
          ))}
        </select>
      </div>
      <div className="md:w-44">
        <label htmlFor="alpha-universe-filter" className="text-xs text-muted-foreground block mb-1">
          Universe
        </label>
        <select
          id="alpha-universe-filter"
          value={universeFilter}
          onChange={(e) => onUniverseFilterChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">全部范围</option>
          {UNIVERSE_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <Link
        to={compareHref}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted hover:text-foreground transition"
        title="勾选 2+ 个因子，然后逐一对比"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Compare
        {selectedCount >= 2 ? ` (${selectedCount})` : ""}
      </Link>
      <Link
        to="/alpha-zoo/bench"
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Run benchmark
      </Link>
    </div>
  );
}
