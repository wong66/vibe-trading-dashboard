import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const PROXY_PATHS = [
  "/sessions",
  "/swarm/presets",
  "/swarm/runs",
  "/settings/llm",
  "/settings/data-sources",
  "/mandate",
  "/live",
  "/upload",
  "/shadow-reports",
  "/market-data",
  "/industry-reports",
  "/stock-search",
  "/stock-kline",
  "/stock-fundamentals",
  "/stock-mcap-history",
  "/stock-quote",
  "/stock-consensus",
  "/stock-reports",
  "/sector-data",
];

// Smart Analysis proxy — catch-all for /smart-analysis/*
// The DSA backend runs as a dedicated service on :8000 and exposes its
// endpoints under /api/v1/*. We rewrite the public /smart-analysis prefix
// back to /api/v1 so the frontend stays unchanged.
const DSA_API_TARGET = "http://127.0.0.1:8000";
const SMART_ANALYSIS_PROXY = {
  target: DSA_API_TARGET,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/smart-analysis/, "/api/v1"),
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_URL || "http://127.0.0.1:8898";
  const apiProxy = { target: apiTarget, changeOrigin: true };
  const apiProxyWithHtmlFallback = {
    ...apiProxy,
    bypass(req: { headers: { accept?: string } }) {
      if (req.headers.accept?.includes("text/html")) {
        return "/index.html";
      }
    },
  };

  return {
    appType: "spa",
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 5899,
      proxy: {
        ...Object.fromEntries(PROXY_PATHS.map((p) => [p, apiProxy])),
        "/smart-analysis": SMART_ANALYSIS_PROXY,
        "^/runs/[^/]+/?$": apiProxyWithHtmlFallback,
        "/runs": apiProxy,
        "/correlation": apiProxyWithHtmlFallback,
        // alpha 因子库代理（字符串匹配，兼容性最好）
        "/alpha": apiProxy,
        // A股量化决策 API（只代理带具体路径的，前端路由 /aquant/signals /aquant/plans 等不走代理）
        "^/aquant/signals/": apiProxy,
        "^/aquant/plans": apiProxy,        // 含 /plans (列表/创建) + /plans/xxx (更新/删除)
        "^/aquant/review/": apiProxy,
        "^/aquant/delivery/": apiProxy,
        // market temperature / factors 等量化决策 API
        "^/aquant/market/": apiProxy,
        // astock-peg proxy → Next.js server on port 3000
        // rewrite: /peg-api/* → /api/* (astock-peg 的 API 路由在 /api/ 下)
        "^/peg-api/": {
          target: "http://127.0.0.1:3000",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/peg-api/, "/api"),
        },
        // Tencent quote API proxy (a-stock-data skill §1.2)
        "/tencent-quote": {
          target: "https://qt.gtimg.cn",
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/tencent-quote/, ""),
        },
      },
    },
    build: {
      // 单个 chunk 超过该体积只给警告、不影响产物（echarts 懒加载，属正常体积）
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-charts": ["echarts"],
          },
        },
      },
    },
  };
});
