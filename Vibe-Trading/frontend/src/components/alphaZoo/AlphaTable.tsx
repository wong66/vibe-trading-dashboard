import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AlphaSummary } from "@/lib/api";

interface Props {
  loading: boolean;
  visible: AlphaSummary[];
  filteredLength: number;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onLoadMore: () => void;
}

export function AlphaTable({
  loading,
  visible,
  filteredLength,
  selected,
  onToggleSelected,
  onLoadMore,
}: Props) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="因子目录">
          <caption className="sr-only">因子目录</caption>
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="w-10 px-3 py-2.5">
                <span className="sr-only">选择对比</span>
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground">
                ID
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground">
                Zoo
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground">
                Theme
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                Universe
              </th>
              <th className="text-right px-4 py-2.5 text-muted-foreground" title="Predictive half-life: trading days before the signal's edge decays">
                衰减（天）
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden="true" />
                  Loading alphas…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  没有因子匹配当前筛选条件。
                </td>
              </tr>
            ) : (
              visible.map((a) => (
                <tr
                  key={`${a.zoo}:${a.id}`}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/20",
                    selected.has(a.id) && "bg-primary/5",
                  )}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => onToggleSelected(a.id)}
                      aria-label={`Select ${a.id} for compare`}
                      className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link
                      to={`/alpha-zoo/${encodeURIComponent(a.id)}`}
                      className="text-primary hover:underline"
                    >
                      {a.id}
                    </Link>
                    {a.nickname && (
                      <span className="ml-2 text-muted-foreground font-sans">
                        {a.nickname}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{a.zoo}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {(a.theme || []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground hidden md:table-cell">
                    {(a.universe || []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-xs">
                    {a.decay_horizon ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && visible.length < filteredLength && (
        <div className="border-t p-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {visible.length} of {filteredLength}
          </span>
          <button
            type="button"
            onClick={onLoadMore}
            className="px-3 py-1 rounded-md border hover:bg-muted hover:text-foreground transition"
          >
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}
