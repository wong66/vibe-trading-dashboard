import { useState, useMemo, memo } from "react";
import { Star, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOGIC_LABELS, DEFAULT_THRESHOLDS, type PickStock, formatMoney, pctColor, scoreColor } from "@/lib/stockPickData";

// ── Simple SVG Radar ────────────────────────────────────────────────────

function SimpleRadar({ data }: { data: { name: string; value: number; max: number }[] }) {
  const cx = 100, cy = 90, r = 60, sides = data.length;
  const angleSlice = (2 * Math.PI) / sides;

  const getPoint = (i: number, val: number, max: number) => {
    const angle = angleSlice * i - Math.PI / 2;
    const dist = (val / max) * r;
    return `${cx + dist * Math.cos(angle)},${cy + dist * Math.sin(angle)}`;
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPolygons = gridLevels.map(level =>
    Array.from({ length: sides }, (_, i) => getPoint(i, level * 100, 100)).join(" ")
  );

  const dataPolygon = data.map((d, i) => getPoint(i, d.value, d.max)).join(" ");

  return (
    <svg viewBox="0 0 200 180" className="w-full h-full max-w-[200px]">
      {/* Grid */}
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="#e5e7eb" strokeWidth="0.5" />
      ))}
      {/* Axes */}
      {data.map((_, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        return (
          <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)} stroke="#e5e7eb" strokeWidth="0.5" />
        );
      })}
      {/* Data */}
      <polygon points={dataPolygon} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1.5" />
      {/* Dots */}
      {data.map((d, i) => {
        const [x, y] = getPoint(i, d.value, d.max).split(",");
        return <circle key={i} cx={x} cy={y} r="3" fill="#3b82f6" />;
      })}
    </svg>
  );
}

// ── Single Stock Row ────────────────────────────────────────────────────

function StockRow({
  stock, thresholds, expanded, onToggle, onView,
}: {
  stock: PickStock;
  thresholds: typeof DEFAULT_THRESHOLDS;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  const scoreCells = [
    { val: stock.scores.mainlineStrength, threshold: thresholds.mainlineStrength },
    { val: stock.scores.productPurity, threshold: thresholds.productPurity },
    { val: stock.scores.fundTrend, threshold: thresholds.fundTrend },
    { val: stock.scores.earningsSupport, threshold: thresholds.earningsSupport },
  ];

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <a
            href={`https://stockpage.10jqka.com.cn/${stock.code}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 hover:text-primary transition-colors"
            title="在同花顺打开"
          >
            <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{stock.name}</span>
            <span className="text-xs text-muted-foreground ml-0.5">{stock.code}</span>
            <ExternalLink className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition-colors opacity-0 group-hover:opacity-100" />
          </a>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {stock.concepts.map((c, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground" title={stock.allConcepts.join("、")}>
                {c}
              </span>
            ))}
          </div>
        </td>
        {scoreCells.map(({ val, threshold }, i) => (
          <td key={i} className={cn("px-3 py-2.5 font-mono text-xs font-medium", scoreColor(val, threshold))}>
            {val}
          </td>
        ))}
        <td className={cn("px-3 py-2.5 font-mono text-xs font-medium", pctColor(stock.changePct))}>
          {stock.changePct > 0 ? "+" : ""}{stock.changePct.toFixed(2)}%
        </td>
        <td className={cn("px-3 py-2.5 font-mono text-xs", stock.mainInflow > 0 ? "text-danger" : "text-success")}>
          {stock.mainInflow > 0 ? "+" : ""}{formatMoney(stock.mainInflow)}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {stock.tags.map((t, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
                {t}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onView}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-muted hover:bg-muted-foreground/20 transition-colors"
            >
              <Star className="h-3 w-3" />
              加自选
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); window.open(`https://stockpage.10jqka.com.cn/${stock.code}/`, "_blank", "noopener noreferrer"); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              详情
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={10} className="px-4 py-4 bg-muted/20 border-b">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Radar chart placeholder */}
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs font-semibold mb-2">六维打分雷达</p>
                <div className="flex items-center justify-center h-44">
                  <SimpleRadar data={stock.scoreDetails.radarData} />
                </div>
                <div className="grid grid-cols-2 gap-1 mt-2">
                  {stock.scoreDetails.radarData.map(d => (
                    <div key={d.name} className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-mono font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Volume & breakthrough */}
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div>
                  <p className="text-xs font-semibold">20日量价数据</p>
                  <p className="text-xs text-muted-foreground mt-1">{stock.scoreDetails.volumeAnalysis}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold">5日突破验证</p>
                  <p className="text-xs text-muted-foreground mt-1">{stock.scoreDetails.breakthroughCheck}</p>
                </div>
              </div>

              {/* Fundamental brief */}
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs font-semibold mb-1">基本面核心逻辑</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{stock.scoreDetails.fundamentalBrief}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {stock.logicLabels.map(l => {
                    const info = LOGIC_LABELS.find(ll => ll.key === l);
                    return info ? (
                      <span key={l} className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ color: info.color, backgroundColor: `${info.color}15` }}>
                        {info.label}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
const MemoStockRow = memo(StockRow);

// ── Main PickResultList Component ───────────────────────────────────────

export function PickResultList({
  stocks, logicLabels, thresholds, auxFilters,
  onStockClick,
}: {
  stocks: PickStock[];
  logicLabels: string[];
  thresholds: typeof DEFAULT_THRESHOLDS;
  auxFilters: string[];
  onStockClick: (code: string) => void;
}) {
  const [gradeTab, setGradeTab] = useState<"A" | "B">("A");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  // Filter by logic labels and auxiliary filters
  const filtered = useMemo(() => {
    return stocks.filter(s => {
      // Must match at least one selected logic label
      if (!s.logicLabels.some(l => logicLabels.includes(l))) return false;

      // Auxiliary filters
      if (auxFilters.includes("volume_20d") && s.mainInflow <= 0) return false;
      if (auxFilters.includes("breakout_5d") && s.changePct <= 0) return false;
      if (auxFilters.includes("fundamental") && s.scores.earningsSupport < thresholds.earningsSupport) return false;
      if (auxFilters.includes("exclude_risk") && s.changePct < -5) return false;

      return true;
    });
  }, [stocks, logicLabels, auxFilters, thresholds]);

  // Grade groups
  const aStocks = useMemo(() => filtered.filter(s => s.grade === "A"), [filtered]);
  const bStocks = useMemo(() => filtered.filter(s => s.grade === "B"), [filtered]);

  const displayStocks = gradeTab === "A" ? aStocks : bStocks;

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return displayStocks;
    return [...displayStocks].sort((a, b) => {
      let va: number, vb: number;
      if (sortKey === "name") { va = a.name.charCodeAt(0); vb = b.name.charCodeAt(0); }
      else if (sortKey === "changePct") { va = a.changePct; vb = b.changePct; }
      else if (sortKey === "mainInflow") { va = a.mainInflow; vb = b.mainInflow; }
      else {
        va = (a.scores as any)[sortKey] ?? 0;
        vb = (b.scores as any)[sortKey] ?? 0;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [displayStocks, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />;
    return sortDir === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />;
  };

  return (
    <div className="space-y-3">
      {/* Grade tabs */}
      <div className="flex items-center gap-2">
        {(["A", "B"] as const).map(g => {
          const count = g === "A" ? aStocks.length : bStocks.length;
          return (
            <button
              key={g}
              onClick={() => { setGradeTab(g); setExpandedCode(null); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border",
                gradeTab === g
                  ? g === "A"
                    ? "bg-danger/10 border-danger/30 text-danger"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "A" ? "⭐ A 级优选" : "🔍 B 级观察"}
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-xs font-bold",
                gradeTab === g ? "bg-background" : "bg-muted",
              )}>
                {count} 只
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {[
                  { key: "name", label: "股票名称", w: "min-w-[140px]" },
                  { key: null, label: "所属概念", w: "min-w-[120px]" },
                  { key: "mainlineStrength", label: "主线强度", w: "min-w-[80px]" },
                  { key: "productPurity", label: "产品纯度", w: "min-w-[80px]" },
                  { key: "fundTrend", label: "资金趋势", w: "min-w-[80px]" },
                  { key: "earningsSupport", label: "业绩支撑", w: "min-w-[80px]" },
                  { key: "changePct", label: "当日涨幅", w: "min-w-[80px]" },
                  { key: "mainInflow", label: "主力资金", w: "min-w-[90px]" },
                  { key: null, label: "核心标签", w: "min-w-[160px]" },
                  { key: null, label: "操作", w: "min-w-[120px]" },
                ].map(col => (
                  <th
                    key={col.key || col.label}
                    className={cn(
                      "px-3 py-2.5 text-left text-xs font-medium text-muted-foreground",
                      col.w,
                      col.key && "cursor-pointer hover:text-foreground select-none",
                    )}
                    onClick={() => col.key && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.key && <SortIcon col={col.key} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(stock => (
                <MemoStockRow
                  key={stock.code}
                  stock={stock}
                  thresholds={thresholds}
                  expanded={expandedCode === stock.code}
                  onToggle={() => setExpandedCode(expandedCode === stock.code ? null : stock.code)}
                  onView={() => onStockClick(stock.code)}
                />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                    当前筛选条件下无匹配标的
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
