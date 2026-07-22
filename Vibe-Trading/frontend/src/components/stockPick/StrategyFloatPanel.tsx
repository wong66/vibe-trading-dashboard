import { useState } from "react";
import { AlertTriangle, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function StrategyFloatPanel() {
  const [collapsed, setCollapsed] = useState(true);

  const tips = [
    {
      title: "当日主线催化",
      content: "优先核查对应赛道是否有政策、产业、技术新利好，无催化的上涨不轻易追高。",
    },
    {
      title: "识别资金龙头",
      content: "不以单日涨幅判定，以「成交额 + 换手率 + 主力资金」三者共振为龙头标准。",
    },
    {
      title: "只做突破确认",
      content: "趋势标的需放量突破平台/前高且站稳再介入，不博弈低位横盘反转。",
    },
    {
      title: "买强不买弱",
      content: "同一主线仅聚焦资金认可度最高的 1-3 只龙头，规避跟风杂毛股。",
    },
  ];

  return (
    <div className={cn(
      "fixed right-0 top-1/2 -translate-y-1/2 z-40 transition-all duration-300",
      collapsed ? "translate-x-[calc(100%-36px)]" : "translate-x-0",
    )}>
      <div className="flex">
        {/* Toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="shrink-0 w-9 h-24 flex items-center justify-center rounded-l-lg border border-r-0 bg-card hover:bg-muted transition-colors"
          title={collapsed ? "展开策略提示" : "收起策略提示"}
        >
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
          ) : (
            <PanelRightClose className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* Content */}
        {!collapsed && (
          <div className="w-64 rounded-l-lg border bg-card shadow-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-bold">短线实操策略</span>
            </div>
            {tips.map((tip, i) => (
              <div key={i} className={cn(
                "rounded-lg p-2.5 text-xs leading-relaxed",
                i % 2 === 0 ? "bg-muted/50" : "",
              )}>
                <p className="font-semibold text-foreground mb-0.5">{tip.title}</p>
                <p className="text-muted-foreground">{tip.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
