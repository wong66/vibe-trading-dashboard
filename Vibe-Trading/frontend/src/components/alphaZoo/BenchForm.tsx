import { type FormEvent } from "react";
import { Loader2, Play } from "lucide-react";
import { ZOO_CARDS, UNIVERSE_OPTIONS } from "@/lib/alphaZooHelpers";

interface Props {
  zoo: string;
  onZooChange: (value: string) => void;
  universe: string;
  onUniverseChange: (value: string) => void;
  period: string;
  onPeriodChange: (value: string) => void;
  top: number;
  onTopChange: (value: number) => void;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  formError: string | null;
}

export function BenchForm({
  zoo,
  onZooChange,
  universe,
  onUniverseChange,
  period,
  onPeriodChange,
  top,
  onTopChange,
  busy,
  onSubmit,
  formError,
}: Props) {
  return (
    <form
      onSubmit={onSubmit}
      className="border rounded-xl p-4 bg-card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
    >
      <div>
        <label htmlFor="bench-zoo" className="text-xs text-muted-foreground block mb-1">Zoo</label>
        <select
          id="bench-zoo"
          value={zoo}
          onChange={(e) => onZooChange(e.target.value)}
          disabled={busy}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        >
          {ZOO_CARDS.map((z) => (
            <option key={z.id} value={z.id}>
              {z.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="bench-universe" className="text-xs text-muted-foreground block mb-1">Universe</label>
        <select
          id="bench-universe"
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
        <label htmlFor="bench-period" className="text-xs text-muted-foreground block mb-1">Period</label>
        <input
          id="bench-period"
          value={period}
          onChange={(e) => onPeriodChange(e.target.value)}
          disabled={busy}
          placeholder="2020-2025"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
      </div>
      <div>
        <label htmlFor="bench-top" className="text-xs text-muted-foreground block mb-1">Top</label>
        <input
          id="bench-top"
          type="number"
          min={1}
          max={500}
          value={Number.isFinite(top) ? top : ""}
          onChange={(e) =>
            onTopChange(e.target.value === "" ? 20 : Number(e.target.value))
          }
          disabled={busy}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Running…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> Run benchmark
            </>
          )}
        </button>
      </div>
      {formError && (
        <p
          className="sm:col-span-2 lg:col-span-5 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {formError}
        </p>
      )}
    </form>
  );
}
