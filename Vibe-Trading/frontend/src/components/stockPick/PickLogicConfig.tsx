import { useState } from "react";
import { SlidersHorizontal, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOGIC_LABELS, AUX_FILTERS, DEFAULT_THRESHOLDS } from "@/lib/stockPickData";

export function PickLogicConfig({
  logicLabels, setLogicLabels,
  thresholds, setThresholds,
  auxFilters, setAuxFilters,
  templateEnabled, setTemplateEnabled,
}: {
  logicLabels: string[];
  setLogicLabels: (v: string[]) => void;
  thresholds: typeof DEFAULT_THRESHOLDS;
  setThresholds: (v: typeof DEFAULT_THRESHOLDS) => void;
  auxFilters: string[];
  setAuxFilters: (v: string[]) => void;
  templateEnabled: boolean;
  setTemplateEnabled: (v: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const toggleLogic = (key: string) => {
    if (logicLabels.includes(key)) {
      if (logicLabels.length > 1) setLogicLabels(logicLabels.filter(k => k !== key));
    } else {
      setLogicLabels([...logicLabels, key]);
    }
  };

  const toggleAux = (key: string) => {
    if (auxFilters.includes(key)) {
      setAuxFilters(auxFilters.filter(k => k !== key));
    } else {
      setAuxFilters([...auxFilters, key]);
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">选股逻辑配置</span>
          <span className="text-xs text-muted-foreground">
            ({logicLabels.length}/{LOGIC_LABELS.length} 逻辑 · {auxFilters.length}/{AUX_FILTERS.length} 筛选)
          </span>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4 border-t">
          {/* 1. Logic tags */}
          <div className="pt-3">
            <p className="text-xs text-muted-foreground mb-2">六大底层逻辑（多选，至少保留 1 个）</p>
            <div className="flex flex-wrap gap-2">
              {LOGIC_LABELS.map(({ key, label, icon: Icon, color }) => {
                const active = logicLabels.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleLogic(key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      active
                        ? "border-current shadow-sm"
                        : "border-border text-muted-foreground hover:border-muted-foreground",
                    )}
                    style={active ? { color, borderColor: color, backgroundColor: `${color}10` } : {}}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Template toggle */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={templateEnabled}
                onChange={(e) => setTemplateEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary/30"
              />
              <span className="text-sm font-medium">启用短线优选模板</span>
              <span className="text-xs text-muted-foreground">
                （开启后自动套用量化阈值）
              </span>
            </label>
          </div>

          {/* 3. Threshold sliders */}
          {templateEnabled && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {([
                { key: "mainlineStrength" as const, label: "主线强度", threshold: thresholds.mainlineStrength, rec: 70 },
                { key: "productPurity" as const, label: "产品纯度", threshold: thresholds.productPurity, rec: 60 },
                { key: "fundTrend" as const, label: "资金趋势", threshold: thresholds.fundTrend, rec: 60 },
                { key: "earningsSupport" as const, label: "业绩/订单支撑", threshold: thresholds.earningsSupport, rec: 50 },
              ]).map(({ key, label, threshold, rec }) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={cn(
                      "text-xs font-mono font-bold",
                      threshold >= rec ? "text-emerald-600" : "text-orange-500",
                    )}>
                      {threshold} 分
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={95}
                    value={threshold}
                    onChange={(e) => setThresholds({ ...thresholds, [key]: +e.target.value })}
                    className="w-full h-1.5 rounded-full appearance-none bg-muted cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Grading hint */}
          {templateEnabled && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
              <span className="font-semibold text-foreground">分级规则：</span>
              满足 ≥3 项为 <span className="text-danger font-semibold">A 级优选</span>，
              满足 2 项为 <span className="text-amber-500 font-semibold">B 级观察</span>，
              ≤1 项 <span className="text-muted-foreground line-through">直接剔除</span>
            </p>
          )}

          {/* 4. Auxiliary filters */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">辅助筛选</p>
            <div className="flex flex-wrap gap-2">
              {AUX_FILTERS.map(({ key, label }) => {
                const active = auxFilters.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleAux(key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all",
                      active
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground",
                    )}
                  >
                    <Filter className="h-3 w-3" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
