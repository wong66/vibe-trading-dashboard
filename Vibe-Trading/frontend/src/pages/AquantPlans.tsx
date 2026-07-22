/**
 * A股量化决策 — 交易计划页面
 *
 * 结构化模板：标的 / 买入区间 / 仓位 / 止损 / 目标 / 周期 / 理由
 * + 信号ID + 系统评分 + 执行状态（未执行 → 已执行 → 已完成）
 */

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardList, Plus, CheckCircle, XCircle, AlertCircle,
  RefreshCw, ArrowRight, ChevronDown, ChevronUp,
} from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";
import { cn } from "@/lib/utils";
import { request } from "@/lib/api";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────

interface PlanFields {
  buy_range_low?: number;
  buy_range_high?: number;
  position_pct?: number;
  stop_loss_price?: number;
  target_price?: number;
  hold_period?: string;
  reason?: string;
}

interface TradePlan {
  trade_id: string;
  signal_id: string;
  stock_code: string;
  stock_name: string;
  system_score?: number;
  fields: PlanFields;
  status: "未执行" | "已执行" | "已完成" | "已放弃";
  created_at: string;
  executed_at?: string;
  completed_at?: string;
}

// ── Sub-components ─────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  "未执行": { icon: AlertCircle, color: "text-muted-foreground", bg: "bg-muted/30" },
  "已执行": { icon: CheckCircle, color: "text-warning", bg: "bg-warning/10" },
  "已完成": { icon: CheckCircle, color: "text-success", bg: "bg-success/10" },
  "已放弃": { icon: XCircle, color: "text-danger", bg: "bg-danger/10" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["未执行"];
  const Icon = cfg.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
      cfg.color, cfg.bg,
    )}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function PlanCard({
  plan,
  onStatusChange,
  onDelete,
}: {
  plan: TradePlan;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[plan.status];
  const Icon = cfg?.icon || AlertCircle;

  return (
    <div className={cn(
      "rounded-xl border bg-card transition-all",
      "hover:shadow-sm",
    )}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", cfg?.bg)}>
          <Icon className={cn("h-4 w-4", cfg?.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{plan.stock_name}</span>
            <span className="text-[10px] font-mono text-muted-foreground">{plan.stock_code}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={plan.status} />
            {plan.system_score != null && (
              <span className="text-[10px] text-muted-foreground">
                系统评分: {plan.system_score.toFixed(1)}
              </span>
            )}
            {plan.signal_id && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                {plan.signal_id}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 border-t bg-muted/20">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3">
            <div>
              <span className="text-[10px] text-muted-foreground">买入区间</span>
              <p className="text-xs font-mono">
                {plan.fields.buy_range_low?.toFixed(2) ?? "—"} ~ {plan.fields.buy_range_high?.toFixed(2) ?? "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">仓位</span>
              <p className="text-xs font-mono">
                {plan.fields.position_pct ? `${plan.fields.position_pct}%` : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">止损价</span>
              <p className="text-xs font-mono text-danger">
                {plan.fields.stop_loss_price?.toFixed(2) ?? "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">目标价</span>
              <p className="text-xs font-mono text-success">
                {plan.fields.target_price?.toFixed(2) ?? "—"}
              </p>
            </div>
          </div>
          {plan.fields.hold_period && (
            <div className="mb-2">
              <span className="text-[10px] text-muted-foreground">持有周期</span>
              <p className="text-xs">{plan.fields.hold_period}</p>
            </div>
          )}
          {plan.fields.reason && (
            <div>
              <span className="text-[10px] text-muted-foreground">买入理由</span>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{plan.fields.reason}</p>
            </div>
          )}

          {/* Status transition buttons */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            {plan.status === "未执行" && (
              <>
                <button
                  onClick={() => onStatusChange(plan.trade_id, "已执行")}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                >
                  <ArrowRight className="h-3 w-3" />
                  标记已执行
                </button>
                <button
                  onClick={() => onStatusChange(plan.trade_id, "已放弃")}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                >
                  <XCircle className="h-3 w-3" />
                  放弃
                </button>
              </>
            )}
            {plan.status === "已执行" && (
              <button
                onClick={() => onStatusChange(plan.trade_id, "已完成")}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors"
              >
                <CheckCircle className="h-3 w-3" />
                标记已完成
              </button>
            )}
            <button
              onClick={() => onDelete(plan.trade_id)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors ml-auto"
            >
              <XCircle className="h-3 w-3" />
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export function AquantPlans() {
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPlans = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await request<{ plans: TradePlan[] }>("/aquant/plans");
      setPlans(res.plans || []);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleStatusChange = async (tradeId: string, newStatus: string) => {
    try {
      await request(`/aquant/plans/${tradeId}?status=${encodeURIComponent(newStatus)}`, { method: "PATCH" });
      setPlans(prev => prev.map(p =>
        p.trade_id === tradeId ? { ...p, status: newStatus as TradePlan["status"] } : p
      ));
      toast.success(`状态已更新为: ${newStatus}`);
    } catch {
      toast.error("状态更新失败");
    }
  };

  const handleDelete = async (tradeId: string) => {
    try {
      await request(`/aquant/plans/${tradeId}`, { method: "DELETE" });
      setPlans(prev => prev.filter(p => p.trade_id !== tradeId));
      toast.success("计划已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  // Summary stats
  const total = plans.length;
  const pending = plans.filter(p => p.status === "未执行").length;
  const completed = plans.filter(p => p.status === "已完成").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            交易计划
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            从主线决策信号一键转化，制定结构化交易计划
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 统计 */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mr-2">
            <span>总计 <strong className="text-foreground">{total}</strong></span>
            <span className="text-warning">待执行 <strong>{pending}</strong></span>
            <span className="text-success">已完成 <strong>{completed}</strong></span>
          </div>
          <button
            onClick={() => fetchPlans(true)}
            disabled={refreshing}
            className="p-1.5 rounded-md border bg-card hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
          {/* 新建按钮 */}
          <button
            onClick={() => toast.info("从主线决策页面点击「创建交易计划」即可自动生成")}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            新建计划
          </button>
        </div>
      </div>

      {/* Plans list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && plans.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-card">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ClipboardList className="h-12 w-12 opacity-20 mb-3" />
            <p className="text-sm font-medium">暂无交易计划</p>
            <p className="text-xs opacity-60 mt-1">
              从主线决策页面选择一个信号，点击「创建交易计划」
            </p>
          </div>
        ) : (
          plans.map((plan) => (
            <PlanCard
              key={plan.trade_id}
              plan={plan}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
