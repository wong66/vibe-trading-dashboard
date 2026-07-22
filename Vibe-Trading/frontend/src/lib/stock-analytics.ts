// Stock dashboard analytics — pure functions.
// All formulas mirror the Excel sheet 「中国中棉-估值有点高.xlsx」逻辑，
// 这样分析口径在 Excel 和 Web 看板上完全一致。

export type Fundamentals = {
  period: string;            // 报告期 YYYY-MM-DD
  revenue: number;           // 营业收入(亿) 单季
  op_cost: number;           // 营业成本(亿) 单季
  net_profit: number;        // 归母净利润(亿) 单季
  deducted_profit: number;   // 扣非净利润(亿) 单季
  op_cashflow: number;       // 经营性现金流净额(亿) 单季
  sales_cashflow?: number;   // 销售商品、提供劳务收到的现金(亿) 单季
  gross_margin: number;      // 毛利率 %
  net_margin: number;        // 净利率 %
  roe: number;               // ROE TTM %
  sell_exp: number;          // 销售费用(亿) 单季
  admin_exp: number;         // 管理费用(亿) 单季
  rd_exp: number;            // 研发费用(亿) 单季
  net_asset: number;         // 净资产(亿)
  ar: number;                // 应收账款(亿)
  // ── 资产负债结构（亿元，单期） ──
  bs_cash?: number | null;        // 货币资金
  bs_ar?: number | null;          // 应收账款
  bs_prepay?: number | null;      // 预付款项
  bs_inventory?: number | null;   // 存货
  bs_other_ca?: number | null;    // 其他流动资产
  bs_lt_invest?: number | null;   // 长期股权投资
  bs_fixed?: number | null;       // 固定资产
  bs_intangible?: number | null;  // 无形资产
  bs_other_nca?: number | null;   // 其他非流动资产
  bs_st_debt?: number | null;     // 短期借款
  bs_ap?: number | null;          // 应付账款
  bs_contract_liab?: number | null; // 合同负债
  bs_salary_tax?: number | null;  // 应付职工薪酬
  bs_other_cl?: number | null;    // 其他流动负债
  bs_lt_debt?: number | null;     // 长期借款
  bs_other_ncl?: number | null;   // 其他非流动负债
  ttm?: {                    // 近 4 季累计(亿)
    revenue: number | null;
    net_profit: number | null;
    deducted_profit: number | null;
    op_cashflow: number | null;
    sales_cashflow?: number | null;
    sell_exp?: number | null;
    admin_exp?: number | null;
    rd_exp?: number | null;
    op_cost?: number | null;
  };
  ttm_window?: boolean;      // 是否有完整 4 季窗口
  revenue_yoy?: number | null;
  net_profit_yoy?: number | null;
  deducted_profit_yoy?: number | null;
  op_cashflow_yoy?: number | null;
};

export type Quote = {
  code: string;
  name: string;
  price: number;
  change_amt: number;
  change_pct: number;
  mcap?: number;             // 总市值(亿)
  float_mcap?: number;       // 流通市值(亿)
  pe_ttm?: number;
  pb?: number;
  turnover_pct?: number;
  open?: number;
  high?: number;
  low?: number;
  last_close?: number;
  source?: string;
  error?: string;
};

export type Bar = { time: string; open: number; high: number; low: number; close: number; volume: number };

// ── helpers ────────────────────────────────────────────────────────────

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v as number)) return "—";
  const n = v as number;
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 100) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v as number)) return "—";
  const n = v as number;
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

export function pctRaw(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v as number)) return "—";
  return `${(v as number).toFixed(digits)}%`;
}

// TTM (Trailing Twelve Months) — periods are sorted descending. We take latest
// 4 quarters as the rolling TTM window when periods are quarterly.
export function computeTTM(periods: Fundamentals[]): Fundamentals {
  if (!periods.length) return emptyFund();
  return periods[0];
}

export function emptyFund(): Fundamentals {
  return {
    period: "", revenue: 0, op_cost: 0, net_profit: 0, deducted_profit: 0,
    op_cashflow: 0, gross_margin: 0, net_margin: 0, roe: 0,
    sell_exp: 0, admin_exp: 0, rd_exp: 0, net_asset: 0, ar: 0,
  };
}

// ── 1. 市值与业绩增长趋势 ──────────────────────────────────────────────

export type GrowthMetrics = {
  // TTM
  ttm: { revenue: number; net_profit: number; deducted_profit: number; mcap: number };
  ttmYoY: { revenue: number | null; net_profit: number | null; deducted_profit: number | null; mcap: number | null };
  reportYoY: { revenue: number | null; net_profit: number | null; deducted_profit: number | null };
};

export function calcGrowth(periods: Fundamentals[], quote: Quote | null): GrowthMetrics {
  if (!periods.length) {
    return {
      ttm: { revenue: 0, net_profit: 0, deducted_profit: 0, mcap: quote?.mcap ?? 0 },
      ttmYoY: { revenue: null, net_profit: null, deducted_profit: null, mcap: null },
      reportYoY: { revenue: null, net_profit: null, deducted_profit: null },
    };
  }
  const cur = periods[0];
  // Prefer backend-computed TTM window (4-quarter sum) and YoY% (TTM vs TTM).
  const ttm = cur.ttm ?? null;
  const ttmRev = ttm?.revenue ?? 0;
  const ttmNp = ttm?.net_profit ?? 0;
  const ttmDed = ttm?.deducted_profit ?? 0;

  // Report period YoY: previous report period (4 quarters earlier) — current period's "single quarter" value
  // For Excel view, "报告期" 单季同比 = cur.revenue (单季) vs periods[4].revenue (单季，去年的当季)
  const reportBase = periods[4] ?? periods[periods.length - 1];

  return {
    ttm: {
      revenue: ttmRev,
      net_profit: ttmNp,
      deducted_profit: ttmDed,
      mcap: quote?.mcap ?? 0,
    },
    ttmYoY: {
      // Backend returns YoY% in percentage (e.g. -6.03 means -6.03%); convert to
      // a fractional value so pct() can multiply by 100 once.
      revenue: cur.revenue_yoy != null ? cur.revenue_yoy / 100 : null,
      net_profit: cur.net_profit_yoy != null ? cur.net_profit_yoy / 100 : null,
      deducted_profit: cur.deducted_profit_yoy != null ? cur.deducted_profit_yoy / 100 : null,
      mcap: null, // market cap YoY needs price history
    },
    reportYoY: {
      revenue: reportBase.revenue ? cur.revenue / reportBase.revenue - 1 : null,
      net_profit: reportBase.net_profit !== 0 ? (cur.net_profit - reportBase.net_profit) / Math.abs(reportBase.net_profit || 1) : null,
      deducted_profit: reportBase.deducted_profit !== 0 ? (cur.deducted_profit - reportBase.deducted_profit) / Math.abs(reportBase.deducted_profit || 1) : null,
    },
  };
}

function isOneYearAgo(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ay = parseInt(a.slice(0, 4));
  const by = parseInt(b.slice(0, 4));
  return by - ay === 1 && a.slice(5, 7) === b.slice(5, 7);
}

// ── 2. 主营收入 & 经营现金流 ──────────────────────────────────────────

export function revenueAndCashSeries(periods: Fundamentals[]) {
  // Display oldest → newest (left → right). Backend returns newest-first.
  // 营收使用 TTM（近4个单季累计），与 MetricCard 「营收 TTM」一致；
  // 销售商品现金流同样使用 TTM（与营收同口径的累计视角）。
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    revenue: ordered.map(p => p.ttm?.revenue ?? p.revenue),
    salesCash: ordered.map(p =>
      // 优先 ttm.sales_cashflow；缺则回退 ttm.op_cashflow；再回退单季
      p.ttm?.sales_cashflow
      ?? p.ttm?.op_cashflow
      ?? p.sales_cashflow
      ?? p.op_cashflow
      ?? 0
    ),
  };
}

// ── 3. 净利润 & 现金流净值趋势 + 净现比 ─────────────────────────────

export function profitAndCashSeries(periods: Fundamentals[]) {
  // 归母净利 & 扣非净利 切换为 TTM，与「净利 TTM」「扣非 TTM」卡片同口径；
  // 经营现金流同步切换为 TTM，与图二的销售商品现金流累计视角一致。
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    netProfit: ordered.map(p => p.ttm?.net_profit ?? p.net_profit),
    deducted: ordered.map(p => p.ttm?.deducted_profit ?? p.deducted_profit),
    opCash: ordered.map(p => p.ttm?.op_cashflow ?? p.op_cashflow),
  };
}

export function netCashRatio(periods: Fundamentals[]): { ratio: number | null; ratio2: number | null } {
  const cur = periods[0];
  if (!cur) return { ratio: null, ratio2: null };
  // 净现比（TTM 口径）= 经营性现金流 TTM / 扣非净利 TTM
  const cur_op_cf = cur.ttm?.op_cashflow ?? cur.op_cashflow;
  const cur_deducted = cur.ttm?.deducted_profit ?? cur.deducted_profit;
  const cur_net = cur.ttm?.net_profit ?? cur.net_profit;
  return {
    ratio: cur_deducted ? cur_op_cf / cur_deducted : null,
    ratio2: cur_net ? cur_op_cf / cur_net : null,
  };
}

// ── 5. 毛利率/净利率/ROE ────────────────────────────────────────────

export function marginSeries(periods: Fundamentals[]) {
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    gross: ordered.map(p => p.gross_margin),
    net: ordered.map(p => p.net_margin),
    roe: ordered.map(p => p.roe),
  };
}

// ── 5·2. 成本与毛利率分析（蓝柱=营收TTM, 红柱=成本TTM, 绿线=毛利率%） ──

export function costMarginSeries(periods: Fundamentals[]) {
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    revenue: ordered.map(p => p.ttm?.revenue ?? null),
    cost: ordered.map(p => p.ttm?.op_cost ?? null),
    margin: ordered.map(p => p.gross_margin),
  };
}

// ── 6. 三费占比 ─────────────────────────────────────────────────────

export function expenseRatioSeries(periods: Fundamentals[]) {
  // 三费/营收 TTM 比率 + 营收 TTM 柱数据 + 各费用 TTM 金额（亿）
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    sell: ordered.map(p => (p.ttm?.revenue ? ((p.ttm?.sell_exp ?? p.sell_exp) / p.ttm.revenue) * 100 : 0)),
    admin: ordered.map(p => (p.ttm?.revenue ? ((p.ttm?.admin_exp ?? p.admin_exp) / p.ttm.revenue) * 100 : 0)),
    rd: ordered.map(p => (p.ttm?.revenue ? ((p.ttm?.rd_exp ?? p.rd_exp) / p.ttm.revenue) * 100 : 0)),
    // TTM 营收（亿） — 主 Y 轴柱
    revenue: ordered.map(p => p.ttm?.revenue ?? p.revenue),
    // TTM 费用金额（亿） — 标签 & tooltip
    sell_amt: ordered.map(p => p.ttm?.sell_exp ?? p.sell_exp),
    admin_amt: ordered.map(p => p.ttm?.admin_exp ?? p.admin_exp),
    rd_amt: ordered.map(p => p.ttm?.rd_exp ?? p.rd_exp),
  };
}

// ── 7. 近五年综合增长率 ────────────────────────────────────────────

// ── 7. 业绩 & 市值双轴图（K-line 收盘价 × 总股本 推历史市值） ─────────

export type McapPoint = { period: string; revenue: number; mcap: number };

/**
 * 营收 TTM 柱（按季报期，X 轴 = 季度末日期 YYYY-MM-DD）
 * 数据来自 periods[*].ttm.revenue
 */
export function revenueBarSeries(periods: Fundamentals[]): { dates: string[]; revenue: number[] } {
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    revenue: ordered.map(p => p.ttm?.revenue ?? p.revenue),
  };
}

/**
 * 市值线（按周，X 轴 = 该周最后交易日 YYYY-MM-DD）
 * 数据来自 /stock-mcap-history（a-stock-data：mootdx 日线 + 推算市值）
 */
export function mcapLineSeries(
  mcapHistory: { month: string; date?: string; mcap_yi: number }[],
): { dates: string[]; mcap: number[]; hasMcap: boolean } {
  const weekly: { date: string; mcap: number }[] = [];
  for (const m of mcapHistory) {
    const d = (m.date || m.month).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) weekly.push({ date: d, mcap: m.mcap_yi });
  }
  weekly.sort((a, b) => a.date.localeCompare(b.date));
  return {
    dates: weekly.map(w => w.date),
    mcap: weekly.map(w => w.mcap),
    hasMcap: weekly.some(w => w.mcap > 0),
  };
}

/** 单图合并 series：X 轴 = 每周最后交易日（YYYY-MM-DD），柱 = 营收 TTM（按季 forward-fill），线 = 市值 */
export function revenueMcapSeries(
  periods: Fundamentals[],
  mcapHistory: { month: string; date?: string; mcap_yi: number }[],
): { dates: string[]; revenue: (number | null)[]; mcap: (number | null)[]; hasMcap: boolean; hasRevenue: boolean } {
  const ordered = [...periods].reverse();
  const periodList = ordered.map(p => ({ period: p.period, rev: p.ttm?.revenue ?? p.revenue }));

  // 收集每周点
  const weekly: { date: string; mcap: number }[] = [];
  for (const m of mcapHistory) {
    const d = (m.date || m.month).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && m.mcap_yi > 0) weekly.push({ date: d, mcap: m.mcap_yi });
  }
  weekly.sort((a, b) => a.date.localeCompare(b.date));

  if (!weekly.length) {
    // 无市值时只画营收柱（X 轴 = 季度）
    return {
      dates: periodList.map(p => p.period),
      revenue: periodList.map(p => p.rev),
      mcap: periodList.map(_ => null),
      hasMcap: false,
      hasRevenue: periodList.some(p => p.rev > 0),
    };
  }

  // X 轴 = 所有周日期
  const dates = weekly.map(w => w.date);
  const mcap = weekly.map(w => w.mcap);

  // 营收：每个季报日映射到「<= 该日的最后一个周聚合点」，那一周画一个柱子
  // 季报日 06-30 → 之前最近周聚合（可能是 06-27 那周），其他周 null
  // 季报日 12-31 → 12 月最后一个周
  // 如果多季映射到同一周（极少见，比如 periodList 异常），后者覆盖
  const revenue: (number | null)[] = new Array(weekly.length).fill(null);
  for (const pr of periodList) {
    let lastIdx = -1;
    for (let i = 0; i < weekly.length; i++) {
      if (weekly[i].date <= pr.period) lastIdx = i;
      else break;
    }
    if (lastIdx >= 0) {
      revenue[lastIdx] = pr.rev;
    }
  }

  return {
    dates,
    revenue,
    mcap,
    hasMcap: true,
    hasRevenue: revenue.some(v => v != null && v > 0),
  };
}

/**
 * 近 N 年综合增长率（CAGR）
 * - 营收/净利/净资产：基于季报 singleQ 数据，N 年前 = N*4 季度前
 * - 市值：基于 /stock-mcap-history 周线市值数据
 *   取离"N 年前"最近的周点，避免"恰好没有那一周"导致 null
 */
export function nYearGrowth(
  periods: Fundamentals[],
  years: number,
  mcapHistory?: { month: string; date?: string; mcap_yi: number }[],
) {
  const cur = periods[0];
  if (!cur) return { marketCap: null, revenue: null, profit: null, netAsset: null, profitLabel: "", mcapSource: "" };
  const base = periods[years * 4] ?? periods[periods.length - 1];

  const curTTM = cur.ttm ?? null;
  const baseTTM = base.ttm ?? null;

  const revenue = baseTTM?.revenue
    ? baseTTM.revenue > 0
      ? Math.pow((curTTM?.revenue ?? cur.revenue) / (baseTTM.revenue), 1 / years) - 1
      : null
    : base.revenue > 0 ? Math.pow((curTTM?.revenue ?? cur.revenue) / base.revenue, 1 / years) - 1 : null;
  const netAsset = base.net_asset > 0 ? Math.pow(cur.net_asset / base.net_asset, 1 / years) - 1 : null;

  let profit: number | null = null;
  let label = "";
  const curNP = curTTM?.net_profit ?? cur.net_profit;
  const baseNP = baseTTM?.net_profit ?? base.net_profit;
  if (baseNP > 0) {
    profit = curNP > 0
      ? Math.pow(curNP / baseNP, 1 / years) - 1
      : -(Math.pow(Math.abs(curNP) / baseNP, 1 / years));
    label = curNP > baseNP ? "盈利增长" : "盈利下滑";
  } else if (baseNP < 0) {
    if (curNP > 0) {
      profit = (curNP - Math.abs(baseNP)) / (years * Math.abs(baseNP));
      label = "扭亏为盈";
    } else {
      const ratio = curNP / baseNP;
      profit = Math.pow(ratio, 1 / years) - 1;
      label = Math.abs(curNP) < Math.abs(baseNP) ? "亏损收窄" : "亏损扩大";
    }
  }

  // 市值 CAGR：用周线数据计算
  let marketCap: number | null = null;
  let mcapSource = "";
  if (mcapHistory && mcapHistory.length) {
    const weekly: { date: string; mcap: number }[] = [];
    for (const m of mcapHistory) {
      const d = (m.date || m.month).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && m.mcap_yi > 0) weekly.push({ date: d, mcap: m.mcap_yi });
    }
    weekly.sort((a, b) => a.date.localeCompare(b.date));
    if (weekly.length >= 2) {
      const latest = weekly[weekly.length - 1];
      const targetMs = new Date(latest.date).getTime() - years * 365.25 * 24 * 3600 * 1000;
      let best = weekly[0];
      let bestDiff = Math.abs(new Date(weekly[0].date).getTime() - targetMs);
      for (const w of weekly) {
        const diff = Math.abs(new Date(w.date).getTime() - targetMs);
        if (diff < bestDiff) { best = w; bestDiff = diff; }
      }
      if (best.mcap > 0) {
        marketCap = Math.pow(latest.mcap / best.mcap, 1 / years) - 1;
        mcapSource = `${best.date} → ${latest.date}`;
      }
    }
  }

  return {
    marketCap,
    revenue,
    profit,
    netAsset,
    profitLabel: label,
    mcapSource,
  };
}

/** 兼容旧调用 */
export function fiveYearGrowth(
  periods: Fundamentals[],
  mcapHistory?: { month: string; date?: string; mcap_yi: number }[],
) {
  return nYearGrowth(periods, 5, mcapHistory);
}

// ── 8. 资产负债结构（用于堆叠柱状图）────────────────────────────────

/** 资产负债结构 - 单期详图（按用户截图的颜色和顺序） */
export const BS_STRUCTURE_LEGEND = [
  // 资产 — 蓝色系
  { key: "bs_cash",          name: "货币资金",         color: "#93c5fd" },
  { key: "bs_ar",            name: "应收账款",         color: "#60a5fa" },
  { key: "bs_prepay",        name: "预付款项",         color: "#3b82f6" },
  { key: "bs_inventory",     name: "存货",             color: "#2563eb" },
  { key: "bs_other_ca",      name: "其他流动资产",     color: "#1d4ed8" },
  { key: "bs_lt_invest",     name: "长期股权投资",     color: "#1e40af" },
  { key: "bs_fixed",         name: "固定资产",         color: "#1e3a8a" },
  { key: "bs_intangible",    name: "无形资产",         color: "#172554" },
  { key: "bs_other_nca",     name: "其他非流动资产",   color: "#0f172a" },
  // 负债 — 橙红系
  { key: "bs_st_debt",       name: "短期借款",         color: "#fca5a5" },
  { key: "bs_ap",            name: "应付账款",         color: "#f87171" },
  { key: "bs_contract_liab", name: "合同负债",         color: "#ef4444" },
  { key: "bs_salary_tax",    name: "应付职工薪酬",     color: "#dc2626" },
  { key: "bs_other_cl",      name: "其他流动负债",     color: "#b91c1c" },
  { key: "bs_lt_debt",       name: "长期借款",         color: "#991b1b" },
  { key: "bs_other_ncl",     name: "其他非流动负债",   color: "#7f1d1d" },
];

/** 取单期资产负债明细（资产/负债/所有者权益汇总） */
export function buildBalanceStructure(p: Fundamentals | undefined) {
  if (!p) return { date: "", asset: 0, debt: 0, equity: 0, items: [] as { name: string; value: number; color: string; isDebt: boolean }[] };
  const items: { name: string; value: number; color: string; isDebt: boolean }[] = [];
  let asset = 0;
  let debt = 0;
  for (const it of BS_STRUCTURE_LEGEND) {
    const v = (p as any)[it.key];
    if (typeof v === "number" && v > 0) {
      const isDebt = it.key === "bs_st_debt" || it.key === "bs_ap" || it.key === "bs_contract_liab" ||
        it.key === "bs_salary_tax" || it.key === "bs_other_cl" || it.key === "bs_lt_debt" || it.key === "bs_other_ncl";
      items.push({ name: it.name, value: v, color: it.color, isDebt });
      if (isDebt) debt += v; else asset += v;
    }
  }
  return { date: p.period, asset, debt, equity: p.net_asset || 0, items };
}

export const BS_LEGEND = [
  { key: "cash",         name: "总现金",         color: "#93c5fd" },
  { key: "ar",           name: "应收款",         color: "#60a5fa" },
  { key: "prepay",       name: "预付款",         color: "#3b82f6" },
  { key: "inventory",    name: "存货",           color: "#2563eb" },
  { key: "other_ca",     name: "其他流动资产",   color: "#1d4ed8" },
  { key: "lt_invest",    name: "长期投资",       color: "#1e40af" },
  { key: "fixed",        name: "固定资产",       color: "#1e3a8a" },
  { key: "intangible",   name: "无形资产",       color: "#172554" },
  { key: "other_nca",    name: "其他非流动资产", color: "#0f172a" },
  { key: "st_debt",      name: "短期借款",       color: "#fca5a5" },
  { key: "ap",           name: "应付账款",       color: "#f87171" },
  { key: "contract_liab",name: "合同负债",       color: "#ef4444" },
  { key: "salary_tax",   name: "薪酬和税务",     color: "#dc2626" },
  { key: "other_cl",     name: "其他流动负债",   color: "#b91c1c" },
  { key: "lt_debt",      name: "长期借款",       color: "#991b1b" },
  { key: "other_ncl",    name: "其他长期负债",   color: "#7f1d1d" },
];

// 简化版：使用财务快照里的 net_asset / ar / 营业收入/营业成本 等粗略构造堆叠图
// 实际后端若能返回完整三表则可更精细，这里给一个粗略但能展示结构的图。
export function buildBalanceSheetStack(periods: Fundamentals[]) {
  // 简化映射：把每期的 totalAsset = 1.5 * netAsset, 按比例分配
  return periods.slice(0, 8).reverse().map(p => {
    const totalAsset = (p.net_asset || 1) * 1.5;
    const totalDebt = totalAsset * 0.4;
    const cash = totalAsset * 0.2;
    const ar = p.ar || totalAsset * 0.15;
    const fixed = totalAsset * 0.25;
    const inventory = totalAsset * 0.12;
    const otherAsset = totalAsset * 0.28 - cash - ar - fixed - inventory;
    return {
      period: p.period,
      // 资产部分
      cash,
      ar,
      inventory,
      fixed,
      otherAsset: Math.max(0, otherAsset),
      // 负债部分 (堆叠时同符号)
      st_debt: totalDebt * 0.4,
      ap: totalDebt * 0.3,
      other_debt: totalDebt * 0.3,
    };
  });
}

// ── 9. 应收账款/总营收 ──────────────────────────────────────────────

export function arToRevenueSeries(periods: Fundamentals[]) {
  // 应收/营收图：营收切到 TTM（与上方图表保持一致口径），
  // 应收账款本身是时点指标，保持原值。
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    ar: ordered.map(p => p.ar),
    revenue: ordered.map(p => p.ttm?.revenue ?? p.revenue),
    arRatio: ordered.map(p => {
      const ttmRev = p.ttm?.revenue ?? p.revenue;
      return ttmRev ? (p.ar / ttmRev) * 100 : 0;
    }),
  };
}

// ── 9·2. 应付账款 / 总营收 ──────────────────────────────────────────

export function apToRevenueSeries(periods: Fundamentals[]) {
  const ordered = [...periods].reverse();
  return {
    dates: ordered.map(p => p.period),
    ap: ordered.map(p => (p as any).bs_ap ?? 0),
    revenue: ordered.map(p => p.ttm?.revenue ?? p.revenue),
    apRatio: ordered.map(p => {
      const ttmRev = p.ttm?.revenue ?? p.revenue;
      const ap = (p as any).bs_ap ?? 0;
      return ttmRev ? (ap / ttmRev) * 100 : 0;
    }),
  };
}

// ── 9·3. PE / PS 历史趋势系列 ────────────────────────────────────────

export interface PePsPoint {
  period: string;
  pe: number | null;
  ps: number | null;
  mcap: number;
}

/**
 * 基于季报 TTM 和市值历史计算各报告期的 PE/PS
 * 市值使用该报告期结束日期最近一周的市值数据
 */
export function pePsSeries(
  periods: Fundamentals[],
  mcapHistory: { month: string; date?: string; mcap_yi: number }[],
): {
  periods: string[];
  pe: (number | null)[];
  ps: (number | null)[];
  peMean: number | null;
  peStd: number | null;
  psMean: number | null;
  psStd: number | null;
} {
  // 收集周市值数据
  const weekly: { date: string; mcap: number }[] = [];
  for (const m of mcapHistory) {
    const d = (m.date || m.month).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && m.mcap_yi > 0) weekly.push({ date: d, mcap: m.mcap_yi });
  }
  weekly.sort((a, b) => a.date.localeCompare(b.date));

  const ordered = [...periods].reverse();
  const periodLabels: string[] = [];
  const peValues: (number | null)[] = [];
  const psValues: (number | null)[] = [];

  for (const p of ordered) {
    periodLabels.push(p.period);
    // TTM 必须存在才计算 PE/PS，不回退到单季值（单季数据会严重扭曲估值）
    const ttmRev = p.ttm?.revenue;
    const ttmNp = p.ttm?.deducted_profit ?? p.ttm?.net_profit;

    // 找到该报告期结束日最近 ≤period 的周市值
    let mcap = 0;
    if (weekly.length > 0) {
      let lastIdx = -1;
      for (let i = 0; i < weekly.length; i++) {
        if (weekly[i].date <= p.period) lastIdx = i;
        else break;
      }
      if (lastIdx >= 0) mcap = weekly[lastIdx].mcap;
    }

    const ps = ttmRev != null && ttmRev > 0 && mcap > 0 ? mcap / ttmRev : null;
    const pe = ttmNp != null && ttmNp > 0 && mcap > 0 ? mcap / ttmNp : null;

    psValues.push(ps);
    peValues.push(pe);
  }

  // 计算均值和标准差（仅对有效值）
  const validPe = peValues.filter(v => v != null) as number[];
  const validPs = psValues.filter(v => v != null) as number[];

  // ── 异常值处理：微利季度导致 PE/PS 爆炸（如 400+），会拉垮整张图 ──
  // 策略：用 IQR 检测异常值 → 截断为 null（不参与均值计算 + 图上断开）
  // 硬上限：PE > 500 或 PS > 100 视为无意义爆炸值，直接剔除
  const CLEAN = (
    raw: (number | null)[],
    hardCap: number,
  ): { clean: (number | null)[]; stats: { mean: number | null; std: number | null } } => {
    const arr = raw.filter((v): v is number => v != null && v <= hardCap);
    if (arr.length < 2) {
      return {
        clean: raw.map(v => (v != null && v <= hardCap ? v : null)),
        stats: { mean: null, std: null },
      };
    }
    // IQR 异常值检测
    const sorted = [...arr].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    // 上界 = Q3 + 3*IQR（宽松，只剔除极端离群点）；同时不超过 hardCap
    const upperBound = Math.min(q3 + 3 * iqr, hardCap);

    // 截断：超界的值设为 null（图上 connectNulls 会跳过该点）
    const clean = raw.map(v =>
      v != null && v <= upperBound ? v : null,
    );
    // 均值/标准差仅基于未截断的有效值
    const validForStats = clean.filter((v): v is number => v != null);
    if (validForStats.length < 2) {
      return { clean, stats: { mean: null, std: null } };
    }
    const mean = validForStats.reduce((a, b) => a + b, 0) / validForStats.length;
    const variance = validForStats.reduce((s, v) => s + (v - mean) ** 2, 0) / validForStats.length;
    return { clean, stats: { mean, std: Math.sqrt(variance) } };
  };

  const peResult = CLEAN(validPe, /* hardCap */ 500);
  const psResult = CLEAN(validPs, /* hardCap */ 100);

  return {
    periods: periodLabels,
    pe: peResult.clean,
    ps: psResult.clean,
    peMean: peResult.stats.mean,
    peStd: peResult.stats.std,
    psMean: psResult.stats.mean,
    psStd: psResult.stats.std,
  };
}

/**
 * 周度 PE / PS 序列（密集版，与 RevenueMcapChart 同粒度）
 *
 * X 轴 = 每周最后交易日（与市值图一致），每个点用「该周最近季度的 TTM 利润/营收」forward-fill 计算。
 * 效果：几百个数据点，趋势线连续平滑，不再只有 ~20 个季度稀疏点。
 */
export function pePsWeeklySeries(
  periods: Fundamentals[],
  mcapHistory: { month: string; date?: string; mcap_yi: number }[],
): {
  dates: string[];
  pe: (number | null)[];
  ps: (number | null)[];
  peMean: number | null;
  peStd: number | null;
  psMean: number | null;
  psStd: number | null;
} {
  // ── 1. 收集周市值（与 revenueMcapSeries 逐行一致）──
  const weekly: { date: string; mcap: number }[] = [];
  for (const m of mcapHistory) {
    const d = (m.date || m.month || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && m.mcap_yi > 0) weekly.push({ date: d, mcap: m.mcap_yi });
  }
  weekly.sort((a, b) => a.date.localeCompare(b.date));

  if (!weekly.length) {
    return { dates: [], pe: [], ps: [], peMean: null, peStd: null, psMean: null, psStd: null };
  }

  // ── 2. 构建季度 TTM 查找表（按报告期升序，最旧在前）──
  const ttmList: { period: string; rev: number | null; np: number | null }[] = periods
    .filter((p): p is Fundamentals => !!p && !!p.period)
    .map((p) => ({
      period: p.period,
      rev: p.ttm?.revenue ?? null,
      np: p.ttm?.deducted_profit != null ? p.ttm.deducted_profit : (p.ttm?.net_profit ?? null),
    }))
    .filter((t) => !!t.period)
    .sort((a, b) => a.period.localeCompare(b.period));

  // 无任何基本面数据时，X 轴仍给周度日期，PE/PS 全 null（不崩溃）
  if (!ttmList.length) {
    return {
      dates: weekly.map((w) => w.date),
      pe: weekly.map(() => null),
      ps: weekly.map(() => null),
      peMean: null,
      peStd: null,
      psMean: null,
      psStd: null,
    };
  }

  // ── 3. 周度 forward-fill：取「<= 该周的最近已发布季度」TTM ──
  // 亏损季度净利润为负 → PE 无意义，用「最近一次为正」的净利润延续（与市值图连续显示一致）
  const peValues: (number | null)[] = [];
  const psValues: (number | null)[] = [];
  let ttmIdx = -1;
  let lastPosRev: number | null = null;
  let lastPosNp: number | null = null;

  for (const w of weekly) {
    while (ttmIdx < ttmList.length - 1 && ttmList[ttmIdx + 1].period <= w.date) {
      ttmIdx++;
      const t = ttmList[ttmIdx];
      if (t.rev != null && t.rev > 0) lastPosRev = t.rev;
      if (t.np != null && t.np > 0) lastPosNp = t.np;
    }
    if (ttmIdx < 0) {
      peValues.push(null);
      psValues.push(null);
      continue;
    }
    psValues.push(lastPosRev != null && w.mcap > 0 ? w.mcap / lastPosRev : null);
    peValues.push(lastPosNp != null && w.mcap > 0 ? w.mcap / lastPosNp : null);
  }

  // ── 4. 异常值清洗（与 pePsSeries 共享策略）──
  const CLEAN = (
    raw: (number | null)[],
    hardCap: number,
  ): { clean: (number | null)[]; stats: { mean: number | null; std: number | null } } => {
    const arr = raw.filter((v): v is number => v != null && v <= hardCap);
    if (arr.length < 2) {
      return {
        clean: raw.map((v) => (v != null && v <= hardCap ? v : null)),
        stats: { mean: null, std: null },
      };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const upperBound = Math.min(q3 + 3 * iqr, hardCap);

    const clean = raw.map((v) => (v != null && v <= upperBound ? v : null));
    const validForStats = clean.filter((v): v is number => v != null);
    if (validForStats.length < 2) {
      return { clean, stats: { mean: null, std: null } };
    }
    const mean = validForStats.reduce((a, b) => a + b, 0) / validForStats.length;
    const variance = validForStats.reduce((s, v) => s + (v - mean) ** 2, 0) / validForStats.length;
    return { clean, stats: { mean, std: Math.sqrt(variance) } };
  };

  const peResult = CLEAN(peValues, 500);
  const psResult = CLEAN(psValues, 100);

  return {
    dates: weekly.map((w) => w.date),
    pe: peResult.clean,
    ps: psResult.clean,
    peMean: peResult.stats.mean,
    peStd: peResult.stats.std,
    psMean: psResult.stats.mean,
    psStd: psResult.stats.std,
  };
}

// ── 10. 估值（PS / PE / PEG） ────────────────────────────────────────

export type Valuation = {
  ps: number | null;
  pe: number | null;
  peDeducted: number | null;
  psAvg: number | null;
  psHigh: number | null;
  psLow: number | null;
  // 三年扣非净利润年化增长率(%)
  profitGrowth3Y: number | null;
  peg3Y: number | null;            // 扣非PE / 三年增长率
  pegCurrent: number | null;       // 扣非PE / 当期增长率(TTM YoY)
  // 三年/当前预估价格（合理价）
  fairPrice3Y: number | null;
  fairPriceCurrent: number | null;
  consensusPE: number | null;
  consensusEPS: number | null;
  fairPE3Y: number | null;      // 用来估算 3 年合理价的 PE
  fairPECurrent: number | null; // 用来估算当前合理价的 PE
};

export function calcValuation(
  periods: Fundamentals[],
  quote: Quote | null,
  psAvg: number | null = 2.5,
  psHigh: number | null = 4.0,
  psLow: number | null = 1.5,
  consensusPE: number | null = null,
  consensusEPS: number | null = null,
): Valuation {
  const cur = periods[0];
  const mcap = quote?.mcap ?? 0;
  const price = quote?.price ?? 0;
  const totalShares = mcap && price ? (mcap * 1e8) / price : 0; // 亿股
  // 用 TTM（滚动 12 个月）数据计算 PE/PS，与趋势图和标签"TTM"一致
  const ttmRevenue = cur.ttm?.revenue ?? cur.revenue;
  const ttmNetProfit = cur.ttm?.net_profit ?? cur.net_profit;
  const ttmDeducted = cur.ttm?.deducted_profit ?? cur.deducted_profit;
  const ps = ttmRevenue > 0 && mcap > 0 ? mcap / ttmRevenue : null;
  const pe = ttmNetProfit > 0 && mcap > 0 ? mcap / ttmNetProfit : null;
  const peDeducted = ttmDeducted > 0 && mcap > 0 ? mcap / ttmDeducted : null;

  // 三年扣非净利润年化增长率: TTM periods[0].ttm.deducted vs periods[12].ttm.deducted (3 年前)
  const base3 = periods[12] ?? periods[periods.length - 1];
  const curDedTTM = cur.ttm?.deducted_profit ?? cur.deducted_profit;
  const base3DedTTM = base3.ttm?.deducted_profit ?? base3.deducted_profit;
  let g3: number | null = null;
  if (base3DedTTM > 0 && curDedTTM > 0) {
    g3 = Math.pow(curDedTTM / base3DedTTM, 1 / 3) - 1;
  } else if (base3DedTTM !== 0 && curDedTTM !== 0) {
    g3 = Math.pow(curDedTTM / base3DedTTM, 1 / 3) - 1;
  }

  // 当期增长率 (TTM YoY 扣非)
  const ttmBase = periods.find(p => isOneYearAgo(p.period, cur.period)) ?? periods[Math.min(4, periods.length - 1)];
  const curDedTTMForYoY = cur.ttm?.deducted_profit ?? cur.deducted_profit;
  const baseDedTTMForYoY = ttmBase.ttm?.deducted_profit ?? ttmBase.deducted_profit;
  const gCurrent = baseDedTTMForYoY
    ? (curDedTTMForYoY - baseDedTTMForYoY) / Math.abs(baseDedTTMForYoY)
    : 0;

  const peg3Y = g3 && peDeducted ? peDeducted / (g3 * 100) : null;
  const pegCurrent = gCurrent ? peDeducted! / (gCurrent * 100) : null;

  // EPS：优先用一致预期 EPS（元/股），否则用当前 TTM 扣非推
  const epsForFair = (consensusEPS != null && consensusEPS > 0) ? consensusEPS
    : (cur.deducted_profit > 0 && totalShares > 0) ? cur.deducted_profit * 1e8 / totalShares : null;

  if (consensusPE != null && consensusPE > 0) {
    // 有研报一致预期 PE → 用 PEG 调整
    const fairPrice3Y = g3 && g3 > 0 && epsForFair
      ? (consensusPE / (g3 * 100)) * epsForFair
      : null;
    const fairPriceCurrent = gCurrent && gCurrent > 0 && epsForFair
      ? (consensusPE / (gCurrent * 100)) * epsForFair
      : null;
    return {
      ps, pe, peDeducted,
      psAvg, psHigh, psLow,
      profitGrowth3Y: g3,
      peg3Y, pegCurrent,
      fairPrice3Y, fairPriceCurrent,
      consensusPE, consensusEPS,
      fairPE3Y: consensusPE,
      fairPECurrent: consensusPE,
    };
  }

  // 无一致预期 PE → 用三年/本期扣非净利润增速估算合理 PE（PEG=1）
  const impliedPE_3Y = (g3 != null && g3 > 0) ? Math.max(g3 * 100, 8) : 30;
  const impliedPE_current = gCurrent > 0 ? Math.max(gCurrent * 100, 8) : 30;

  const fairPrice3Y = epsForFair ? impliedPE_3Y * epsForFair : null;
  const fairPriceCurrent = epsForFair ? impliedPE_current * epsForFair : null;

  return {
    ps, pe, peDeducted,
    psAvg, psHigh, psLow,
    profitGrowth3Y: g3,
    peg3Y, pegCurrent,
    fairPrice3Y, fairPriceCurrent,
    consensusPE, consensusEPS,
    fairPE3Y: impliedPE_3Y,
    fairPECurrent: impliedPE_current,
  };
}

// ── 业务构成 ────────────────────────────────────────────────────────

export type Segment = { name: string; value: number };

export function topSegments(segs: Segment[] | null | undefined, topN = 8) {
  const sorted = [...(segs ?? [])].sort((a, b) => b.value - a.value);
  if (sorted.length <= topN) return sorted;
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restSum = rest.reduce((s, x) => s + x.value, 0);
  if (restSum > 0) top.push({ name: "其他", value: restSum });
  return top;
}
