// ── Stock Board 子组件 ─────────────────────────────────────────
// 从 StockBoard.tsx 提取的子组件

import { cn } from "@/lib/utils";
import type { ComponentType } from "react";

// ── Section header ───────────────────────────────────────────────────
export function SectionHeader({ 
  icon: Icon, 
  title, 
  subtitle 
}: { 
  icon: ComponentType<{ className?: string }>; 
  title: string; 
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {subtitle && <span className="text-[11px] text-muted-foreground/80 font-bold">{subtitle}</span>}
    </div>
  );
}

// ── Metric cards row (used in section 1) ─────────────────────────────
export function MetricCard({
  label, value, sub, accent, subAccent,
}: { 
  label: string; 
  value: string; 
  sub?: string; 
  accent?: "up" | "down" | "neutral"; 
  subAccent?: "up" | "down" | "neutral";
}) {
  const accentClass = accent === "up" ? "text-danger" : accent === "down" ? "text-success" : "text-foreground";
  const subClass = subAccent === "up" ? "text-danger"
    : subAccent === "down" ? "text-success"
    : "text-muted-foreground/60";
  return (
    <div className="px-3 py-2 rounded-md border bg-card/50">
      <p className="text-[11px] text-muted-foreground font-bold tracking-wide">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums mt-0.5", accentClass)}>{value}</p>
      {sub && <p className={cn("text-[11px] mt-0.5 font-bold tabular-nums", subClass)}>{sub}</p>}
    </div>
  );
}
