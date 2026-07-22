/**
 * 信号详情面板 — 点击信号行后展示的完整因子分析
 *
 * 包含：因子雷达图 + 因子明细表 + AI建议 + 板块信息
 */

import { X, TrendingUp, Target, DollarSign, Activity, Shield } from "lucide-react";
import { FactorRadarChart } from "./FactorRadarChart";
import type { FactorData } from "./FactorRadarChart";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────

interface SignalRecord {
  signal_id: string;
  date: string;
  stock_code: string;
  stock_name: string;
  score: number;
  factors: FactorData & {
    is_st?: boolean;
    debt_ratio?: number;
    margin_change_pct?: number;
    vol_ratio?: number;
    dragon_tiger_signal?: number;
    net_margin?: number;
  };
  sector: string;
  sector_score?: {
    signal_density?: number;
    capital_flow?: number;
    leader_effect?: number;
    total?: number;
  };
  ai_suggestion?: string;
}

interface Props {
  signal: SignalRecord;
  onClose: () => void;
}

// ── Sub-components ───────────────────────────────────────────────────

function FactorRow({
  label, value, unit = "", trend, desc,
}: {
  label: string; value: number | undefined | null;
  unit?: string; trend?: "up" | "down" | "neutral"; desc?: string;
}) {
  const displayValue = value != null ? value.toFixed(1) : "—";
  const trendColor =
    trend === "up" ? "text-emerald-500"
    : trend === "down" ? "text-red-500"
    : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        {desc && <span className="text-[10px] text-muted-foreground/60">{desc}</span>}
      </div>
      <span className={cn("text-xs font-mono font-semibold tabular-nums", trendColor)}>
        {displayValue}{unit}
      </span>
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-emerald-500"
    : score >= 60 ? "text-amber-500"
    : score >= 40 ? "text-orange-500"
    : "text-red-500";

  const barColor =
    score >= 80 ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
    : score >= 60 ? "bg-gradient-to-r from-amber-400 to-amber-500"
    : score >= 40 ? "bg-gradient-to-r from-orange-400 to-orange-500"
    : "bg-gradient-to-r from-red-400 to-red-500";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <span className={cn("text-lg font-bold tabular-nums", color)}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function SignalDetailPanel({ signal, onClose }: Props) {
  const f = signal.factors;

  return (
    <div className="flex flex-col h-full border-l bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold truncate">{signal.stock_name}</span>
            <span className="text-xs font-mono text-muted-foreground">{signal.stock_code}</span>
            {f.is_st && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30">
                ST
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {signal.sector} · 市值 {f.market_cap_yi ? `${(f.market_cap_yi / 10000).toFixed(2)}万亿` : "—"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Score */}
        <div className="px-4 py-3 border-b">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">综合评分</span>
          <div className="mt-1.5">
            <ScoreGauge score={signal.score} />
          </div>
        </div>

        {/* Radar Chart */}
        <div className="px-2 py-3 border-b">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider px-2">因子雷达</span>
          <FactorRadarChart factor={f} height={240} />
        </div>

        {/* Factor Detail Groups */}
        <div className="divide-y">
          {/* 估值因子 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold">估值因子</span>
            </div>
            <FactorRow
              label="PE历史百分位" value={f.pe_percentile} unit="%"
              trend={f.pe_percentile != null && f.pe_percentile > 70 ? "up" : "neutral"}
              desc="越低越便宜"
            />
            <FactorRow
              label="PB历史百分位" value={f.pb_percentile} unit="%"
              trend={f.pb_percentile != null && f.pb_percentile > 70 ? "up" : "neutral"}
              desc="越低越便宜"
            />
          </div>

          {/* 质量因子 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-semibold">质量因子</span>
            </div>
            <FactorRow
              label="ROE" value={f.roe} unit="%"
              trend={f.roe != null && f.roe >= 15 ? "up" : f.roe != null && f.roe < 5 ? "down" : "neutral"}
              desc="净资产收益率"
            />
            {f.net_margin != null && (
              <FactorRow
                label="净利率" value={f.net_margin} unit="%"
                trend={f.net_margin >= 15 ? "up" : "neutral"}
              />
            )}
            {f.debt_ratio != null && (
              <FactorRow
                label="资产负债率" value={f.debt_ratio} unit="%"
                trend={f.debt_ratio > 70 ? "down" : f.debt_ratio < 30 ? "up" : "neutral"}
              />
            )}
            <FactorRow
              label="毛利率变化" value={f.gross_margin_change} unit="pp"
              trend={f.gross_margin_change != null && f.gross_margin_change > 0 ? "up" : f.gross_margin_change != null ? "down" : "neutral"}
            />
          </div>

          {/* 成长因子 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs font-semibold">成长因子</span>
            </div>
            <FactorRow
              label="营收同比增速" value={f.revenue_growth} unit="%"
              trend={f.revenue_growth != null && f.revenue_growth > 20 ? "up" : f.revenue_growth != null && f.revenue_growth < 0 ? "down" : "neutral"}
            />
            <FactorRow
              label="净利同比增速" value={f.net_profit_growth} unit="%"
              trend={f.net_profit_growth != null && f.net_profit_growth > 20 ? "up" : f.net_profit_growth != null && f.net_profit_growth < 0 ? "down" : "neutral"}
            />
          </div>

          {/* 动量 & 资金因子 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Activity className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold">动量 & 资金</span>
            </div>
            <FactorRow
              label="20日涨跌幅" value={f.ret_20d} unit="%"
              trend={f.ret_20d != null && f.ret_20d > 5 ? "up" : f.ret_20d != null && f.ret_20d < -5 ? "down" : "neutral"}
            />
            <FactorRow
              label="近20日主力净流入" value={f.main_flow_20d} unit="亿"
              trend={f.main_flow_20d != null && f.main_flow_20d > 0.5 ? "up" : f.main_flow_20d != null && f.main_flow_20d < -0.5 ? "down" : "neutral"}
            />
            {f.vol_ratio != null && (
              <FactorRow label="量比" value={f.vol_ratio} />
            )}
            {(f.dragon_tiger_signal ?? 0) !== 0 && (
              <FactorRow
                label="龙虎榜" value={f.dragon_tiger_signal}
                unit={f.dragon_tiger_signal === 1 ? " 净买入" : " 净卖出"}
                trend={f.dragon_tiger_signal === 1 ? "up" : "down"}
              />
            )}
            {f.margin_change_pct != null && (
              <FactorRow
                label="融资变化" value={f.margin_change_pct} unit="%"
                trend={f.margin_change_pct > 0 ? "up" : "down"}
              />
            )}
          </div>

          {/* 板块信息 */}
          {signal.sector_score && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Target className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-xs font-semibold">板块评分</span>
              </div>
              <FactorRow label="信号密度" value={signal.sector_score.signal_density} />
              <FactorRow label="资金流向" value={signal.sector_score.capital_flow} />
              <FactorRow label="龙头带动" value={signal.sector_score.leader_effect} />
              <FactorRow label="综合" value={signal.sector_score.total} />
            </div>
          )}
        </div>

        {/* AI 建议 */}
        {signal.ai_suggestion && (
          <div className="px-4 py-3 border-t">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">AI 建议</span>
            <p className="text-xs leading-relaxed mt-1.5 text-muted-foreground">
              {signal.ai_suggestion}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
