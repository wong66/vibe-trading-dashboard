import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AlphaCompareResult } from "@/lib/api";
import { fmtNum } from "@/lib/alphaZooHelpers";

interface Props {
  result: AlphaCompareResult;
}

export function CompareResultPanel({ result }: Props) {
  const deltaKey = `delta_${result.sort}_vs_best`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Winner:{" "}
          <span className="font-mono">{result.winner}</span>
        </span>
        <span className="text-muted-foreground">
          {result.n_compared} 个对比 · 排序：{result.sort} · {result.universe} · {result.period}
        </span>
        {result.n_skipped > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {result.n_skipped} 个跳过
          </span>
        )}
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="因子对比排名">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
                <th className="text-right px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Alpha</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Zoo</th>
                <th className="text-right px-3 py-2">IC mean</th>
                <th className="text-right px-3 py-2 hidden md:table-cell">IC std</th>
                <th className="text-right px-3 py-2">IR</th>
                <th className="text-right px-3 py-2 hidden md:table-cell" title="Share of periods with positive IC">IC&gt;0</th>
                <th className="text-right px-3 py-2 hidden lg:table-cell" title="IC sample count">n</th>
                <th className="text-right px-3 py-2" title={`Gap to the leader on ${result.sort}`}>Δ {result.sort}</th>
              </tr>
            </thead>
            <tbody>
              {result.ranking.map((r) => (
                <tr
                  key={`${r.zoo}:${r.id}`}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/20",
                    r.rank === 1 && "bg-emerald-500/5",
                  )}
                >
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.rank}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      to={`/alpha-zoo/${encodeURIComponent(r.id)}`}
                      className="text-primary hover:underline"
                    >
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{r.zoo}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(r.ic_mean, 4)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums hidden md:table-cell">{fmtNum(r.ic_std, 4)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(r.ir, 3)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums hidden md:table-cell">{fmtNum(r.ic_positive_ratio, 3)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums hidden lg:table-cell">{r.ic_count}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {r.rank === 1 ? "—" : fmtNum(Number(r[deltaKey]), 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {result.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">已跳过：</span>{" "}
          {result.skipped.map((s) => `${s.id} (${s.reason})`).join("; ")}
        </p>
      )}
    </div>
  );
}
