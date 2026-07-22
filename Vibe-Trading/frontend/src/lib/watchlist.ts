const STORAGE_KEY = "vibe_trading_stock_board_watchlist";

export interface WatchlistItem {
  code: string;
  market: "A" | "US";
  addedAt: number;
}

export function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveWatchlist(items: WatchlistItem[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* noop */ }
}
