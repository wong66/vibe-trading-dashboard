/**
 * 因子库 — browse / detail / bench views.
 *
 * Routing model: a single page component, three URL shapes:
 *   /alpha-zoo                 → browse view
 *   /alpha-zoo/bench           → bench runner
 *   /alpha-zoo/:alphaId        → alpha detail
 *
 * The bench view uses a raw EventSource rather than the shared `useSSE` hook
 * because that hook hard-codes the agent's known event types (text_delta,
 * tool_call, …) and would silently drop the alpha bench events
 * (`progress`, `result`, `done`, `error`). The swarm page uses the same
 * raw-EventSource pattern (frontend/src/pages/Agent.tsx).
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Layers, ArrowLeft, Play, ArrowLeftRight, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type AlphaSummary,
  type AlphaDetailResponse,
  type AlphaBenchResult,
  type AlphaCompareResult,
} from "@/lib/api";
import {
  PAGE_SIZE,
  metaString,
  parseAlphaIds,
  MetaRow,
  ProgressPanel,
  type BenchStatus,
  type BenchProgress,
} from "@/lib/alphaZooHelpers";
import { AlphaZooCardGrid } from "@/components/alphaZoo/AlphaZooCardGrid";
import { AlphaFilterBar } from "@/components/alphaZoo/AlphaFilterBar";
import { AlphaTable } from "@/components/alphaZoo/AlphaTable";
import { BenchForm } from "@/components/alphaZoo/BenchForm";
import { ResultPanel } from "@/components/alphaZoo/ResultPanel";
import { CompareForm } from "@/components/alphaZoo/CompareForm";
import { CompareResultPanel } from "@/components/alphaZoo/CompareResultPanel";

/* ---------- Page entry ---------- */

export function AlphaZoo() {
  const params = useParams<{ alphaId?: string }>();
  const { pathname } = useLocation();

  // Internal view selection
  if (pathname === "/alpha-zoo/bench") {
    return <BenchView />;
  }
  if (pathname === "/alpha-zoo/compare") {
    return <CompareView />;
  }
  if (params.alphaId) {
    return <DetailView alphaId={params.alphaId} />;
  }
  return <BrowseView />;
}

/* ---------- Browse view ---------- */

function BrowseView() {
  const [alphas, setAlphas] = useState<AlphaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [zooFilter, setZooFilter] = useState<string>("");
  const [themeFilter, setThemeFilter] = useState<string>("");
  const [universeFilter, setUniverseFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [total, setTotal] = useState<number>(0);
  // Alphas ticked for a head-to-head compare; handed to CompareView via the URL.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const compareHref =
    selected.size >= 2
      ? `/alpha-zoo/compare?ids=${[...selected].map(encodeURIComponent).join(",")}`
      : "/alpha-zoo/compare";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .listAlphas({
        zoo: zooFilter || undefined,
        theme: themeFilter || undefined,
        universe: universeFilter || undefined,
        limit: 1000,
      })
      .then((res) => {
        if (!alive) return;
        setAlphas(res.alphas);
        setTotal(res.total);
        setVisibleCount(PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : "Failed to load alphas";
        toast.error(msg);
        setAlphas([]);
        setTotal(0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [zooFilter, themeFilter, universeFilter]);

  const themeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of alphas) for (const t of a.theme || []) set.add(t);
    return Array.from(set).sort();
  }, [alphas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return alphas;
    return alphas.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        (a.nickname || "").toLowerCase().includes(q),
    );
  }, [alphas, search]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8">
      {/* Hero */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" /> 因子库
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {total > 0 ? total : 452} pre-built quant alphas across 4 zoos
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Browse formula-driven cross-sectional signals from Qlib, the
          Kakushadze 101 set, 国泰君安 191, and the academic anomaly literature.
          Click any alpha to read its formula and source code, or run a bench
          to score the whole zoo on a universe and period.
        </p>
      </div>

      {/* Zoo cards */}
      <AlphaZooCardGrid zooFilter={zooFilter} onSelectZoo={(id) => setZooFilter(id)} />

      {/* Filter bar */}
      <AlphaFilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setVisibleCount(PAGE_SIZE);
        }}
        zooFilter={zooFilter}
        onZooFilterChange={setZooFilter}
        themeFilter={themeFilter}
        onThemeFilterChange={setThemeFilter}
        universeFilter={universeFilter}
        onUniverseFilterChange={setUniverseFilter}
        themeOptions={themeOptions}
        selectedCount={selected.size}
        compareHref={compareHref}
      />

      {/* Table */}
      <AlphaTable
        loading={loading}
        visible={visible}
        filteredLength={filtered.length}
        selected={selected}
        onToggleSelected={toggleSelected}
        onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
      />
    </div>
  );
}

/* ---------- Detail view ---------- */

interface DetailProps {
  alphaId: string;
}

function DetailView({ alphaId }: DetailProps) {
  const [detail, setDetail] = useState<AlphaDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getAlpha(alphaId)
      .then((res) => {
        if (alive) setDetail(res);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : "Failed to load alpha";
        setError(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [alphaId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> Loading {alphaId}…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-4">
        <Link to="/alpha-zoo" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to 因子库
        </Link>
        <div className="border rounded-xl p-6 bg-card">
          <h2 className="font-semibold text-sm mb-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" /> 无法加载因子
          </h2>
          <p className="text-sm text-muted-foreground">{error || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const a = detail.alpha;
  const meta = a.meta || {};
  const formulaLatex = (meta["formula_latex"] as string | undefined) || "";
  const nickname = (meta["nickname"] as string | undefined) || "";
  const firstUniverse = ((meta["universe"] as string[] | undefined) || [])[0] || "";

  // Keep period in sync with the BenchView form default so the prefilled
  // form values match what users see if they click "Run bench" from here.
  const benchHref = firstUniverse
    ? `/alpha-zoo/bench?zoo=${encodeURIComponent(a.zoo)}&universe=${encodeURIComponent(firstUniverse)}&period=2020-2025`
    : `/alpha-zoo/bench?zoo=${encodeURIComponent(a.zoo)}&period=2020-2025`;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link
          to="/alpha-zoo"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to 因子库
        </Link>
        <button
          type="button"
          onClick={() => navigate(benchHref)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> Run benchmark
        </button>
      </div>

      {/* Title */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-mono text-xl md:text-2xl font-bold tracking-tight">
            {a.id}
          </h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {a.zoo}
          </span>
        </div>
        {nickname && (
          <p className="text-sm text-muted-foreground">{nickname}</p>
        )}
      </div>

      {/* Formula */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Formula</h2>
        <pre className="border rounded-xl bg-muted/30 p-4 overflow-x-auto text-xs leading-relaxed">
          <code>{formulaLatex || "（未提供公式）"}</code>
        </pre>
      </section>

      {/* Metadata */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Metadata</h2>
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              <MetaRow label="Theme" value={metaString(meta, "theme")} />
              <MetaRow label="Universe" value={metaString(meta, "universe")} />
              <MetaRow label="Frequency" value={metaString(meta, "frequency")} />
              <MetaRow label="Decay horizon" value={metaString(meta, "decay_horizon")} />
              <MetaRow label="Min warm-up bars" value={metaString(meta, "min_warmup_bars")} />
              <MetaRow label="Requires sector" value={metaString(meta, "requires_sector")} />
              <MetaRow label="Module path" value={a.module_path || "—"} />
              <MetaRow label="说明" value={metaString(meta, "notes")} last />
            </tbody>
          </table>
        </div>
      </section>

      {/* Source code */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Source code</h2>
        <details className="border rounded-xl bg-card group">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/40 select-none">
            查看源码（{(detail.source_code || "").split("\n").length} 行）
          </summary>
          <pre className="border-t bg-muted/30 p-4 overflow-x-auto text-xs leading-relaxed">
            <code>{detail.source_code || "（无源码）"}</code>
          </pre>
        </details>
      </section>
    </div>
  );
}


/* ---------- Bench view ---------- */


function BenchView() {
  // Read prefill from query string (set by Detail "Run bench" button).
  const { search: locSearch } = useLocation();
  const initial = useMemo(() => {
    const q = new URLSearchParams(locSearch);
    return {
      zoo: q.get("zoo") || "alpha101",
      universe: q.get("universe") || "csi300",
      period: q.get("period") || "2020-2025",
      top: Number(q.get("top") || "20"),
    };
  }, [locSearch]);

  const [zoo, setZoo] = useState(initial.zoo);
  const [universe, setUniverse] = useState(initial.universe);
  const [period, setPeriod] = useState(initial.period);
  const [top, setTop] = useState<number>(initial.top);

  const [status, setStatus] = useState<BenchStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BenchProgress | null>(null);
  const [result, setResult] = useState<AlphaBenchResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  // Track terminal `done` so the synthetic EventSource `error` fired on
  // close doesn't surface as a spurious toast (race between done + error).
  const doneRef = useRef(false);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const startBench = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "streaming") return;
    setStatus("submitting");
    setProgress(null);
    setResult(null);
    setFormError(null);
    doneRef.current = false;
    sourceRef.current?.close();
    const safeTop = Number.isFinite(top) && top > 0 ? top : 20;
    try {
      const res = await api.createAlphaBench({
        zoo,
        universe,
        period,
        top: safeTop,
      });
      setJobId(res.job_id);
      attachStream(res.job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start bench";
      // BTC-USDT is single-asset — surface inline rather than as a toast,
      // because the form is the action context and the message includes a
      // concrete suggestion for the user's next step.
      if (msg.toLowerCase().includes("single-asset")) {
        setFormError(
          `${msg} Try \`sp500\` or \`csi300\` for a meaningful cross-sectional IC.`,
        );
      } else {
        toast.error(msg);
      }
      setStatus("error");
    }
  };

  const attachStream = (newJobId: string) => {
    setStatus("streaming");
    const url = api.alphaBenchStreamUrl(newJobId);
    const source = new EventSource(url);
    sourceRef.current = source;

    source.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as BenchProgress;
        setProgress(data);
      } catch {
        /* ignore */
      }
    });

    source.addEventListener("result", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as AlphaBenchResult;
        setResult(data);
      } catch {
        /* ignore */
      }
    });

    source.addEventListener("done", () => {
      doneRef.current = true;
      setStatus("done");
      source.close();
      sourceRef.current = null;
    });

    source.addEventListener("error", (e) => {
      // EventSource raises a synthetic error on every disconnect, including
      // the normal close that follows our `done` event. The ref check is
      // synchronous (state updates from `done` would be batched and not
      // visible here yet), so it's the only reliable race guard.
      if (doneRef.current) {
        source.close();
        sourceRef.current = null;
        return;
      }
      let msg = "基准测试流错误";
      try {
        const data = JSON.parse((e as MessageEvent).data || "{}");
        if (typeof data.message === "string") msg = data.message;
      } catch {
        /* network-level error, no payload */
      }
      toast.error(msg);
      setStatus("error");
      source.close();
      sourceRef.current = null;
    });
  };

  const busy = status === "submitting" || status === "streaming";

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <Link
        to="/alpha-zoo"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to 因子库
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> 基准测试
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          对因子库在指定范围上评分
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Computes IC / IR for every alpha in the selected zoo over the chosen
          universe and period, then bucketizes them as alive / reversed / dead.
        </p>
      </div>

      {/* Form */}
      <BenchForm
        zoo={zoo}
        onZooChange={setZoo}
        universe={universe}
        onUniverseChange={setUniverse}
        period={period}
        onPeriodChange={setPeriod}
        top={top}
        onTopChange={setTop}
        busy={busy}
        onSubmit={startBench}
        formError={formError}
      />

      {/* Progress */}
      {(status === "submitting" || status === "streaming") && (
        <ProgressPanel jobId={jobId} progress={progress} />
      )}

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}

/* ---------- Compare view ---------- */

/**
 * Head-to-head comparison of a hand-picked set of alphas.
 *
 * Mirrors {@link BenchView}'s raw-EventSource lifecycle (the shared `useSSE`
 * hook drops these event types). Ids are prefilled from `?ids=a,b,c` — set by
 * the BrowseView multi-select — and remain editable as free text.
 */
function CompareView() {
  const { search: locSearch } = useLocation();
  const initialIds = useMemo(() => {
    const q = new URLSearchParams(locSearch);
    return parseAlphaIds(q.get("ids") || "").join(", ");
  }, [locSearch]);

  const [idsText, setIdsText] = useState(initialIds);
  const [universe, setUniverse] = useState("csi300");
  const [period, setPeriod] = useState("2020-2025");
  const [sort, setSort] = useState("ir");

  const [status, setStatus] = useState<BenchStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BenchProgress | null>(null);
  const [result, setResult] = useState<AlphaCompareResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);

  const ids = useMemo(() => parseAlphaIds(idsText), [idsText]);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const attachStream = (newJobId: string) => {
    setStatus("streaming");
    const source = new EventSource(api.alphaCompareStreamUrl(newJobId));
    sourceRef.current = source;

    source.addEventListener("progress", (e) => {
      try {
        setProgress(JSON.parse((e as MessageEvent).data) as BenchProgress);
      } catch {
        /* ignore */
      }
    });
    source.addEventListener("result", (e) => {
      try {
        setResult(JSON.parse((e as MessageEvent).data) as AlphaCompareResult);
      } catch {
        /* ignore */
      }
    });
    source.addEventListener("done", () => {
      doneRef.current = true;
      setStatus("done");
      source.close();
      sourceRef.current = null;
    });
    source.addEventListener("error", (e) => {
      // EventSource raises a synthetic error on the close that follows `done`;
      // the ref check (synchronous) is the only reliable race guard.
      if (doneRef.current) {
        source.close();
        sourceRef.current = null;
        return;
      }
      let msg = "对比流错误";
      try {
        const data = JSON.parse((e as MessageEvent).data || "{}");
        if (typeof data.message === "string") msg = data.message;
      } catch {
        /* network-level error, no payload */
      }
      toast.error(msg);
      setStatus("error");
      source.close();
      sourceRef.current = null;
    });
  };

  const startCompare = async (e: FormEvent) => {
    e.preventDefault();
    if (status === "submitting" || status === "streaming") return;
    if (ids.length < 2) {
      setFormError("请输入至少 2 个不同的因子 ID 进行对比。");
      return;
    }
    setStatus("submitting");
    setProgress(null);
    setResult(null);
    setFormError(null);
    doneRef.current = false;
    sourceRef.current?.close();
    try {
      const res = await api.createAlphaCompare({
        alpha_ids: ids,
        universe,
        period,
        sort,
      });
      setJobId(res.job_id);
      attachStream(res.job_id);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to start comparison";
      toast.error(msg);
      setStatus("error");
    }
  };

  const busy = status === "submitting" || status === "streaming";

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <Link
        to="/alpha-zoo"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to 因子库
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> 逐一对比
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          因子横向对比
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Benches just the alphas you pick on a universe and period, then ranks
          them by IC / IR with the gap to the leader — far faster than benching a
          whole zoo when you only care about a shortlist.
        </p>
      </div>

      <CompareForm
        idsText={idsText}
        onIdsTextChange={setIdsText}
        ids={ids}
        universe={universe}
        onUniverseChange={setUniverse}
        period={period}
        onPeriodChange={setPeriod}
        sort={sort}
        onSortChange={setSort}
        busy={busy}
        onSubmit={startCompare}
        formError={formError}
      />

      {(status === "submitting" || status === "streaming") && (
        <ProgressPanel jobId={jobId} progress={progress} />
      )}

      {result && <CompareResultPanel result={result} />}
    </div>
  );
}
