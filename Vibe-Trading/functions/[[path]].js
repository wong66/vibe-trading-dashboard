/**
 * Cloudflare Pages Functions — Vibe-Trading
 *
 * 本文件被两种构建共用：
 *   1) 隧道版（VITE_API_BASE=Cloudflare Tunnel 地址）：前端 API 全部走隧道(cross-origin)，
 *      本 Function 实际只会收到 /tencent-quote（相对路径，同源）和静态资源请求。
 *      下方 /market-data、/stock-kline、/stock-search、分析类降级分支在隧道版中【不会被触发】
 *      （那些 API 请求不落在本 Pages 同源），因此对现有线上版零影响。
 *   2) 云端轻量版（VITE_API_BASE=""）：前端 API 全部同源，落到本 Function。
 *      行情类接口走边缘腾讯/新浪 HTTP（无需 Mac 开机）；分析类接口（aquant/sector-data 等）
 *      诚实降级，返回 200 + {error:"需本地后端在线"}，不假数据、不卡死。
 */

const TENCENT_QUOTE = "https://qt.gtimg.cn";
const SINA_KLINE =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
const GTIMG_SMARTBOX = "https://smartbox.gtimg.cn/s3/";

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// 腾讯 qt.gtimg.cn 返回 GBK 编码，必须显式用 GBK 解码，否则中文名乱码
async function fetchGbkText(url) {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = await resp.arrayBuffer();
  return new TextDecoder("gbk").decode(buf);
}

// 解析腾讯报价：v_sh600519="1~名字~代码~现价~昨收~今开~...~时间~涨跌~涨跌%~
// 标准字段索引：3=现价 4=昨收 5=今开 31=涨跌额 32=涨跌幅% 33=最高 34=最低 1=名称
function parseTencentQuotes(text) {
  const out = {};
  const re = /v_([A-Za-z0-9]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const code = m[1].toLowerCase();
    const f = m[2].split("~");
    if (f.length < 35) continue;
    const price = parseFloat(f[3]);
    if (!isFinite(price) || price <= 0) continue;
    const prevClose = parseFloat(f[4]);
    const open = parseFloat(f[5]);
    const changeAmt = parseFloat(f[31]);
    const changePct = parseFloat(f[32]);
    const high = parseFloat(f[33]);
    const low = parseFloat(f[34]);
    out[code] = {
      code,
      name: f[1] || code,
      price,
      change_amt: isFinite(changeAmt) ? changeAmt : 0,
      change_pct: isFinite(changePct) ? changePct : 0,
      open: isFinite(open) ? open : undefined,
      high: isFinite(high) ? high : undefined,
      low: isFinite(low) ? low : undefined,
      source: "tencent",
    };
  }
  return out;
}

// 把前端传入的代码规范成腾讯格式：6/9 开头→sh，0/3→sz，8→bj；已带前缀则保留
function normalizeCode(code) {
  const c = String(code || "").trim().toLowerCase();
  if (/^(sh|sz|bj)/.test(c)) return c;
  if (/^\d{6}$/.test(c)) {
    const p = c[0];
    if (p === "6" || p === "9") return "sh" + c;
    if (p === "8") return "bj" + c;
    return "sz" + c;
  }
  return c; // 美股/指数代号原样返回（非腾讯源，云端版降级）
}

// ── /market-data：A股指数 + 自选走腾讯报价；美股诚实降级 ────────────────
async function handleMarketData(url) {
  const idxRaw = (url.searchParams.get("indices") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const aRaw = (url.searchParams.get("stocks_a") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const usRaw = (url.searchParams.get("stocks_us") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const tencentCodes = [...idxRaw, ...aRaw].filter(
    (c) => /^(sh|sz|bj)/i.test(c) || /^\d{6}$/.test(c),
  );
  let parsed = {};
  if (tencentCodes.length) {
    const q = tencentCodes.map(normalizeCode).join(",");
    try {
      const txt = await fetchGbkText(`${TENCENT_QUOTE}/q=${encodeURIComponent(q)}`);
      parsed = parseTencentQuotes(txt);
    } catch (e) {
      parsed = {};
    }
  }

  const indices = {};
  for (const c of idxRaw) {
    const hit = parsed[normalizeCode(c)];
    if (hit) indices[c] = hit;
    else
      indices[c] = {
        code: c, name: c, price: 0, change_amt: 0, change_pct: 0,
        source: "tencent", error: "非A股指数行情需本地后端在线",
      };
  }

  const stocks_a = {};
  for (const c of aRaw) {
    const hit = parsed[normalizeCode(c)];
    if (hit)
      stocks_a[c] = {
        code: c, name: hit.name, price: hit.price, change_pct: hit.change_pct,
        source: "tencent",
      };
    else
      stocks_a[c] = {
        code: c, name: c, price: 0, change_pct: 0,
        source: "tencent", error: "行情获取失败",
      };
  }

  const stocks_us = {};
  for (const c of usRaw)
    stocks_us[c] = {
      code: c, name: c, price: 0, change_pct: 0,
      source: "unknown", error: "美股行情需本地后端(yfinance)",
    };

  return json({ indices, stocks_a, stocks_us, ts: Math.floor(Date.now() / 1000) });
}

// ── /stock-kline：A股走新浪K线；美股诚实降级 ──────────────────────────
async function handleStockKline(url) {
  const code = (url.searchParams.get("code") || "").trim();
  const market = (url.searchParams.get("market") || "A").toUpperCase();
  const period = (url.searchParams.get("period") || "5y").toLowerCase();
  const interval = url.searchParams.get("interval") || "1d";

  if (market !== "A") {
    return json({
      code, market, period, bars: [], ts: Date.now(),
      error: "美股K线需本地后端(yfinance)",
    });
  }
  const sym = normalizeCode(code);
  const scale = interval === "1wk" ? 1200 : 240;
  let datalen = 320;
  if (period.includes("max") || period.includes("5y")) datalen = 1024;
  else if (period.includes("3y")) datalen = 750;
  else if (period.includes("1y")) datalen = 256;

  try {
    const upstream = `${SINA_KLINE}?symbol=${sym}&scale=${scale}&ma=5&datalen=${datalen}`;
    const resp = await fetch(upstream, {
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const arr = await resp.json();
    if (!Array.isArray(arr) || !arr.length) {
      return json({ code, market: "A", period, bars: [], ts: Date.now(), error: "K线获取失败" });
    }
    const bars = arr.map((r) => ({
      time: r.day,
      open: +r.open,
      high: +r.high,
      low: +r.low,
      close: +r.close,
      volume: +r.volume,
    }));
    return json({ code, market: "A", period, bars, ts: Date.now() });
  } catch (e) {
    return json({ code, market: "A", period, bars: [], ts: Date.now(), error: "K线获取失败" });
  }
}

// ── /stock-search：腾讯 smartbox（仅A股） ─────────────────────────────
async function handleStockSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ q, results: [] });
  try {
    const upstream = `${GTIMG_SMARTBOX}?v=2&t=all&q=${encodeURIComponent(q)}`;
    const txt = await (await fetch(upstream)).text();
    const m = txt.match(/v_hint="([^"]*)"/);
    const results = [];
    if (m) {
      for (const entry of m[1].split(";")) {
        const p = entry.split("~");
        if (p.length < 3) continue;
        const marketPrefix = p[0].toLowerCase();
        const code = p[1];
        const name = p[2];
        if (!/^(sh|sz|bj)/.test(marketPrefix)) continue; // 只收A股
        results.push({ code, name, market: "A", exchange: marketPrefix });
        if (results.length >= 10) break;
      }
    }
    return json({ q, results });
  } catch (e) {
    return json({ q, results: [], error: "搜索失败" });
  }
}

// 分析类后端API：云端版（Mac 关机）无法运行，诚实降级。
// 排除 SPA 路由（/correlation、/runs/:id）以免破坏前端路由。
function isDegradableApi(path) {
  if (path === "/runs") return true; // 列表API；/runs/:id 留给 SPA
  const prefixes = [
    "/aquant", "/sector-data", "/stock-fundamentals", "/stock-consensus",
    "/stock-reports", "/stock-reports-summary", "/stock-mcap-history",
    "/industry-reports", "/peg-api",
    "/sessions", "/swarm", "/alpha", "/live", "/mandate", "/settings", "/upload",
  ];
  return prefixes.some(
    (p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"),
  );
}

function degrade() {
  return json({
    error: "该模块需本地后端在线（Mac 开机后可用）",
    data: null,
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 腾讯行情直连（前端以相对路径 /tencent-quote 调用，落在 Pages 同源）
  if (path.startsWith("/tencent-quote")) {
    const upstream =
      TENCENT_QUOTE + path.replace(/^\/tencent-quote/, "") + url.search;
    return proxyPass(request, upstream);
  }

  // ── 云端轻量版边缘接口（仅当 VITE_API_BASE="" 时前端会落到这里）──
  if (path === "/market-data") return handleMarketData(url);
  if (path === "/stock-kline") return handleStockKline(url);
  if (path === "/stock-search") return handleStockSearch(url);

  // 分析类后端API：诚实降级（不影响隧道版，因其API走跨域不落同源）
  if (isDegradableApi(path)) return degrade();

  // 其余一律走静态资源 / SPA 回退
  return serveStatic(context);
}
