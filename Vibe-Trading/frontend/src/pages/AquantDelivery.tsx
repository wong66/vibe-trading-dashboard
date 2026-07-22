/**
 * A股量化决策 — 交割单复盘页面
 *
 * 导入券商CSV → 自动匹配信号 → 采纳率 + 胜率
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  FileBarChart, Upload, RefreshCw, CheckCircle, XCircle,
  AlertCircle, ArrowRight,
} from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { request } from "@/lib/api";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────

interface ImportResult {
  total_rows: number;
  matched: number;
  unmatched: number;
  trades: Array<{
    stock_code?: string;
    stock_name?: string;
    trade_date?: string;
    price?: number;
    qty?: number;
    side?: string;
    amount?: number;
    matched_signal_id?: string;
    match_method?: string;
    match_confidence?: string;
    [key: string]: unknown;
  }>;
}

interface DeliveryStats {
  signal_count: number;
  adopted_count: number;
  adoption_rate: number;
  win_count?: number;
  loss_count?: number;
  win_rate?: number;
}

// ── Sub-components ─────────────────────────────────────────────────────

function ImportZone({
  onFileSelect,
  uploading,
}: {
  onFileSelect: (file: File) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = "";
        }}
      />
      <Upload className={cn(
        "h-10 w-10 mx-auto mb-3",
        uploading ? "animate-pulse text-primary" : "text-muted-foreground",
      )} />
      <p className="text-sm font-medium mb-1">
        {uploading ? "上传中..." : "拖拽CSV文件到此处，或点击选择"}
      </p>
      <p className="text-xs text-muted-foreground">
        支持券商导出的交割单 CSV / Excel 文件
      </p>
    </div>
  );
}

function StatRing({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

function TradeRow({ trade }: { trade: ImportResult["trades"][0] }) {
  const matched = !!trade.matched_signal_id;
  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs transition-colors",
      matched ? "border-success/30 bg-success/5" : "border-border/60 bg-card",
    )}>
      {/* 匹配状态 */}
      <div className="shrink-0">
        {matched ? (
          <CheckCircle className="h-3.5 w-3.5 text-success" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </div>

      {/* 股票信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">{trade.stock_name || trade.stock_code || "—"}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{trade.stock_code}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-muted-foreground">{trade.trade_date || "—"}</span>
          {trade.side && <span className={cn("text-[10px]", trade.side.includes("买") ? "text-success" : "text-danger")}>{trade.side}</span>}
        </div>
      </div>

      {/* 价格/数量 */}
      <div className="flex items-center gap-3 text-right shrink-0">
        {trade.price && (
          <div>
            <div className="text-[10px] text-muted-foreground">成交价</div>
            <div className="font-mono">{trade.price.toFixed(2)}</div>
          </div>
        )}
        {trade.qty && (
          <div>
            <div className="text-[10px] text-muted-foreground">数量</div>
            <div className="font-mono">{trade.qty}</div>
          </div>
        )}
      </div>

      {/* 信号ID */}
      {matched && trade.matched_signal_id && (
        <div className="shrink-0">
          <span className="text-[10px] font-mono text-success/80 bg-success/10 px-1.5 py-0.5 rounded">
            {trade.matched_signal_id}
          </span>
          {trade.match_confidence && (
            <span className="text-[9px] text-muted-foreground ml-1">
              ({trade.match_confidence})
            </span>
          )}
        </div>
      )}

      <ArrowRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export function AquantDelivery() {
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleFileSelect = useCallback(async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/aquant/delivery/import", {
        method: "POST",
        headers: {
          ...(typeof localStorage !== "undefined"
            ? { Authorization: `Bearer ${localStorage.getItem("vibe_trading_api_auth_key") || ""}` }
            : {}),
        },
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setImportResult(data);
      toast.success(`导入成功: ${data.total_rows} 笔交易, ${data.matched} 笔匹配到信号`);
    } catch (e) {
      toast.error(`导入失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setUploading(false);
    }
  }, []);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await request<DeliveryStats>("/aquant/delivery/stats");
      setStats(res);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-primary" />
            交割单复盘
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            导入券商交割单，对比系统信号与实际交易
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="p-1.5 rounded-md border bg-card hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
          title="刷新统计"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Import zone */}
        <ImportZone onFileSelect={handleFileSelect} uploading={uploading} />

        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : stats && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FileBarChart className="h-4 w-4 text-primary" />
              信号采纳统计
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <StatRing
                label="系统信号总数"
                value={String(stats.signal_count)}
                color="text-muted-foreground"
              />
              <StatRing
                label="采纳率"
                value={`${stats.adoption_rate}%`}
                sub={`${stats.adopted_count} / ${stats.signal_count}`}
                color="text-primary"
              />
              <StatRing
                label="胜率"
                value={stats.win_rate !== undefined ? `${stats.win_rate}%` : "待导入"}
                sub={stats.win_count !== undefined
                  ? `${stats.win_count}胜 / ${stats.loss_count}败`
                  : "导入交割单后自动计算"}
                color={stats.win_rate !== undefined && stats.win_rate >= 50 ? "text-success" : "text-warning"}
              />
            </div>
          </div>
        )}

        {/* Trade details after import */}
        {importResult && importResult.trades.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                交易明细 ({importResult.total_rows} 笔)
              </h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-success" />
                  已匹配 {importResult.matched}
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-muted-foreground/40" />
                  未匹配 {importResult.unmatched}
                </span>
              </div>
            </div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {importResult.trades.map((trade, i) => (
                <TradeRow key={i} trade={trade} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!importResult && !loading && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <AlertCircle className="h-8 w-8 opacity-30 mb-2" />
            <p className="text-xs">导入交割单后查看统计和匹配结果</p>
          </div>
        )}
      </div>
    </div>
  );
}
