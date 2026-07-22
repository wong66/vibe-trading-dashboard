import { type FormEvent } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { UNIVERSE_OPTIONS, SORT_OPTIONS } from "@/lib/alphaZooHelpers";

interface Props {
  idsText: string;
  onIdsTextChange: (value: string) => void;
  ids: string[];
  universe: string;
  onUniverseChange: (value: string) => void;
  period: string;
  onPeriodChange: (value: string) => void;
  sort: string;
  onSortChange: (value: string) => void;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  formError: string | null;
}

export function CompareForm({
  idsText,
  onIdsTextChange,
  ids,
  universe,
  onUniverseChange,
  period,
  onPeriodChange,
  sort,
  onSortChange,
  busy,
  onSubmit,
  formError,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="border rounded-xl p-4 bg-card space-y-3">
      <div>
        <label htmlFor="compare-ids" className="text-xs text-muted-foreground block mb-1">
          Alpha ids{ids.length > 0 ? ` (${ids.length} selected)` : ""}
        </label>
        <textarea
          id="compare-ids"
          value={idsText}
          onChange={(e) => onIdsTextChange(e.target.value)}
          disabled={busy}
          rows={2}
          placeholder="alpha101_1, alpha101_2, gtja191_5"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Separate ids with commas or spaces. Tip: tick alphas in the catalogue
          and hit "Compare" to prefill this.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="compare-universe" className="text-xs text-muted-foreground block mb-1">Universe</label>
          <select
            id="compare-universe"
            value={universe}
            onChange={(e) => onUniverseChange(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            {UNIVERSE_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="compare-period" className="text-xs text-muted-foreground block mb-1">Period</label>
          <input
            id="compare-period"
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            disabled={busy}
            placeholder="2020-2025"
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="compare-sort" className="text-xs text-muted-foreground block mb-1">Rank by</label>
          <select
            id="compare-sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || ids.length < 2}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Running…
            </>
          ) : (
            <>
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Compare
            </>
          )}
        </button>
        {ids.length < 2 && (
          <span className="text-xs text-muted-foreground">请至少选择 2 个因子。</span>
        )}
      </div>

      {formError && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      )}
    </form>
  );
}
