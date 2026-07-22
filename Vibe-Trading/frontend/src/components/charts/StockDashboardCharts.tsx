import { useEffect } from "react";
import { useECharts } from "@/hooks/useECharts";
import { getChartTheme } from "@/lib/chart-theme";

const CHART_H = 200;

// 通用 tooltip formatter：所有数值保留两位小数，并按 series 名后缀自动加单位
function fmtAxisTooltip(params: any[]): string {
  if (!Array.isArray(params) || !params.length) return "";
  const date = params[0].axisValueLabel;
  const lines = params.map((p: any) => {
    const raw = typeof p.value === "number" ? p.value : (p.data ?? p.value);
    const num = typeof raw === "number" ? raw.toFixed(2) : (raw ?? "—");
    const seriesName: string = p.seriesName || "";
    // 名称末尾 % → 加 %；否则保持原 seriesName 不变
    const hasPct = /[%％]\s*$/.test(seriesName);
    const suffix = hasPct ? "%" : "";
    return `${p.marker} ${seriesName}：<b>${num}${suffix}</b>`;
  });
  return `${date}<br/>${lines.join("<br/>")}`;
}

const AXIS_TOOLTIP_BASE = (t: ReturnType<typeof getChartTheme>) => ({
  trigger: "axis" as const,
  backgroundColor: t.tooltipBg,
  borderColor: t.tooltipBorder,
  textStyle: { color: t.tooltipText },
  formatter: fmtAxisTooltip,
});

// ── 1. 业绩规模柱状图（双柱：营收TTM + 净利润TTM） ──────────────────────
export function RevenueProfitChart({
  dates,
  revenue,
  netProfit,
  height = CHART_H,
}: { dates: string[]; revenue: number[]; netProfit: number[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      legend: { data: ["营业收入(亿)", "净利润(亿)"], textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: [
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { show: false } },
      ],
      series: [
        { name: "营业收入(亿)", type: "bar", data: revenue, itemStyle: { color: t.infoColor, borderRadius: [2, 2, 0, 0] }, barWidth: dates.length > 20 ? 6 : 12 },
        { name: "净利润(亿)", type: "line", yAxisIndex: 1, data: netProfit, smooth: true, symbol: "circle", symbolSize: 4,
          lineStyle: { color: t.upColor, width: 1.5 }, itemStyle: { color: t.upColor } },
      ],
    }, true);
  }, [setOption, dates, revenue, netProfit]);

  return <div ref={ref} style={{ height }} />;
}

// ── 2. 双轴线图：营收+经营现金流 ──────────────────────────────────────
export function DualAxisChart({
  dates, series, height = CHART_H,
}: { dates: string[]; series: { name: string; data: number[]; type: "bar" | "line"; yAxisIndex?: 0 | 1; color?: string }[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      legend: { data: series.map(s => s.name), textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: [
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { show: false } },
      ],
      series: series.map(s => {
        const isBar = s.type === "bar";
        return {
          name: s.name,
          type: s.type,
          yAxisIndex: s.yAxisIndex ?? 0,
          data: s.data,
          smooth: !isBar,
          symbol: isBar ? undefined : "circle",
          symbolSize: isBar ? undefined : 4,
          barWidth: isBar ? (dates.length > 20 ? 6 : 12) : undefined,
          ...(isBar
            ? { itemStyle: { color: s.color, borderRadius: [2, 2, 0, 0] as [number, number, number, number] } }
            : { lineStyle: { color: s.color, width: 1.5 }, itemStyle: { color: s.color } }),
        };
      }),
    }, true);
  }, [setOption, dates, series]);
  return <div ref={ref} style={{ height }} />;
}

// ── 3. 饼图（业务构成） ─────────────────────────────────────────────
export function DonutChart({ data, height = 200 }: { data: { name: string; value: number }[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "item", backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, textStyle: { color: t.tooltipText },
        formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${p.value.toFixed(2)} 亿 (${p.percent.toFixed(1)}%)` },
      legend: { type: "scroll", orient: "vertical", right: 4, top: "middle", textStyle: { color: t.textColor, fontSize: 10 }, itemWidth: 8, itemHeight: 8 },
      series: [{
        type: "pie",
        radius: ["45%", "70%"],
        center: ["38%", "50%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.tooltipBg, borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data,
      }],
    }, true);
  }, [setOption, data]);
  return <div ref={ref} style={{ height }} />;
}

// ── 4. 三费柱状图（研发/销售/管理费用占比） ──────────────────────────
export function ExpenseStackedChart({
  dates, sell, admin, rd, revenue, height = 300,
}: {
  dates: string[]; sell: number[]; admin: number[]; rd: number[];
  revenue?: number[];
  height?: number;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    const hasRevenue = Array.isArray(revenue) && revenue.length > 0;
    setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText },
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return "";
          const date = params[0].axisValue;
          const lines = [`<div style="font-weight:600;margin-bottom:4px">${date}</div>`];
          for (const p of params) {
            const v = p.value;
            if (v == null) continue;
            const unit = p.seriesName.endsWith("%") ? "%" : " 亿";
            const display = typeof v === "number" ? v.toFixed(2) + unit : String(v);
            lines.push(`<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px">
              <span>${p.marker}${p.seriesName}</span><span>${display}</span></div>`);
          }
          return lines.join("");
        },
      },
      legend: {
        data: hasRevenue
          ? ["营业收入 TTM", "销售费用 TTM", "管理费用 TTM", "研发费用 TTM"]
          : ["研发%", "销售%", "管理%"],
        textStyle: { color: t.textColor, fontSize: 10 },
        top: hasRevenue ? 0 : 2,
        left: hasRevenue ? 40 : "center",
        right: "auto",
        itemWidth: 10, itemHeight: 8,
        itemGap: hasRevenue ? 10 : 12,
      },
      grid: { left: 8, right: hasRevenue ? 48 : 8, top: hasRevenue ? 28 : 24, bottom: hasRevenue ? 24 : 20, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: hasRevenue ? [
        { type: "value", name: "营收(亿)", nameTextStyle: { color: t.textColor, fontSize: 9 }, axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", name: "占比(%)", nameTextStyle: { color: t.textColor, fontSize: 9 }, axisLabel: { color: t.textColor, fontSize: 9, formatter: "{value}%" }, splitLine: { show: false } },
      ] : { type: "value", axisLabel: { color: t.textColor, fontSize: 9, formatter: "{value}%" }, splitLine: { lineStyle: { color: t.gridColor } } },
      series: hasRevenue ? [
        { name: "营业收入 TTM", type: "bar", data: revenue!, itemStyle: { color: t.infoColor, opacity: 0.65 }, barWidth: dates.length > 20 ? 6 : 14, yAxisIndex: 0 },
        { name: "销售费用 TTM", type: "line", smooth: true, data: sell.map((p, i) => revenue && revenue[i] ? (p * revenue[i] / 100) : null), symbol: "circle", symbolSize: 4, lineStyle: { color: t.warningColor, width: 1.5 }, itemStyle: { color: t.warningColor }, yAxisIndex: 1 },
        { name: "管理费用 TTM", type: "line", smooth: true, data: admin.map((p, i) => revenue && revenue[i] ? (p * revenue[i] / 100) : null), symbol: "circle", symbolSize: 4, lineStyle: { color: "#a855f7", width: 1.5 }, itemStyle: { color: "#a855f7" }, yAxisIndex: 1 },
        { name: "研发费用 TTM", type: "line", smooth: true, data: rd.map((p, i) => revenue && revenue[i] ? (p * revenue[i] / 100) : null), symbol: "circle", symbolSize: 4, lineStyle: { color: t.infoColor, width: 1.5 }, itemStyle: { color: t.infoColor }, yAxisIndex: 1 },
      ] : [
        { name: "研发%", type: "bar", stack: "x", data: rd, itemStyle: { color: t.infoColor }, barWidth: dates.length > 20 ? 6 : 12 },
        { name: "销售%", type: "bar", stack: "x", data: sell, itemStyle: { color: t.warningColor } },
        { name: "管理%", type: "bar", stack: "x", data: admin, itemStyle: { color: "#a855f7" } },
      ],
    }, true);
  }, [setOption, dates, sell, admin, rd, revenue]);
  return <div ref={ref} style={{ height }} />;
}

// ── 5. 资产负债结构（堆叠柱状） ──────────────────────────────────────
export function BalanceStackedChart({
  dates, assets, liabilities, height = CHART_H,
}: {
  dates: string[];
  assets: { name: string; data: number[]; color: string }[];
  liabilities: { name: string; data: number[]; color: string }[];
  height?: number;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      legend: { data: assets.concat(liabilities).map(s => s.name), textStyle: { color: t.textColor, fontSize: 9 }, top: 0, right: 4, type: "scroll", itemWidth: 8, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 6 ? 30 : 0 } },
      yAxis: { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
      series: [
        ...assets.map(s => ({ name: s.name, type: "bar", stack: "asset", data: s.data, itemStyle: { color: s.color }, barWidth: 14, emphasis: { focus: "series" } })),
        ...liabilities.map(s => ({ name: s.name, type: "bar", stack: "liab", data: s.data, itemStyle: { color: s.color } })),
      ],
    }, true);
  }, [setOption, dates, assets, liabilities]);
  return <div ref={ref} style={{ height }} />;
}

// ── 资产负债类型定义 ────────────────────────────────────────────────
export type BalanceBarItem = {
  key: string;
  name: string;
  value: number;
  group: "asset" | "liab";
  color: string;
};

const BS_ITEM_ORDER: { key: string; name: string; group: "asset" | "liab"; color: string }[] = [
  { key: "bs_cash",          name: "总现金",         group: "asset", color: "#3b82f6" },
  { key: "bs_ar",            name: "应收款",         group: "asset", color: "#3b82f6" },
  { key: "bs_prepay",        name: "预付款",         group: "asset", color: "#3b82f6" },
  { key: "bs_inventory",     name: "存货",           group: "asset", color: "#3b82f6" },
  { key: "bs_other_ca",      name: "其他流动资产",   group: "asset", color: "#3b82f6" },
  { key: "bs_lt_invest",     name: "长期投资",       group: "asset", color: "#3b82f6" },
  { key: "bs_fixed",         name: "固定资产",       group: "asset", color: "#64748b" },
  { key: "bs_intangible",    name: "无形资产",       group: "asset", color: "#64748b" },
  { key: "bs_other_nca",     name: "其他非流动资产", group: "asset", color: "#64748b" },
  { key: "bs_st_debt",       name: "短期借款",       group: "liab",  color: "#ef4444" },
  { key: "bs_ap",            name: "应付账款",       group: "liab",  color: "#ef4444" },
  { key: "bs_contract_liab", name: "合同负债",       group: "liab",  color: "#ef4444" },
  { key: "bs_salary_tax",    name: "薪酬和税务",     group: "liab",  color: "#ef4444" },
  { key: "bs_other_cl",      name: "其他流动负债",   group: "liab",  color: "#ef4444" },
  { key: "bs_lt_debt",       name: "长期借款",       group: "liab",  color: "#ef4444" },
  { key: "bs_other_ncl",     name: "其他长期负债",   group: "liab",  color: "#ef4444" },
];

export function buildBalanceBarItem(p: Record<string, any>): BalanceBarItem[] {
  return BS_ITEM_ORDER.map(it => ({
    key: it.key,
    name: it.name,
    value: Number(p[it.key] ?? 0) || 0,
    group: it.group,
    color: it.color,
  }));
}

// ── 8. 资产负债结构（单期柱形图，含上一期切换） ──────────────────────
export function BalanceStructureChart({
  data, period, height = 320,
}: {
  data: BalanceBarItem[];
  period: string;
  periods?: string[];
  onPeriodChange?: (next: string) => void;
  height?: number;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    const categories = data.map(d => d.name);
    const values = data.map(d => d.group === "asset" ? d.value : -d.value);
    const colors = data.map(d => d.color);
    setOption({
      backgroundColor: "transparent",
      title: {
        text: `${period} 资产负债结构`,
        left: "center", top: 4,
        textStyle: { color: t.textColor, fontSize: 13, fontWeight: 600 },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 11 },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const p = params[0];
          const v = typeof p.value === "number" ? p.value : 0;
          return `${p.name}<br/>${p.marker} 金额：<b>${v.toFixed(2)} 亿</b>`;
        },
      },
      grid: { left: 8, right: 8, top: 36, bottom: 70, containLabel: true },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: t.axisColor } },
        axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold", rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}` },
        splitLine: { lineStyle: { color: t.gridColor } },
      },
      series: [{
        type: "bar",
        barWidth: 18,
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i] },
        })),
        label: {
          show: true,
          position: "outside",
          distance: 8,
          color: t.textColor,
          fontSize: 11,
          fontWeight: "bold",
          formatter: (p: any) => {
            const abs = Math.abs(p.value);
            return abs > 0.01 ? abs.toFixed(1) : "";
          },
        },
      }],
    }, true);
  }, [setOption, data, period]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

// ── 6. 应收/营收 双轴图 ─────────────────────────────────────────────
export function ArRevenueChart({
  dates, ar, revenue, arRatio, height = CHART_H,
}: { dates: string[]; ar: number[]; revenue: number[]; arRatio: number[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      legend: { data: ["应收账款(亿)", "营业收入(亿)", "应收/营收%"], textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: [
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9, formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: [
        { name: "应收账款(亿)", type: "bar", data: ar, itemStyle: { color: t.warningColor }, barWidth: dates.length > 20 ? 6 : 10 },
        { name: "营业收入(亿)", type: "bar", data: revenue, itemStyle: { color: t.infoColor } },
        { name: "应收/营收%", type: "line", yAxisIndex: 1, data: arRatio, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: t.downColor, width: 1.5 }, itemStyle: { color: t.downColor } },
      ],
    }, true);
  }, [setOption, dates, ar, revenue, arRatio]);
  return <div ref={ref} style={{ height }} />;
}

// ── 6·2. 应付/营收 双轴图 ─────────────────────────────────────────────
export function ApRevenueChart({
  dates, ap, revenue, apRatio, height = CHART_H,
}: { dates: string[]; ap: number[]; revenue: number[]; apRatio: number[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      legend: { data: ["应付账款(亿)", "营业收入(亿)", "应付/营收%"], textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: [
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", axisLabel: { color: t.textColor, fontSize: 9, formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: [
        { name: "应付账款(亿)", type: "bar", data: ap, itemStyle: { color: "#f97316" }, barWidth: dates.length > 20 ? 6 : 10 },
        { name: "营业收入(亿)", type: "bar", data: revenue, itemStyle: { color: t.infoColor } },
        { name: "应付/营收%", type: "line", yAxisIndex: 1, data: apRatio, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: "#a855f7", width: 1.5 }, itemStyle: { color: "#a855f7" } },
      ],
    }, true);
  }, [setOption, dates, ap, revenue, apRatio]);
  return <div ref={ref} style={{ height }} />;
}

// ── 6·3. PE 历史趋势图（含高估/低估参考线） ──────────────────────────
export function PeTrendChart({
  periods, pe, peMean, peStd, height = 250,
}: {
  periods: string[];
  pe: (number | null)[];
  peMean: number | null;
  peStd: number | null;
  height?: number;
}) {
  const { ref, setOption } = useECharts();

  // 智能Y轴范围预计算（放在 effect 外，避免闭包/dep 问题）
  const _validPe = pe.filter((v): v is number => v != null);
  const _peDataMax = _validPe.length > 0 ? Math.max(..._validPe) : 0;
  const _peHighLine = peMean != null && peStd != null ? peMean + peStd : null;
  const _peLowLine = peMean != null && peStd != null ? peMean - peStd : null;
  const _peRefMax = _peHighLine ?? (peMean ?? 0);
  const _yMaxPe = Math.max(_peDataMax, _peRefMax) * 1.15;
  const _yMinPe = Math.min(0, _peLowLine ?? 0, ...(_validPe.length ? [Math.min(..._validPe)] : [0]));

  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    const highLine = _peHighLine;
    const lowLine = _peLowLine;

    const series: any[] = [
      { name: "扣非 PE (TTM)", type: "line", data: pe, smooth: true, symbol: "circle", symbolSize: 6, connectNulls: true,
        lineStyle: { color: t.upColor, width: 2 }, itemStyle: { color: t.upColor },
        markLine: highLine != null || lowLine != null ? {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1.2 },
          data: [
            ...(highLine != null ? [{ yAxis: highLine, name: `高估 ${highLine.toFixed(1)}`, lineStyle: { color: "#ef4444" }, label: { formatter: `高估 {c}`, color: "#ef4444", fontSize: 10 } }] : []),
            ...(lowLine != null ? [{ yAxis: lowLine, name: `低估 ${lowLine.toFixed(1)}`, lineStyle: { color: "#22c55e" }, label: { formatter: `低估 {c}`, color: "#22c55e", fontSize: 10 } }] : []),
            ...(peMean != null ? [{ yAxis: peMean, name: `均值 ${peMean.toFixed(1)}`, lineStyle: { color: "#f59e0b" }, label: { formatter: `均值 {c}`, color: "#f59e0b", fontSize: 10 } }] : []),
          ],
        } : undefined,
      },
      ...(highLine != null ? [{ name: "高估线", type: "line", data: new Array(pe.length).fill(highLine), lineStyle: { color: "#ef4444", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
      ...(lowLine != null ? [{ name: "低估线", type: "line", data: new Array(pe.length).fill(lowLine), lineStyle: { color: "#22c55e", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
      ...(peMean != null ? [{ name: "均值", type: "line", data: new Array(pe.length).fill(peMean), lineStyle: { color: "#f59e0b", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
    ];

    setOption({
      backgroundColor: "transparent",
      title: { text: "扣非 PE 历史趋势", left: "center", top: 2, subtext: periods.length ? `${periods[0]} ~ ${periods[periods.length - 1]}（周度）` : "", subtextStyle: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, textStyle: { color: t.textColor, fontSize: 13, fontWeight: "bold" } },
      tooltip: {
        trigger: "axis",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12, fontWeight: "bold" },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const date = params[0].axisValue;
          let lines = [`<div style="font-weight:700;margin-bottom:4px">${date}</div>`];
          for (const p of params) {
            const v = p.value;
            if (v == null) continue;
            const display = typeof v === "number" ? v.toFixed(2) : String(v);
            lines.push(`<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;font-weight:600"><span>${p.marker}${p.seriesName}</span><span style="font-weight:700">${display}</span></div>`);
          }
          return lines.join("");
        },
      },
      legend: { data: ["扣非 PE (TTM)", "高估线", "均值", "低估线"], textStyle: { color: t.textColor, fontSize: 11, fontWeight: "bold" }, top: 22, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 50, bottom: 28, containLabel: true },
      xAxis: { type: "category", data: periods, boundaryGap: false, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, fontWeight: "bold", rotate: periods.length > 8 ? 30 : 0 } },
      yAxis: { type: "value", name: "扣非 PE", nameTextStyle: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold", formatter: (v: number) => Math.round(v).toString() }, splitLine: { lineStyle: { color: t.gridColor } }, min: _yMinPe, max: _yMaxPe },
      series,
    }, true);
  }, [setOption, periods, pe, peMean, peStd, _yMaxPe, _yMinPe]);
  return <div ref={ref} style={{ height }} />;
}

// ── 6·4. PS 历史趋势图（含高估/低估参考线） ──────────────────────────
export function PsTrendChart({
  periods, ps, psMean, psStd, height = 250,
}: {
  periods: string[];
  ps: (number | null)[];
  psMean: number | null;
  psStd: number | null;
  height?: number;
}) {
  const { ref, setOption } = useECharts();

  // 智能Y轴范围预计算
  const _validPs = ps.filter((v): v is number => v != null);
  const _psDataMax = _validPs.length > 0 ? Math.max(..._validPs) : 0;
  const _psHighLine = psMean != null && psStd != null ? psMean + psStd : null;
  const _psLowLine = psMean != null && psStd != null ? psMean - psStd : null;
  const _psRefMax = _psHighLine ?? (psMean ?? 0);
  const _yMaxPs = Math.max(_psDataMax, _psRefMax) * 1.15;
  const _yMinPs = Math.min(0, _psLowLine ?? 0, ...(_validPs.length ? [Math.min(..._validPs)] : [0]));

  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    const highLine = _psHighLine;
    const lowLine = _psLowLine;

    const series: any[] = [
      { name: "PS (TTM)", type: "line", data: ps, smooth: true, symbol: "circle", symbolSize: 6, connectNulls: true,
        lineStyle: { color: t.infoColor, width: 2 }, itemStyle: { color: t.infoColor },
        markLine: highLine != null || lowLine != null ? {
          silent: true, symbol: "none", lineStyle: { type: "dashed", width: 1.2 },
          data: [
            ...(highLine != null ? [{ yAxis: highLine, name: `高估 ${highLine.toFixed(1)}`, lineStyle: { color: "#ef4444" }, label: { formatter: `高估 {c}`, color: "#ef4444", fontSize: 10 } }] : []),
            ...(lowLine != null ? [{ yAxis: lowLine, name: `低估 ${lowLine.toFixed(1)}`, lineStyle: { color: "#22c55e" }, label: { formatter: `低估 {c}`, color: "#22c55e", fontSize: 10 } }] : []),
            ...(psMean != null ? [{ yAxis: psMean, name: `均值 ${psMean.toFixed(1)}`, lineStyle: { color: "#f59e0b" }, label: { formatter: `均值 {c}`, color: "#f59e0b", fontSize: 10 } }] : []),
          ],
        } : undefined,
      },
      ...(highLine != null ? [{ name: "高估线", type: "line", data: new Array(ps.length).fill(highLine), lineStyle: { color: "#ef4444", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
      ...(lowLine != null ? [{ name: "低估线", type: "line", data: new Array(ps.length).fill(lowLine), lineStyle: { color: "#22c55e", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
      ...(psMean != null ? [{ name: "均值", type: "line", data: new Array(ps.length).fill(psMean), lineStyle: { color: "#f59e0b", type: "dashed" as const, width: 1 }, symbol: "none", legendHoverLink: false }] : []),
    ];

    setOption({
      backgroundColor: "transparent",
      title: { text: "PS 历史趋势", left: "center", top: 2, subtext: periods.length ? `${periods[0]} ~ ${periods[periods.length - 1]}（周度）` : "", subtextStyle: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, textStyle: { color: t.textColor, fontSize: 13, fontWeight: "bold" } },
      tooltip: {
        trigger: "axis",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12, fontWeight: "bold" },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const date = params[0].axisValue;
          let lines = [`<div style="font-weight:700;margin-bottom:4px">${date}</div>`];
          for (const p of params) {
            const v = p.value;
            if (v == null) continue;
            const display = typeof v === "number" ? v.toFixed(2) : String(v);
            lines.push(`<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;font-weight:600"><span>${p.marker}${p.seriesName}</span><span style="font-weight:700">${display}</span></div>`);
          }
          return lines.join("");
        },
      },
      legend: { data: ["PS (TTM)", "高估线", "均值", "低估线"], textStyle: { color: t.textColor, fontSize: 11, fontWeight: "bold" }, top: 22, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 50, bottom: 28, containLabel: true },
      xAxis: { type: "category", data: periods, boundaryGap: false, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, fontWeight: "bold", rotate: periods.length > 8 ? 30 : 0 } },
      yAxis: { type: "value", name: "PS", nameTextStyle: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold", formatter: (v: number) => Math.round(v).toString() }, splitLine: { lineStyle: { color: t.gridColor } }, min: _yMinPs, max: _yMaxPs },
      series,
    }, true);
  }, [setOption, periods, ps, psMean, psStd, _yMaxPs, _yMinPs]);
  return <div ref={ref} style={{ height }} />;
}

// ── 7. 营收TTM + 市值（双 Y 轴单图） ────────────────────────────────
export function RevenueMcapChart({
  dates, revenue, mcap, height = CHART_H,
}: {
  dates: string[];
  revenue: (number | null)[];
  mcap: (number | null)[];
  height?: number;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12, fontWeight: "bold" },
        formatter: (params: any[]) => {
          const lines: string[] = [];
          let header = "";
          for (const p of params ?? []) {
            if (p.axisValueLabel) header = p.axisValueLabel;
            const v = Number(p.value);
            if (!v) continue;
            const formatted = v.toFixed(2) + " 亿";
            lines.push(`<div style="display:flex;justify-content:space-between;gap:16px;font-weight:600"><span>${p.marker} ${p.seriesName}</span><span style="font-weight:700">${formatted}</span></div>`);
          }
          if (!lines.length) return "";
          return `<div style="font-weight:700;margin-bottom:4px">${header}</div>` + lines.join("");
        },
      },
      legend: { data: ["营业收入(亿) TTM", "市值(亿)"], textStyle: { color: t.textColor, fontSize: 11, fontWeight: "bold" }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: {
        type: "category", data: dates,
        axisLine: { lineStyle: { color: t.axisColor } },
        axisLabel: { color: t.textColor, fontSize: 9, fontWeight: "bold", rotate: dates.length > 8 ? 30 : 0 },
      },
      yAxis: [
        { type: "value", name: "营收(亿)", nameTextStyle: { color: t.infoColor, fontSize: 10, fontWeight: "bold" }, axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", name: "市值(亿)", nameTextStyle: { color: t.warningColor, fontSize: 10, fontWeight: "bold" }, axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, splitLine: { show: false } },
      ],
      series: [
        { name: "营业收入 TTM", type: "bar", yAxisIndex: 0, data: revenue, itemStyle: { color: t.infoColor, borderRadius: [2, 2, 0, 0] }, barWidth: 6 },
        { name: "市值(亿)", type: "line", yAxisIndex: 1, data: mcap, connectNulls: true, smooth: true, symbol: "none", lineStyle: { color: t.warningColor, width: 2 }, itemStyle: { color: t.warningColor }, areaStyle: { color: t.warningColor + "15" } },
      ],
    }, true);
  }, [setOption, dates, revenue, mcap]);
  return <div ref={ref} style={{ height }} />;
}

// ── 5·2. 成本与毛利率分析 ──────────────────────────────────────────
export function CostMarginChart({
  dates, revenue, cost, margin, height = CHART_H,
}: { dates: string[]; revenue: (number | null)[]; cost: (number | null)[]; margin: number[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12, fontWeight: "bold" },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const date = params[0].axisValue;
          const lines = [`<div style="font-weight:700;margin-bottom:4px">${date}</div>`];
          for (const p of params) {
            const v = p.value;
            if (v == null) continue;
            const seriesName: string = p.seriesName || "";
            const hasPct = /[%％]\s*$/.test(seriesName);
            const unit = hasPct ? "%" : " 亿";
            const display = typeof v === "number" ? v.toFixed(2) + unit : String(v);
            lines.push(`<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;font-weight:600"><span>${p.marker}${seriesName}</span><span style="font-weight:700">${display}</span></div>`);
          }
          return lines.join("");
        },
      },
      legend: { data: ["营业收入 TTM", "营业成本 TTM", "毛利率"], textStyle: { color: t.textColor, fontSize: 11, fontWeight: "bold" }, top: 0, right: 4, itemWidth: 10, itemHeight: 8, itemGap: 12 },
      grid: { left: 14, right: 14, top: 28, bottom: 16, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold", rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: [
        { type: "value", axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold" }, splitLine: { lineStyle: { color: t.gridColor } } },
        { type: "value", axisLabel: { color: t.textColor, fontSize: 10, fontWeight: "bold", formatter: "{value}%" }, splitLine: { show: false }, min: 0, max: 100 },
      ],
      series: [
        { name: "营业收入 TTM", type: "bar", yAxisIndex: 0, data: revenue, itemStyle: { color: t.infoColor, borderRadius: [2, 2, 0, 0] }, barWidth: dates.length > 20 ? 4 : 8 },
        { name: "营业成本 TTM", type: "bar", yAxisIndex: 0, data: cost, itemStyle: { color: t.warningColor, borderRadius: [2, 2, 0, 0] }, barWidth: dates.length > 20 ? 4 : 8 },
        { name: "毛利率", type: "line", yAxisIndex: 1, data: margin, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: "#22c55e", width: 1.6 }, itemStyle: { color: "#22c55e" } },
      ],
    }, true);
  }, [setOption, dates, revenue, cost, margin]);
  return <div ref={ref} style={{ height }} />;
}

// ── 7a. 近 N 年 CAGR 柱形图（4 列：市值/营收/净利/净资产） ──────────────
export function CagrBarChart({
  data, subtitle, height = 280,
}: {
  data: { name: string; value: number | null; color: string }[];
  subtitle?: string;
  height?: number;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      title: { text: subtitle || "近五年综合增长率", left: "center", top: 4, textStyle: { color: t.textColor, fontSize: 13, fontWeight: 600 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 11 },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const p = params[0];
          if (p.value == null) return `${p.name}<br/><span style="color:#94a3b8">数据不足</span>`;
          return `${p.name}<br/>${p.marker} 增长率：<b>${(p.value * 100).toFixed(2)}%</b>`;
        },
      },
      grid: { left: 8, right: 8, top: 40, bottom: 40, containLabel: true },
      xAxis: { type: "category", data: data.map(d => d.name), axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 11, interval: 0 } },
      yAxis: { type: "value", axisLabel: { color: t.textColor, fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, splitLine: { lineStyle: { color: t.gridColor } } },
      series: [{
        type: "bar", barWidth: 38,
        data: data.map(d => ({
          value: d.value == null ? "-" : d.value,
          itemStyle: { color: d.value == null ? "#cbd5e1" : (d.value >= 0 ? d.color : "#ef4444") },
        })),
        label: { show: true, position: "top", color: t.textColor, fontSize: 11, fontWeight: 600, formatter: (p: any) => p.value === "-" || p.value == null ? "" : `${(p.value * 100).toFixed(2)}%` },
      }],
    }, true);
  }, [setOption, data, subtitle]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

// ── 7. 趋势折线（毛利率/净利率/ROE） ─────────────────────────────────
export function MarginTrendChart({
  dates, gross, net, roe, height = CHART_H,
}: { dates: string[]; gross: number[]; net: number[]; roe: number[]; height?: number }) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText },
        formatter: (params: any[]) => {
          if (!Array.isArray(params) || !params.length) return "";
          const date = params[0].axisValueLabel;
          const lines = params.map((p: any) => {
            const v = typeof p.value === "number" ? p.value.toFixed(2) : (p.value ?? "—");
            return `${p.marker} ${p.seriesName}：<b>${v}%</b>`;
          });
          return `${date}<br/>${lines.join("<br/>")}`;
        },
      },
      legend: { data: ["毛利率%", "净利率%", "ROE%"], textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: dates.length > 12 ? 30 : 0 } },
      yAxis: { type: "value", axisLabel: { color: t.textColor, fontSize: 9, formatter: (v: number) => `${v.toFixed(1)}%` }, splitLine: { lineStyle: { color: t.gridColor } } },
      series: [
        { name: "毛利率%", type: "line", data: gross, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: t.upColor, width: 1.5 }, itemStyle: { color: t.upColor } },
        { name: "净利率%", type: "line", data: net, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: t.warningColor, width: 1.5 }, itemStyle: { color: t.warningColor } },
        { name: "ROE%", type: "line", data: roe, smooth: true, symbol: "circle", symbolSize: 4, lineStyle: { color: t.infoColor, width: 1.5 }, itemStyle: { color: t.infoColor } },
      ],
    }, true);
  }, [setOption, dates, gross, net, roe]);
  return <div ref={ref} style={{ height }} />;
}

// ── 多系列折线图（按地区按时间趋势） ─────────────────────────────────
const REGION_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"];

export function MultiLineChart({
  periods,
  series,
  height = 260,
  yUnit = "亿元",
}: {
  periods: string[];
  series: { name: string; data: (number | null)[] }[];
  height?: number;
  yUnit?: string;
}) {
  const { ref, setOption } = useECharts();
  useEffect(() => {
    if (!setOption) return;
    const t = getChartTheme();
    setOption({
      backgroundColor: "transparent",
      tooltip: AXIS_TOOLTIP_BASE(t),
      legend: { data: series.map(s => s.name), textStyle: { color: t.textColor, fontSize: 10 }, top: 0, right: 4, itemWidth: 10, itemHeight: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 28, containLabel: true },
      xAxis: { type: "category", data: periods, axisLine: { lineStyle: { color: t.axisColor } }, axisLabel: { color: t.textColor, fontSize: 9, rotate: periods.length > 8 ? 30 : 0 } },
      yAxis: { type: "value", name: yUnit, nameTextStyle: { color: t.textColor, fontSize: 9 }, axisLabel: { color: t.textColor, fontSize: 9 }, splitLine: { lineStyle: { color: t.gridColor } } },
      series: series.map((s, i) => ({
        name: s.name, type: "line", data: s.data, smooth: true,
        symbol: "circle", symbolSize: 5, connectNulls: true,
        lineStyle: { color: REGION_COLORS[i % REGION_COLORS.length], width: 1.6 },
        itemStyle: { color: REGION_COLORS[i % REGION_COLORS.length] },
      })),
    }, true);
  }, [setOption, periods, series, yUnit]);
  return <div ref={ref} style={{ height }} />;
}
