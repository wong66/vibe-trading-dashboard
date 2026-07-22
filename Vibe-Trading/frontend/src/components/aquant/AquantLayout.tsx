/**
 * A股量化决策 — 共享布局
 * 顶部 Tab 切换四个子模块：复盘雷达 / 主线决策 / 交易计划 / 交割单复盘
 * 默认进入「复盘雷达」（与 router /aquant 空路径一致）
 */

import { NavLink, Outlet } from "react-router-dom";
import { TrendingUp, ClipboardList, Target, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/aquant/review", label: "复盘雷达", icon: Target },
  { to: "/aquant/signals", label: "主线决策", icon: TrendingUp },
  { to: "/aquant/plans", label: "交易计划", icon: ClipboardList },
  { to: "/aquant/delivery", label: "交割单复盘", icon: FileBarChart },
];

export function AquantLayout() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部 Tab 栏 */}
      <div className="border-b bg-card/50 shrink-0">
        <div className="flex items-center gap-1 px-4 pt-2">
          <span className="text-sm font-semibold text-foreground mr-4 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            A股量化决策
          </span>
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* 子页面内容 */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
