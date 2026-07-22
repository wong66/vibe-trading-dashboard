import { useState, useEffect, useCallback, useRef } from "react";
import { Target, RefreshCw, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── types ───────────────────────────────────────────────────────────────

interface AmbushItem {
  code: string;        // 腾讯格式代码，如 sh688017
  name?: string;       // 自定义名称，留空时自动取行情名
  targetPrice: number; // 埋伏位（目标买入价）
  note?: string;       // 备注
}

interface TencentQuote {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  source: "tencent";
  error?: string;
}

// ── constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "vibe_trading_ambush_list";
const REFRESH_INTERVAL_MS = 30_000; // 30s 自动刷新

// ── localStorage helpers ───────────────────────────────────────────────

function loadAmbushList(): AmbushItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAmbushList(list: AmbushItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* noop — private browsing may block localStorage */
  }
}

// ── colour helpers ─────────────────────────────────────────────────────

/** Chinese convention: red = up, green = down */
function changeColor(v: number): string {
  if (v > 0) return "text-danger";
  if (v < 0) return "text-success";
  return "text-muted-foreground";
}

function changeSign(v: number): string {
  if (v > 0) return "+";
  return "";
}

// ── helpers ───────────────────────────────────────────────────────────

/** Normalize code to Tencent format: sh/sz prefix */
function normalizeCode(code: string): string {
  const trimmed = code.trim().toLowerCase();
  // Already has prefix
  if (trimmed.startsWith("sh") || trimmed.startsWith("sz") || trimmed.startsWith("bj")) {
    return trimmed;
  }
  // 6-digit code: infer exchange
  if (/^\d{6}$/.test(trimmed)) {
    if (trimmed.startsWith("6") || trimmed.startsWith("9") || trimmed.startsWith("5")) {
      return `sh${trimmed}`;
    }
    return `sz${trimmed}`;
  }
  // 8-digit (北交所)
  if (/^\d{8}$/.test(trimmed)) {
    return `bj${trimmed}`;
  }
  return trimmed;
}

/** Add market prefix for Tencent API */
function addPrefix(code: string): string {
  if (code.startsWith("sh") || code.startsWith("sz") || code.startsWith("bj")) {
    return code;
  }
  if (code.startsWith("6") || code.startsWith("9") || code.startsWith("5")) {
    return `sh${code}`;
  }
  if (code.startsWith("8")) {
    return `bj${code}`;
  }
  return `sz${code}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Tencent API (a-stock-data skill §1.2) ───────────────────────────────

/**
 * 直接调用腾讯财经 API 获取实时行情。
 * 数据来自 a-stock-data skill，不经过 Vibe-Trading 后端。
 * GBK 编码，~ 分隔。
 */
async function fetchTencentQuotes(codes: string[]): Promise<Record<string, TencentQuote>> {
  if (codes.length === 0) return {};

  const prefixed = codes.map(addPrefix);
  const url = `/tencent-quote?q=${prefixed.join(",")}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) {
    throw new Error(`腾讯行情请求失败: HTTP ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder("gbk");
  const text = decoder.decode(buf);

  const result: Record<string, TencentQuote> = {};

  for (const line of text.split(";")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=") || !trimmed.includes('"')) continue;

    // 提取 key: v_sh688017 → sh688017
    const keyPart = trimmed.split("=")[0];
    const tencentSym = keyPart.split("_").pop() || "";

    // 提取引号内数据
    const quoteMatch = trimmed.match(/"([^"]*)"/);
    if (!quoteMatch) continue;
    const vals = quoteMatch[1].split("~");
    if (vals.length < 33) continue;

    const price = parseFloat(vals[3]) || 0;
    const changePct = parseFloat(vals[32]) || 0;

    result[tencentSym] = {
      code: tencentSym,
      name: vals[1] || tencentSym,
      price,
      change_pct: changePct,
      source: "tencent",
    };
  }

  // 标记未返回的 code
  for (const code of codes) {
    if (!result[code]) {
      result[code] = {
        code,
        name: code,
        price: 0,
        change_pct: 0,
        source: "tencent",
        error: "数据获取失败",
      };
    }
  }

  return result;
}

// ── page component ─────────────────────────────────────────────────────

export function OpportunityList() {
  const [ambushList, setAmbushList] = useState<AmbushItem[]>(() => loadAmbushList());
  const [quoteData, setQuoteData] = useState<Record<string, TencentQuote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [codeInput, setCodeInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── fetch data ───────────────────────────────────────────────────────

  const fetchData = useCallback(async (isRefresh = false) => {
    if (ambushList.length === 0) {
      setLoading(false);
      setRefreshing(false);
      setLastRefresh(Date.now());
      return;
    }
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const codes = ambushList.map((a) => a.code);
      const res = await fetchTencentQuotes(codes);
      setQuoteData(res);
      setLastRefresh(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "行情数据获取失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ambushList]);

  // initial load
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refresh when ambushList changes (after add/remove)
  useEffect(() => {
    if (!loading) {
      fetchData(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambushList.length]);

  // 30s auto-refresh（仅持仓非空时轮询，空列表不浪费网络请求）
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (ambushList.length === 0) return;  // 无持仓时不建立定时器
    timerRef.current = setInterval(() => {
      fetchData(true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, ambushList.length]);  // 依赖 ambushList.length：空时停轮询，有数据时启动

  // ── actions ──────────────────────────────────────────────────────────

  const handleAdd = () => {
    const code = normalizeCode(codeInput);
    if (!code) {
      toast.error("请输入股票代码");
      return;
    }
    const price = parseFloat(priceInput);
    if (!priceInput || isNaN(price) || price <= 0) {
      toast.error("请输入有效的目标买入价");
      return;
    }

    const name = nameInput.trim() || undefined;
    const note = noteInput.trim() || undefined;

    const existingIndex = ambushList.findIndex((a) => a.code === code);
    let next: AmbushItem[];
    if (existingIndex >= 0) {
      // 覆盖同名代码
      next = [...ambushList];
      next[existingIndex] = { code, name, targetPrice: price, note };
      toast.success("已更新埋伏位");
    } else {
      next = [...ambushList, { code, name, targetPrice: price, note }];
      toast.success("已添加埋伏位");
    }
    setAmbushList(next);
    saveAmbushList(next);

    // Reset form
    setCodeInput("");
    setNameInput("");
    setPriceInput("");
    setNoteInput("");
  };

  const handleRemove = (code: string) => {
    const next = ambushList.filter((a) => a.code !== code);
    setAmbushList(next);
    saveAmbushList(next);
    // 同步清除 quoteData 中该 code 的数据
    setQuoteData((prev) => {
      const copy = { ...prev };
      delete copy[code];
      return copy;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  // ── render helpers ───────────────────────────────────────────────────

  const renderTable = () => {
    if (ambushList.length === 0) {
      return (
        <div className="border rounded-xl p-8 bg-card">
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              还没有埋伏位。用下方表单添加你想"等回调"的标的 + 目标买入价。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="border rounded-xl bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">标的</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">现价</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">今日</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">埋伏位</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">距买点</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">备注</th>
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {ambushList.map((item) => {
                const quote = quoteData[item.code];
                const price = quote?.price ?? 0;
                const changePct = quote?.change_pct ?? 0;
                const target = item.targetPrice;
                const gap = target > 0 ? ((price - target) / target) * 100 : 0;
                const isTriggered = price > 0 && price <= target;
                const isLoading = loading && !quote;

                const displayName = item.name || (quote?.name || item.code);

                return (
                  <tr
                    key={item.code}
                    className={cn(
                      "border-b last:border-b-0 transition-colors",
                      isTriggered
                        ? "bg-danger/5"
                        : "hover:bg-muted/30"
                    )}
                  >
                    {/* 标的 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
                          {item.code}
                        </span>
                        <span className="truncate max-w-[8rem]">{displayName}</span>
                      </div>
                    </td>

                    {/* 现价 */}
                    <td className="px-4 py-3 text-right">
                      {isLoading ? (
                        <Skeleton className="h-4 w-16 ml-auto" />
                      ) : quote?.error ? (
                        <span className="text-xs text-danger/70">—</span>
                      ) : price > 0 ? (
                        <span className="font-mono tabular-nums">
                          {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 今日 */}
                    <td className="px-4 py-3 text-right">
                      {isLoading ? (
                        <Skeleton className="h-4 w-14 ml-auto" />
                      ) : quote?.error ? (
                        <span className="text-xs text-danger/70">失败</span>
                      ) : price > 0 ? (
                        <span className={cn("flex items-center justify-end gap-1 font-mono tabular-nums", changeColor(changePct))}>
                          {changePct > 0 ? <TrendingUp className="h-3 w-3" /> : changePct < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                          {changeSign(changePct)}{changePct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 埋伏位 */}
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                      {target.toFixed(2)}
                    </td>

                    {/* 距买点 */}
                    <td className="px-4 py-3 text-right">
                      {isLoading || price <= 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : isTriggered ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-danger text-white text-xs font-medium">
                          <Target className="h-3 w-3" />
                          到位
                        </span>
                      ) : (
                        <span className={cn("font-mono tabular-nums text-xs", gap > 0 ? "text-success" : "text-muted-foreground")}>
                          +{gap.toFixed(2)}%
                        </span>
                      )}
                    </td>

                    {/* 备注 */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground truncate max-w-[10rem] block">
                        {item.note || "—"}
                      </span>
                    </td>

                    {/* 删除 */}
                    <td className="px-2 py-3">
                      <button
                        onClick={() => handleRemove(item.code)}
                        className="p-1 text-muted-foreground hover:text-danger rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            机会清单 · 埋伏位
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            给关注标的设目标买入价，系统盯现价距埋伏位还差多少 · 到位高亮 · 30s 自动刷新
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            数据来源：a-stock-data 腾讯财经 API (qt.gtimg.cn) · 直连 · 不经过后端
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing || ambushList.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-card hover:bg-muted transition-colors text-xs disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          刷新
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-danger border border-danger/30 rounded-lg p-3 bg-danger/5">
          {error}
        </div>
      )}

      {/* Table */}
      {renderTable()}

      {/* Add form */}
      <div className="border rounded-xl p-4 bg-card space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-primary" />
          加一个埋伏位
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="代码 sh688017"
            className="px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-primary placeholder:text-muted-foreground/60"
          />
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="名称（可留空）"
            className="px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-primary placeholder:text-muted-foreground/60"
          />
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="埋伏位（目标买入价）"
            type="number"
            step="0.01"
            className="px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-primary placeholder:text-muted-foreground/60"
          />
          <input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="备注（为什么这个位）"
            className="px-3 py-2 rounded-md border bg-background text-sm outline-none focus:border-primary placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground/70">
            代码用腾讯前缀 sh/sz（如 sh688017、sz300308）。同代码覆盖。名称留空会自动取行情名。
          </p>
          <button
            onClick={handleAdd}
            className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            添加
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground/60 pt-2">
        {lastRefresh > 0 && (
          <span>
            刷新：{formatDateTime(lastRefresh)} · 埋伏位由你自己设，实时价来自 a-stock-data 腾讯公开行情，非投资建议。把"等机会"变成有纪律的埋伏。
          </span>
        )}
      </div>
    </div>
  );
}
