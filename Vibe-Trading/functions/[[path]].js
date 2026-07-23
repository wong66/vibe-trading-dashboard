/**
 * Cloudflare Pages Functions — 边缘代理
 *
 * 作用：把浏览器（同源 Pages 域名）发来的 API 请求，在 Cloudflare 边缘
 * 转发到用户 Mac 上的后端（经 Cloudflare Tunnel），前端代码无需任何改动、
 * 也无需处理跨域（CORS）。非 API 请求则正常返回静态资源 / SPA 首页。
 *
 * 路由规则 100% 对齐 frontend/vite.config.ts 的 dev proxy：
 *   - 精确 API 路径 → 转发到 BACKEND_URL（Mac 后端 :8898，含 /smart-analysis）
 *   - /peg-api/*    → 转发到 BACKEND_PEG_URL（可选：astock-peg 服务 :3000）
 *   - /tencent-quote → 直接转发到腾讯行情 qt.gtimg.cn（尽力而为）
 *   - /correlation、/runs/<id>（无斜杠且 Accept:text/html）→ SPA 首页
 *   - 其余（含 /aquant/* 页面路由、静态资源）→ ASSETS，404 时回退 index.html
 */

// 精确匹配的 API 前缀（原 vite.config PROXY_PATHS + 额外固定前缀）
const EXACT_API = [
  "/sessions", "/swarm/presets", "/swarm/runs",
  "/settings/llm", "/settings/data-sources",
  "/mandate", "/live", "/upload", "/shadow-reports",
  "/market-data", "/industry-reports",
  "/stock-search", "/stock-kline", "/stock-fundamentals",
  "/stock-mcap-history", "/stock-quote", "/stock-consensus",
  "/stock-reports", "/sector-data",
  "/runs", "/correlation", "/alpha", "/smart-analysis",
];

// 返回 "api" | "spa" | "asset"
function routeKind(path, wantsHtml) {
  // html-fallback 路由：浏览器直接导航（Accept 含 text/html）时当作页面
  if (path === "/correlation") return wantsHtml ? "spa" : "api";
  if (/^\/runs\/[^/]+\/?$/.test(path)) return wantsHtml ? "spa" : "api";
  if (EXACT_API.some((x) => path === x || path.startsWith(x + "/"))) return "api";
  // /aquant 子路径（带斜杠）= API；裸页面路由 = SPA
  if (/^\/aquant\/(signals|plans|review|delivery|market)\//.test(path)) return "api";
  if (/^\/aquant\/(signals|plans|review|delivery|market)$/.test(path)) return "spa";
  return "asset";
}

function json(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function serveStatic(context) {
  const { request, env } = context;
  const resp = await env.ASSETS.fetch(request);
  if (resp.status === 404) {
    // SPA 回退：返回 index.html 让前端路由接管
    const idx = new URL("/index.html", new URL(request.url).origin);
    return env.ASSETS.fetch(new Request(idx, request));
  }
  return resp;
}

async function proxyPass(request, upstream) {
  const method = request.method;
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (lk === "host" || lk === "content-length") continue; // 让运行时重算
    headers.set(k, v);
  }
  const init = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer().catch(() => null);
  }
  // WebSocket 升级：交给运行时尽力隧道（Cloudflare 支持 fetch 透传 101）
  if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
    return fetch(upstream, { method: "GET", headers, redirect: "manual" });
  }
  return fetch(upstream, init);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");

  // 1) astock-peg 外围服务（可选）
  if (path.startsWith("/peg-api")) {
    if (!env.BACKEND_PEG_URL) {
      return json(503, "PEG 估值服务未配置：请在本机启动 astock-peg 并配置 BACKEND_PEG_URL");
    }
    const upstream =
      env.BACKEND_PEG_URL.replace(/\/$/, "") +
      path.replace(/^\/peg-api/, "/api") +
      url.search;
    return proxyPass(request, upstream);
  }

  // 2) 腾讯行情直连（尽力而为）
  if (path.startsWith("/tencent-quote")) {
    const upstream =
      "https://qt.gtimg.cn" + path.replace(/^\/tencent-quote/, "") + url.search;
    return proxyPass(request, upstream);
  }

  // 3) 主后端 / 智能分析：浏览器 → Pages 同源 → 边缘函数 fetch tunnel → Mac 后端
  //    （不再让浏览器直连 tunnel，避免浏览器侧 CORS/扩展/公司网拦截）
  const BACKEND_TUNNEL = env.BACKEND_TUNNEL_URL || "https://6a700475-2d33-4979-a6e0-897cb864f783.cfargotunnel.com";
  const kind = routeKind(path, wantsHtml);
  if (kind === "api") {
    const upstream = BACKEND_TUNNEL.replace(/\/$/, "") + path + url.search;
    return proxyPass(request, upstream);
  }
  if (kind === "spa") return serveStatic(context);
  return serveStatic(context);
}
