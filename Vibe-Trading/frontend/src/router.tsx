import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AquantLayout } from "@/components/aquant/AquantLayout";

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Overview = lazy(() => import("@/pages/Overview").then((m) => ({ default: m.Overview })));
const HumanoidRobot = lazy(() => import("@/pages/HumanoidRobot").then((m) => ({ default: m.HumanoidRobot })));
const AICompute = lazy(() => import("@/pages/AICompute").then((m) => ({ default: m.AICompute })));
const StockBoard = lazy(() => import("@/pages/StockBoard").then((m) => ({ default: m.StockBoard })));
const AstockPeg = lazy(() => import("@/pages/AstockPeg").then((m) => ({ default: m.AstockPeg })));
const DailyPick = lazy(() => import("@/pages/DailyPick").then((m) => ({ default: m.DailyPick })));
const StockPick = lazy(() => import("@/pages/StockPick").then((m) => ({ default: m.StockPick })));
const SmartAnalysis = lazy(() => import("@/pages/SmartAnalysis").then((m) => ({ default: m.SmartAnalysis })));
const Agent = lazy(() => import("@/pages/Agent").then((m) => ({ default: m.Agent })));
const RunDetail = lazy(() =>
  import("@/pages/RunDetail").then((m) => ({ default: m.RunDetail })),
);
const Compare = lazy(() =>
  import("@/pages/Compare").then((m) => ({ default: m.Compare })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const Correlation = lazy(() =>
  import("@/pages/Correlation").then((m) => ({ default: m.Correlation })),
);
const AlphaZoo = lazy(() =>
  import("@/pages/AlphaZoo").then((m) => ({ default: m.AlphaZoo })),
);
const InvestmentNews = lazy(() =>
  import("@/pages/InvestmentNews").then((m) => ({ default: m.InvestmentNews })),
);
const OpportunityList = lazy(() =>
  import("@/pages/OpportunityList").then((m) => ({ default: m.OpportunityList })),
);

// A股量化决策 — 四个子模块
const AquantSignals = lazy(() => import("@/pages/AquantSignals").then((m) => ({ default: m.AquantSignals })));
const AquantPlans = lazy(() => import("@/pages/AquantPlans").then((m) => ({ default: m.AquantPlans })));
const AquantReview = lazy(() => import("@/pages/AquantReview").then((m) => ({ default: m.AquantReview })));
const AquantDelivery = lazy(() => import("@/pages/AquantDelivery").then((m) => ({ default: m.AquantDelivery })));

function PageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

function wrap(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: wrap(Home) },
      { path: "/overview", element: wrap(Overview) },
      { path: "/opportunity-list", element: wrap(OpportunityList) },
      { path: "/humanoid-robot", element: wrap(HumanoidRobot) },
      { path: "/ai-compute", element: wrap(AICompute) },
      { path: "/stock-board", element: wrap(StockBoard) },
      { path: "/astock-peg", element: wrap(AstockPeg) },
      { path: "/daily-pick", element: wrap(DailyPick) },
      { path: "/smart-analysis", element: wrap(SmartAnalysis) },
      { path: "/stock-pick", element: wrap(StockPick) },
      { path: "/investment-news", element: wrap(InvestmentNews) },
      { path: "/agent", element: wrap(Agent) },
      { path: "/settings", element: wrap(Settings) },
      { path: "/runs/:runId", element: wrap(RunDetail) },
      { path: "/compare", element: wrap(Compare) },
      { path: "/correlation", element: wrap(Correlation) },
      { path: "/alpha-zoo", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/bench", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/compare", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/:alphaId", element: wrap(AlphaZoo) },
      // A股量化决策 — 共享顶部 Tab 布局 + 子路由
      {
        path: "/aquant",
        element: <AquantLayout />,
        children: [
          { path: "signals", element: wrap(AquantSignals) },
          { path: "plans", element: wrap(AquantPlans) },
          { path: "review", element: wrap(AquantReview) },
          { path: "delivery", element: wrap(AquantDelivery) },
          { path: "", element: wrap(AquantReview) },  // 默认重定向到复盘雷达
        ],
      },
    ],
  },
]);
