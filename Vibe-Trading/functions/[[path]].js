/**
 * Cloudflare Pages Functions
 *
 * 架构（重要）：主后端 / 智能分析 / PEG 等 API 由【浏览器直连 Cloudflare Tunnel】
 * 完成，前端在生产构建时已注入 VITE_API_BASE（= 主隧道固定地址）。
 *
 * 之所以不能在此处代理主后端：Cloudflare Tunnel 域名解析到内部 ULA（fd10::），
 * 真实浏览器走 Cloudflare 公网 ingress 能正常路由；但 Pages Functions（Worker）
 * 的 fetch 解析到 fd10:: 后会被边缘拒绝
 * （"DNS points to local or disallowed IPv6 address"）。所以本 Functions【不】代理
 * 主后端，仅负责以下两件事：
 *   1) /tencent-quote → 直连腾讯行情 qt.gtimg.cn
 *      （前端以相对路径调用，请求落在 Pages 同源，由这里转发）
 *   2) 其余请求 → 静态资源 / SPA 首页回退（index.html 交给前端路由接管）
 */

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
  return fetch(upstream, init);
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 腾讯行情直连（前端以相对路径 /tencent-quote 调用，落在 Pages 同源）
  if (path.startsWith("/tencent-quote")) {
    const upstream =
      "https://qt.gtimg.cn" + path.replace(/^\/tencent-quote/, "") + url.search;
    return proxyPass(request, upstream);
  }

  // 其余一律走静态资源 / SPA 回退
  return serveStatic(context);
}
