import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Loader2,
  Search,
  RefreshCw,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface TaskInfo {
  task_id: string;
  stock_code: string;
  stock_name?: string;
  status: string;
  report_type?: string;
  created_at?: string;
  completed_at?: string;
  result?: string;
  error?: string;
}

type ViewMode = "analyze" | "history";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "排队中", cls: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
    processing: { label: "分析中", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    completed: { label: "已完成", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    failed: { label: "失败", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
    cancelled: { label: "已取消", cls: "bg-gray-500/10 text-foreground dark:text-foreground" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-gray-500/10 text-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", cls)}>
      {status === "completed" && <CheckCircle className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export function SmartAnalysis() {
  const [mode, setMode] = useState<ViewMode>("analyze");
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">股票智能分析</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6">
        {(["analyze", "history"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              mode === m
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "analyze" ? <Search className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            {m === "analyze" ? "智能分析" : "分析历史"}
          </button>
        ))}
      </div>

      {mode === "analyze" ? <AnalyzePanel /> : <HistoryPanel />}
    </div>
  );
}

// ──────────────────────────────────────────────
// Analyze Panel
// ──────────────────────────────────────────────

function renderReport(result: any): string {
  if (!result) return "分析完成，但未返回内容。";
  if (typeof result === "string") return result;

  const report = result.report;
  if (!report || typeof report !== "object") {
    return JSON.stringify(result, null, 2);
  }

  const meta = report.meta || {};
  const summary = report.summary || {};
  const strategy = report.strategy || {};
  const details = report.details || {};
  const rawResult = details.raw_result || {};

  const title = meta.stock_name
    ? `${meta.stock_name}（${meta.stock_code}）`
    : meta.stock_code || "分析报告";

  let md = `## ${title}\n\n`;
  if (meta.current_price !== undefined && meta.current_price !== null) {
    const change = meta.change_pct ?? rawResult.change_pct;
    const changeText = change !== undefined && change !== null ? `  涨跌：${change}%` : "";
    md += `> 当前价格：¥${meta.current_price}${changeText}  \n`;
  }
  md += `> 报告类型：${meta.report_type || "detailed"} ｜ 时间：${meta.created_at ? new Date(meta.created_at).toLocaleString("zh-CN") : "-"}\n\n`;

  md += `### 综合结论\n`;
  md += `- **操作建议**：${summary.action_label || summary.operation_advice || "-"}\n`;
  md += `- **情绪评分**：${summary.sentiment_score ?? "-"}${summary.sentiment_label ? `（${summary.sentiment_label}）` : ""}\n`;
  md += `- **趋势预测**：${summary.trend_prediction || "-"}\n\n`;

  if (summary.analysis_summary) {
    md += `### 分析摘要\n${summary.analysis_summary}\n\n`;
  }

  if (strategy.ideal_buy || strategy.secondary_buy || strategy.stop_loss || strategy.take_profit) {
    md += `### 关键点位\n`;
    md += `- 理想买入：${strategy.ideal_buy || "-"}\n`;
    md += `- 二次买入：${strategy.secondary_buy || "-"}\n`;
    md += `- 止损：${strategy.stop_loss || "-"}\n`;
    md += `- 止盈：${strategy.take_profit || "-"}\n\n`;
  }

  if (details.news_content) {
    md += `### 新闻摘要\n${details.news_content}\n\n`;
  }

  return md.trim();
}

function AnalyzePanel() {
  const [codes, setCodes] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    const trimmed = codes.trim();
    if (!trimmed) return;

    const rawInputs = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (rawInputs.length === 0) return;

    // Special market-review trigger
    const MARKET_REVIEW_KEYWORDS = new Set(["大盘", "market", "market_review", "a股", "市场", "a股", "复盘大盘"]);
    if (rawInputs.length === 1 && MARKET_REVIEW_KEYWORDS.has(rawInputs[0].toLowerCase())) {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const res = await fetch("/smart-analysis/analysis/market-review", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? body?.message ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const taskId = data.task_id;
        if (!taskId) throw new Error("未返回任务ID");
        // Poll market review task
        let done = false;
        while (!done) {
          await new Promise((r) => setTimeout(r, 2000));
          const st = await fetch(`/smart-analysis/analysis/status/${taskId}`).then((r) => r.json());
          if (st.status === "completed") {
            done = true;
            setResult(renderReport(st.result));
          } else if (st.status === "failed") {
            done = true;
            throw new Error(st.error ?? "大盘复盘失败");
          }
        }
      } catch (e: any) {
        setError(e.message || "大盘复盘请求失败");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Step 1: resolve all inputs to stock codes (name → code)
    const stockCodes: string[] = [];
    for (const input of rawInputs) {
      // If already looks like a code, use as-is
      if (/^\d{4,6}$/.test(input)) {
        stockCodes.push(input);
        continue;
      }
      // Otherwise try to resolve name → code via backend
      try {
        const res = await fetch(
          `/smart-analysis/stocks/resolve?name=${encodeURIComponent(input)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail?.message ?? body?.detail ?? `无法识别: ${input}`);
        }
        const data = await res.json();
        stockCodes.push(data.code);
      } catch (e: any) {
        setError(`"${input}" ${e.message || "无法解析为股票代码"}`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/smart-analysis/analysis/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stock_codes: stockCodes,
          report_type: "detailed",
          async_mode: true,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      const tasks = data.task_id
        ? [{ task_id: data.task_id, stock_code: stockCodes[0] }]
        : (data.accepted || []).map((item: any) => ({
            task_id: item.task_id,
            stock_code: item.stock_code || "-",
          }));

      if (tasks.length === 0) {
        throw new Error(data.message || "没有可分析的任务");
      }

      // Poll all tasks to completion
      const results: string[] = [];
      const errors: string[] = [];
      for (const task of tasks) {
        let done = false;
        while (!done) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await fetch(`/smart-analysis/analysis/status/${task.task_id}`).then((r) => r.json());
          if (st.status === "completed") {
            done = true;
            results.push(renderReport(st.result));
          } else if (st.status === "failed") {
            done = true;
            errors.push(`${task.stock_code}: ${st.error ?? "分析失败"}`);
          }
        }
      }

      if (errors.length > 0) {
        setError(errors.join("；"));
      }
      if (results.length > 0) {
        setResult(results.join("\n\n---\n\n"));
      }
    } catch (e: any) {
      setError(e.message ?? "未知错误");
    } finally {
      setLoading(false);
    }
  }, [codes]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <label className="text-sm font-medium text-foreground">股票代码</label>
        <div className="flex gap-2">
          <input
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            placeholder="例如: 600519,000858,300750"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={handleAnalyze}
            disabled={loading || !codes.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            开始分析
          </button>
        </div>
        <p className="text-xs text-muted-foreground">输入逗号分隔的股票代码或名称，AI 将自动生成分析报告</p>
      </div>

      {loading && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">AI 分析中，请稍候…</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">分析失败</p>
            <p className="text-sm text-red-500/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="border-b px-4 py-3 flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-primary" />
            分析报告
          </div>
          <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// History Panel
// ──────────────────────────────────────────────

function HistoryPanel() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/smart-analysis/history");
      const data = await res.json();
      // Backend returns { total, page, limit, items: [...] }
      // Each item has query_id (not task_id)
      const rawItems = Array.isArray(data) ? data : data.items ?? data.tasks ?? [];
      const list: TaskInfo[] = rawItems.map((item: any) => ({
        task_id: item.query_id || item.task_id || "",
        stock_code: item.stock_code || "",
        stock_name: item.stock_name || "",
        status: item.status || "completed",
        report_type: item.report_type || "",
        created_at: item.created_at || item.started_at || "",
        completed_at: item.completed_at || item.finished_at || "",
      }));
      setTasks(list);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggleExpand = async (task: TaskInfo) => {
    if (expanded === task.task_id) {
      setExpanded(null);
      return;
    }
    // Fetch full report from backend
    try {
      const res = await fetch(`/smart-analysis/history/${task.task_id}`);
      const data = await res.json();
      // Backend may return { report: {...} } or direct report object
      const reportData = data.report ?? data;
      const report = renderReport({ report: reportData });
      if (report) {
        setTasks((prev) =>
          prev.map((t) => (t.task_id === task.task_id ? { ...t, result: report } : t)),
        );
        setExpanded(task.task_id);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">共 {tasks.length} 条分析记录</p>
        <button
          onClick={loadHistory}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          暂无分析记录
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.task_id} className="rounded-lg border bg-card overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpand(t)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.stock_code}</span>
                    {t.stock_name && (
                      <span className="text-xs text-muted-foreground">{t.stock_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {statusBadge(t.status)}
                    <span className="text-xs text-muted-foreground">
                      {t.created_at ? new Date(t.created_at).toLocaleString("zh-CN") : ""}
                    </span>
                  </div>
                </div>
                {t.status === "completed" && t.result ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {expanded === t.task_id && t.result && (
                <div className="border-t px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>{t.result}</Markdown>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
