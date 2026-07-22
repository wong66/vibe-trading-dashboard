/**
 * 因子雷达图组件 — 使用 ECharts 雷达图展示多因子评分
 *
 * 8个维度：PE百分位 / PB百分位 / ROE / 营收增速 /
 *         净利增速 / 毛利率变化 / 资金流 / 动量
 */

import { useEffect } from "react";
import { useECharts } from "@/hooks/useECharts";

interface FactorData {
  pe_percentile?: number;
  pb_percentile?: number;
  roe?: number;
  revenue_growth?: number;
  net_profit_growth?: number;
  gross_margin_change?: number;
  main_flow_20d?: number;
  ret_20d?: number;
  market_cap_yi?: number;
}

interface Props {
  factor: FactorData;
  height?: number;
}

// 归一化函数：将各因子值映射到 0-100 的雷达图坐标
function normalizeForRadar(factor: FactorData) {
  const clamp = (v: number, _min: number, _max: number) =>
    Math.max(0, Math.min(100, v));

  return {
    "PE百分位": clamp(factor.pe_percentile ?? 50, 0, 100),
    "PB百分位": clamp(factor.pb_percentile ?? 50, 0, 100),
    ROE: clamp((factor.roe ?? 10) * 3, 0, 100), // ROE 0-30% → 0-90
    "营收增速": clamp((factor.revenue_growth ?? 0) * 2 + 50, 0, 100), // -25%~+25% → 0-100
    "净利增速": clamp((factor.net_profit_growth ?? 0) * 2 + 50, 0, 100),
    "毛利率变化": clamp((factor.gross_margin_change ?? 0) * 10 + 50, 0, 100), // -5pp~+5pp → 0-100
    "主力资金流": clamp((factor.main_flow_20d ?? 0) * 10 + 50, 0, 100), // -5亿~+5亿 → 0-100
    "20日动量": clamp((factor.ret_20d ?? 0) * 2 + 50, 0, 100), // -25%~+25% → 0-100
  };
}

export function FactorRadarChart({ factor, height = 260 }: Props) {
  const { ref, setOption } = useECharts();

  useEffect(() => {
    const data = normalizeForRadar(factor);
    const indicators = Object.keys(data).map((name) => ({
      name,
      max: 100,
    }));

    setOption({
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          if (params.name && params.value !== undefined) {
            return `${params.name}: <b>${params.value.toFixed(1)}</b>`;
          }
          return "";
        },
      },
      legend: { show: false },
      radar: {
        center: ["50%", "52%"],
        radius: "65%",
        indicator: indicators.map((ind) => ({
          name: ind.name,
          max: 100,
        })),
        axisName: {
          fontSize: 10,
          color: "#888",
        },
        splitArea: {
          areaStyle: {
            color: ["rgba(59,130,246,0.02)", "rgba(59,130,246,0.04)"],
          },
        },
        splitLine: {
          lineStyle: { color: "rgba(59,130,246,0.15)" },
        },
        axisLine: {
          lineStyle: { color: "rgba(59,130,246,0.2)" },
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: Object.values(data),
              name: "因子评分",
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: "rgba(59,130,246,0.35)" },
                    { offset: 1, color: "rgba(59,130,246,0.05)" },
                  ],
                },
              },
              lineStyle: {
                color: "rgba(59,130,246,0.8)",
                width: 2,
              },
              itemStyle: {
                color: "rgba(59,130,246,0.9)",
              },
            },
          ],
        },
      ],
    });
  }, [setOption, factor]);

  return <div ref={ref} style={{ height, width: "100%" }} />;
}

export type { FactorData };
