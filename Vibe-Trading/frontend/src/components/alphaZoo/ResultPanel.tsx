import { useEffect, useRef } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import type { AlphaBenchResult } from "@/lib/api";
import {
  buildByThemeChartOption,
  mountECharts,
  TopTable,
} from "@/lib/alphaZooHelpers";

interface Props {
  result: AlphaBenchResult;
}

export function ResultPanel({ result }: Props) {
  const { dark } = useDarkMode();
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    return mountECharts(chartRef.current, buildByThemeChartOption(result));
  }, [result, dark]);

  const totals = [
    { label: "有效", value: result.alive, icon: CheckCircle2, tone: "text-green-600 dark:text-green-400" },
    { label: "反转", value: result.reversed, icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400" },
    { label: "无效", value: result.dead, icon: XCircle, tone: "text-red-600 dark:text-red-400" },
    { label: "跳过", value: result.skipped ?? 0, icon: Loader2, tone: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {totals.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="border rounded-xl p-4 bg-card flex items-center gap-3">
            <Icon className={cn("h-5 w-5 shrink-0", tone)} aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold tabular-nums">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopTable title="信息比率 Top 5" rows={result.top5_by_ir || []} />
        <TopTable title="最多反转" rows={(result.dead_examples || []).slice(0, 3)} />
      </div>

      {/* By-theme breakdown */}
      {result.by_theme && Object.keys(result.by_theme).length > 0 && (
        <div className="border rounded-xl p-4 bg-card">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            按主题
          </h3>
          <div ref={chartRef} style={{ height: 240 }} />
        </div>
      )}
    </div>
  );
}
