/**
 * 板块热力图组件 — 展示行业板块热度排行
 *
 * 双模式：
 *   1. 后端模式：数据来自 /aquant/market/temperature.sector_heat（东财行业板块）
 *   2. 降级模式：后端为空时，从信号列表聚合派生（按 sector 分组，评分/涨跌幅加权）
 */

import { Flame, Info, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/Skeleton";

interface SectorHeatItem {
  sector: string;
  heat: number;
  change_pct: number;
  up_count?: number;
  down_count?: number;
  leader?: string;
  signal_count?: number;
  ad_ratio?: number;
}

// 信号记录的子集（仅用于降级聚合）
interface SignalForSector {
  sector: string;
  score: number;
  stock_name: string;
  stock_code: string;
  factors?: {
    change_pct?: number;
    ret_20d?: number;
    pe_percentile?: number;
    market_cap_yi?: number;
  };
}

interface Props {
  sectors: SectorHeatItem[];
  loading?: boolean;
  maxItems?: number;
  /** 信号列表（用于后端板块数据为空时的降级聚合） */
  signals?: SignalForSector[] | null;
}

function formatChange(pct: number) {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// 常见板块一句话说明
const SECTOR_DESCRIPTIONS: Record<string, string> = {
  白酒: "高端消费风向标，业绩确定性较强。",
  锂电池: "新能源车核心赛道，关注产能利用率与碳酸锂价格。",
  新能源汽车: "整车与零部件产业链，销量数据是主要催化。",
  光伏: "风光新能源主力，硅料价格与装机量决定短期景气。",
  半导体: "国产替代主线，周期复苏与设备材料突破是核心驱动力。",
  半导体设备: "晶圆厂扩产受益环节，订单决定业绩弹性。",
  芯片: "AI算力基础，关注先进制程与封测景气。",
  人工智能: "大模型落地加速，算力/算法/数据三层轮动。",
  算力: "AI训练推理底座，服务器/光模块景气度跟踪。",
  通信设备: "5G/6G与算力网络基建，运营商资本开支影响节奏。",
  消费电子: "手机/PC/可穿戴周期，新品发布是核心变量。",
  软件: "企业数字化与信创，AI应用落地是业绩关键。",
  银行: "高股息防御配置，净息差决定估值空间。",
  保险: "负债端复苏与投资端弹性，利率走势影响显著。",
  证券: "市场成交额敏感，Beta属性较强。",
  化学制药: "创新药与仿制药并重，集采政策影响估值。",
  CXO: "医药外包服务，海外订单回暖是景气信号。",
  医疗器械: "老龄化受益方向，集采落地影响节奏。",
  家电: "地产后周期与出海双重逻辑。",
  机器人: "人形机器人产业趋势，减速器/丝杠/电机为核心。",
  工业自动化: "制造业资本开支相关，PMI是先行指标。",
  有色金属: "全球定价商品，美元主导价格波动。",
  煤炭: "高股息能源板块，煤价决定盈利中枢。",
  钢铁: "地产基建上游，供给侧改革影响价格。",
  化工: "价差扩大与产能周期是关键。",
  电力: "火电/水电/核电综合，电价改革影响盈利。",
  房地产: "政策托底与销售数据博弈。",
  建筑: "基建与地产施工，专项债发行是观察点。",
  农业: "猪周期与种植链，产能去化影响价格。",
  食品饮料: "必选消费，成本下行推动改善。",
  传媒: "游戏/影视/广告，内容供给影响景气。",
  旅游酒店: "消费复苏敏感，节假日数据催化。",
  商贸零售: "消费流量复苏，国企改革提供机会。",
  纺织服装: "出口与品牌零售，海外库存周期影响。",
  汽车整车: "销量/价格战与出海进度。",
  汽车零部件: "智能化与轻量化，平台化是核心逻辑。",
  国防军工: "订单周期与央企改革。",
  环保: "公用事业化，现金流改善是基础。",
  公用事业: "防御性配置，分红稳定。",
  交通运输: "物流/航运/航空，运价与客流是关键。",
  其他: "综合类或暂未归类板块。",
};

/** 从信号列表聚合派生板块数据 */
function deriveFromSignals(signals: SignalForSector[]): SectorHeatItem[] {
  const sectorMap = new Map<string, {
    scores: number[];
    changes: number[];
    names: string[];
    codes: string[];
    ret20ds: number[];
    count: number;
  }>();

  for (const s of signals) {
    const sec = s.sector || "未分类";
    if (!sectorMap.has(sec)) {
      sectorMap.set(sec, { scores: [], changes: [], names: [], codes: [], ret20ds: [], count: 0 });
    }
    const entry = sectorMap.get(sec)!;
    entry.scores.push(s.score);
    entry.changes.push(s.factors?.change_pct ?? 0);
    entry.ret20ds.push(s.factors?.ret_20d ?? 0);
    entry.names.push(s.stock_name);
    entry.codes.push(s.stock_code);
    entry.count++;
  }

  return Array.from(sectorMap.entries())
    .map(([sector, data]) => {
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.count;
      const avgChange = data.changes.reduce((a, b) => a + b, 0) / data.count;
      const avgRet20d = data.ret20ds.reduce((a, b) => a + b, 0) / data.count;
      // 找最高分信号作为龙头
      let maxIdx = 0;
      let maxScore = -1;
      for (let i = 0; i < data.scores.length; i++) {
        if (data.scores[i] > maxScore) {
          maxScore = data.scores[i];
          maxIdx = i;
        }
      }
      // 热度 = 平均评分归一化到 0-100（假设 score 范围 40-90）
      const heat = Math.min(100, Math.max(0, Math.round(((avgScore - 40) / 50) * 100)));

      return {
        sector,
        heat,
        change_pct: avgChange,
        up_count: data.changes.filter(c => c > 0).length,
        down_count: data.changes.filter(c => c < 0).length,
        leader: `${data.names[maxIdx]}(${data.codes[maxIdx]})`,
        signal_count: data.count,
        ad_ratio: avgRet20d,
      };
    })
    // 按热度降序 → 同热度按信号数降序
    .sort((a, b) => {
      if (b.heat !== a.heat) return b.heat - a.heat;
      return (b.signal_count || 0) - (a.signal_count || 0);
    });
}

export function SectorHeatmap({ sectors, loading, maxItems = 12, signals }: Props) {
  if (loading) {
    return (
      <div className="p-4 border-b bg-card/30 space-y-3">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {Array.from({ length: maxItems }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── 双模式选择 ──
  const hasBackendData = sectors && sectors.length > 0;
  const hasSignalData = signals && signals.length > 0;
  const display = hasBackendData
    ? sectors.slice(0, maxItems)
    : hasSignalData
      ? deriveFromSignals(signals).slice(0, maxItems)
      : [];

  if (display.length === 0) {
    return (
      <div className="p-4 border-b bg-card/30 text-xs text-muted-foreground">
        暂无板块热度数据
      </div>
    );
  }

  const isDerivedMode = !hasBackendData && hasSignalData;

  return (
    <div className="p-4 border-b bg-card/30 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          板块热力
          {isDerivedMode && (
            <span className="text-[9px] font-normal text-primary/60 ml-1">
              （信号派生）
            </span>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          {isDerivedMode ? (
            <>基于 {signals!.length} 条信号聚合 &middot; TOP{maxItems}</>
          ) : (
            <>按热度排序 TOP{maxItems}</>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {display.map((item) => {
          const isUp = item.change_pct >= 0;
          const heatColor =
            item.heat >= 80 ? "from-orange-500 to-red-500"
            : item.heat >= 60 ? "from-amber-400 to-orange-500"
            : item.heat >= 40 ? "from-green-400 to-emerald-500"
            : "from-blue-400 to-slate-400";

          return (
            <div
              key={item.sector}
              className="group relative flex flex-col justify-between p-2.5 rounded-lg border bg-card hover:shadow-md transition-all cursor-default overflow-hidden"
            >
              {/* 背景热力条 */}
              <div
                className={cn("absolute bottom-0 left-0 h-1 bg-gradient-to-r", heatColor)}
                style={{ width: `${item.heat}%` }}
              />

              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-semibold truncate pr-1 flex items-center gap-1 cursor-help"
                  title={
                    SECTOR_DESCRIPTIONS[item.sector]
                    || `${item.sector}板块，${isDerivedMode ? '平均' : ''}涨跌 ${formatChange(item.change_pct)}，热度 ${item.heat.toFixed(0)}${item.signal_count ? `，${item.signal_count}条信号` : ''}`
                  }
                >
                  {item.sector}
                  <Info className="h-3 w-3 text-muted-foreground opacity-50 hover:opacity-100" />
                </span>
                <span className={cn(
                  "text-[10px] font-medium tabular-nums",
                  isUp ? "text-[#ef4444]" : "text-[#22c55e]",
                )}>
                  {formatChange(item.change_pct)}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>热度 {item.heat.toFixed(0)}</span>
                {item.signal_count != null && item.signal_count > 0 && (
                  <span className={cn(
                    "font-medium",
                    isDerivedMode ? "text-primary" : "text-primary/70",
                  )}>
                    {item.signal_count}信号
                  </span>
                )}
              </div>

              {/* 降级模式额外信息：平均分 */}
              {isDerivedMode && item.signal_count && item.signal_count > 1 && (
                <div className="mt-0.5 text-[9px] text-muted-foreground">
                  均分 {item.heat > 0 ? ((item.heat / 100) * 50 + 40).toFixed(1) : "—"}
                </div>
              )}

              {item.leader && (
                <div className="mt-1 text-[9px] text-muted-foreground truncate">
                  龙头: {item.leader}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 降级模式说明 */}
      {isDerivedMode && (
        <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
          <TrendingUp className="h-3 w-3 inline mr-0.5" />
          当前基于信号列表聚合展示板块分布。行业板块实时行情需要东财数据源支持。
        </p>
      )}
    </div>
  );
}

export type { SectorHeatItem };
