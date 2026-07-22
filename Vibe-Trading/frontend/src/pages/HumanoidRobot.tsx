import { useState, useEffect, useCallback } from "react";
import { ChevronRight, RefreshCw, Bot, Factory, Gem, Cog, Drill, Gauge, Shield, BarChart3, TrendingUp, FileText, Calendar, Building2, Tag, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type IndustryReport } from "@/lib/api";
import { SECTORS, SECTOR_CONTENT, SECTOR_STOCKS, REPORT_SECTORS, SECTOR_COLORS, CORE_COMPONENTS } from "@/lib/humanoidRobotData";

// ── StockScoreBar ───────────────────────────────────────────────────────

function StockScoreBar({ value, label }: { value: number | string; label: string }) {
  const numeric = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(100, (numeric / 5) * 100));
  const isPlaceholder = typeof value === "string";

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-muted-foreground w-[4.5rem] shrink-0 text-right">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted border overflow-hidden">
        {!isPlaceholder && (
          <div
            className="h-full rounded-full bg-primary/70 transition-all"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/50 w-7 shrink-0 text-right">
        {isPlaceholder ? "—" : `${numeric}/5`}
      </span>
    </div>
  );
}

function SectorTemplate({ label, sectorKey }: { label: string; sectorKey: string }) {
  const content = SECTOR_CONTENT[sectorKey];
  const stocks = SECTOR_STOCKS[sectorKey] || [];

  return (
    <div className="space-y-5">
      {/* ── 1. 环节定位 ── */}
      <div className="border rounded-xl p-4 bg-card space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          环节定位 — {label}
        </h3>
        <p className="text-sm leading-relaxed text-foreground/85">
          {content?.positioning ?? "待补"}
        </p>
      </div>

      {/* ── 2. 竞争格局 (国际 + 国内) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-card space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            国际竞争格局
          </h3>
          <p className="text-sm leading-relaxed text-foreground/80">
            {content?.intlLandscape ?? "待补"}
          </p>
        </div>
        <div className="border rounded-xl p-4 bg-card space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            国内竞争格局
          </h3>
          <p className="text-sm leading-relaxed text-foreground/80">
            {content?.domLandscape ?? "待补"}
          </p>
        </div>
      </div>

      {/* ── 3. 壁垒类型 ── */}
      <div className="border rounded-xl p-4 bg-card space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Shield className="h-4 w-4" />
          壁垒类型
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border rounded-lg p-3 space-y-1.5 bg-muted/20">
            <span className="text-xs font-semibold text-primary">科技壁垒</span>
            <p className="text-xs leading-relaxed text-foreground/75">
              {content?.techBarrier ?? "待补"}
            </p>
          </div>
          <div className="border rounded-lg p-3 space-y-1.5 bg-muted/20">
            <span className="text-xs font-semibold text-primary">产能壁垒</span>
            <p className="text-xs leading-relaxed text-foreground/75">
              {content?.capacityBarrier ?? "待补"}
            </p>
          </div>
        </div>
      </div>

      {/* ── 4. 个股评分体系 ── */}
      <div className="border rounded-xl p-4 bg-card space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          个股评分体系
        </h3>
        {stocks.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4">待补</p>
        ) : (
          <div className="space-y-4">
            {stocks.map((s) => (
              <div key={s.code} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">
                    {s.code}
                  </span>
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">{s.overall}</span>
                </div>
                <div className="space-y-1.5">
                  <StockScoreBar value={s.irreplaceability} label="不可替代性" />
                  <StockScoreBar value={s.valuation} label="估值" />
                  <StockScoreBar value={s.performance} label="业绩" />
                  <StockScoreBar value={s.customer} label="客户" />
                  <StockScoreBar value={s.management} label="管理层" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 5. 核心标的表格 ── */}
      <div className="border rounded-xl p-4 bg-card space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          核心标的
        </h3>
        {stocks.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-4">待补</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium w-[4.5rem]">公司</th>
                  <th className="px-3 py-2 text-left font-medium w-[5rem]">不可替代性</th>
                  <th className="px-3 py-2 text-left font-medium w-[4rem]">评分</th>
                  <th className="px-3 py-2 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <tr key={s.code} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-mono text-muted-foreground">{s.code}</span>
                        <span className="font-medium">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div
                            key={i}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              i < s.irreplaceability ? "bg-primary/70" : "bg-muted",
                            )}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{s.overall}</td>
                    <td className="px-3 py-2.5 text-muted-foreground leading-relaxed max-w-[320px]">
                      {s.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ReportLibrary ────────────────────────────────────────────────────────

function ReportLibrary() {
  const [reports, setReports] = useState<IndustryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("全部");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getIndustryReports("robot");
      if (res.error) {
        setError(res.error);
      } else {
        setReports(res.reports);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "研报数据获取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === "全部"
    ? reports
    : reports.filter((r) => r.sector === filter);

  return (
    <div className="space-y-4">
      {/* sector filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">筛选：</span>
        {REPORT_SECTORS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
              filter === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
          >
            {s}
            {s !== "全部" && (
              <span className="ml-1 opacity-60">
                {reports.filter((r) => r.sector === s).length}
              </span>
            )}
          </button>
        ))}
        <span className="text-xs text-muted-foreground/60 ml-auto">
          共 {reports.length} 篇
        </span>
      </div>

      {/* error */}
      {error && (
        <div className="text-sm text-danger border border-danger/30 rounded-lg p-3 bg-danger/5">
          {error}
        </div>
      )}

      {/* table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-12 text-center">
          {filter === "全部" ? "暂无研报数据" : `暂无「${filter}」方向的研报`}
        </p>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium w-[6rem]">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      日期
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium w-[7rem]">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      机构
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      标题
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium w-[5rem]">
                    <span className="flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      环节
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r, i) => (
                  <tr
                    key={`${r.infoCode}-${i}`}
                    className="hover:bg-muted/30 transition-colors group"
                  >
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {r.publishDate}
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {r.orgSName}
                    </td>
                    <td className="px-4 py-2.5 text-xs min-w-[300px]">
                      <a
                        href={`https://data.eastmoney.com/report/zw_industry.jshtml?infocode=${r.infoCode}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary transition-colors flex items-start gap-1 group/link"
                      >
                        <span className="flex-1">{r.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity text-muted-foreground" />
                      </a>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          SECTOR_COLORS[r.sector] || "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.sector}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* footer */}
      <p className="text-xs text-muted-foreground/50 text-center">
        数据来源：东方财富研报平台，近三个月行业研报
      </p>
    </div>
  );
}

// ── IndustryOverview (总览 tab) ──────────────────────────────────────────

function IndustryOverview() {
  return (
    <div className="space-y-5">
      {/* ── 1. 产业链结构图 ── */}
      <div className="border rounded-xl p-5 bg-card space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          产业链结构图
        </h3>
        <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3 py-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 min-w-[120px] justify-center">
            <Factory className="h-4 w-4 text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground/70">上游材料与设备</span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 hidden md:block" />
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 rotate-90 md:rotate-0" />
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border-2 border-primary/40 bg-primary/5 min-w-[200px]">
            {CORE_COMPONENTS.map((c) => (
              <span key={c.key} className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                {c.label}
              </span>
            ))}
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 hidden md:block" />
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 rotate-90 md:rotate-0" />
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-danger/30 bg-danger/5 min-w-[120px] justify-center">
            <Bot className="h-4 w-4 text-danger/60" />
            <span className="text-sm font-medium text-danger/80">本体机器人</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 text-center leading-relaxed">
          上游稀土永磁、特种钢材、精密磨床 → 六大核心零部件 → 特斯拉 Optimus / 优必选 / 宇树 / 智元等整机厂。<br />
          2026 年全球人形机器人产量预计 23.8 万台（华泰），2030 年有望达百万台级别。
        </p>
      </div>

      {/* ── 2. 六大核心环节卡片 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {CORE_COMPONENTS.map(({ key, label, icon: Icon, desc, stat }) => (
          <div key={key} className="border rounded-xl p-4 bg-card space-y-2 text-center hover:border-primary/30 transition-colors">
            <Icon className="h-6 w-6 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-[11px] text-muted-foreground/60">{desc}</p>
            <p className="text-[10px] text-primary/70 font-medium leading-snug">{stat}</p>
          </div>
        ))}
      </div>

      {/* ── 3. 上游材料与设备 ── */}
      <div className="border rounded-xl p-4 bg-card space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Factory className="h-4 w-4" />
          上游材料与设备
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border rounded-lg p-3 space-y-1 bg-muted/20">
            <div className="flex items-center gap-2">
              <Gem className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">稀土永磁</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              钕铁硼永磁体为无框力矩电机核心材料，中国稀土储量占全球 ~35%，产量 ~70%。金力永磁、中科三环等为头部供应商。
            </p>
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/20">
            <div className="flex items-center gap-2">
              <Cog className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">精密磨床</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              丝杠/减速器核心加工设备，长期被欧日出口管制。国产磨床精度逐步追赶，但核心部件仍有差距，是产能释放的关键瓶颈。
            </p>
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/20">
            <div className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">特种材料</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              谐波减速器柔轮用特种钢材、灵巧手腱绳用复合钨丝、触觉传感器 MEMS 芯片等，材料纯度和疲劳寿命直接影响零部件性能。
            </p>
          </div>
        </div>
      </div>

      {/* ── 4. 板块评分总览 + 核心标的池 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            板块评分总览
          </h3>
          <div className="space-y-2">
            {[
              { label: "产业空间", score: 5, note: "2030 年全球千亿级市场" },
              { label: "国产替代进程", score: 4, note: "减速器/传感器突破快，丝杠仍薄弱" },
              { label: "技术壁垒", score: 5, note: "多环节微米/纳米级加工壁垒极高" },
              { label: "量产确定性", score: 4, note: "特斯拉 Optimus 2026H2 量产爬坡" },
              { label: "政策支持", score: 5, note: "十五五重点方向，多地产业基金加持" },
            ].map(({ label, score, note }) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={cn("h-1.5 w-3 rounded-sm", i < score ? "bg-primary/70" : "bg-muted")} />
                  ))}
                </div>
                <span className="text-muted-foreground/70 ml-auto">{note}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            核心标的池
          </h3>
          <div className="space-y-1.5 text-xs">
            {[
              { name: "绿的谐波", code: "688017", why: "谐波全球第二，特斯拉独家供应商" },
              { name: "恒立液压", code: "601100", why: "丝杠龙头，特斯拉最大供应商(份额≥70%)" },
              { name: "兆威机电", code: "003021", why: "灵巧手龙头，订单超6亿，全驱量产" },
              { name: "雷赛智能", code: "002979", why: "无框电机产能30万台，覆盖80%国内厂商" },
              { name: "柯力传感", code: "603662", why: "六维力传感器龙头，送样超70家" },
              { name: "步科股份", code: "688160", why: "无框电机国内龙头，Q1出货+246%" },
            ].map(({ name, code, why }) => (
              <div key={code} className="flex items-center gap-2 py-1 border-b last:border-0">
                <span className="font-mono text-[11px] bg-muted px-1 rounded">{code}</span>
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground/70 ml-auto text-right">{why}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 5. 整机成本构成 + 量产时间轴 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Drill className="h-4 w-4" />
            整机成本构成
          </h3>
          <div className="space-y-2">
            {[
              { part: "丝杠（行星滚柱+滚珠）", pct: 30, note: "最大单一成本项，降本核心" },
              { part: "无框力矩电机", pct: 20, note: "28 个执行器，单价快速下降" },
              { part: "减速器（谐波+RV）", pct: 15, note: "国产替代后单价降 25-30%" },
              { part: "传感器（力+视觉+IMU）", pct: 15, note: "六维力国产单价 2.7 万 vs 海外 10 万" },
              { part: "灵巧手", pct: 10, note: "微型电机+丝杠+触觉传感器集成" },
              { part: "电池/电控/结构件", pct: 10, note: "相对成熟，规模化降本" },
            ].map(({ part, pct, note }) => (
              <div key={part} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{part}</span>
                  <span className="font-mono font-medium">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct * 2.5}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground/60">{note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            量产时间轴
          </h3>
          <div className="space-y-3">
            {[
              { time: "2025", event: "特斯拉 Optimus Gen2 工程验证，宇树科创板过会，比亚迪入局" },
              { time: "2026H1", event: "Optimus V3 小规模试产，宇树/智元万台级量产，绿的谐波订单翻倍" },
              { time: "2026H2", event: "特斯拉启动 10 万台级量产，丝杠/电机订单爆发，灵巧手批量交付" },
              { time: "2027-2028", event: "国产丝杠突破内螺纹磨削瓶颈，百万台级别供应链成形，行业出清" },
              { time: "2029-2030", event: "全球百万台量产，千亿级市场，头部集中度提升，国产龙头全球竞争" },
            ].map(({ time, event }) => (
              <div key={time} className="flex gap-3 text-xs">
                <span className="font-mono font-semibold text-primary shrink-0 w-16">{time}</span>
                <span className="text-muted-foreground leading-relaxed">{event}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 6. 板块结论 ── */}
      <div className="border rounded-xl p-5 bg-card space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">板块结论</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm leading-relaxed">
          <div className="space-y-2">
            <p className="font-medium text-foreground/90">🟢 核心看多逻辑</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
              <li>2026 年是人形机器人量产元年，特斯拉 Optimus 从工程验证进入 10 万台级量产</li>
              <li>核心零部件占整机成本 50%+，国产替代空间大（丝杠仅 20%，传感器/减速器已突破）</li>
              <li>哈默纳科专利到期、磨床国产化、内资传感器份额反超——三大国产替代催化剂共振</li>
              <li>中国在全球高自由度灵巧手市场占 &gt;80%，整机厂（宇树/智元/优必选）出货量全球领先</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground/90">🔴 核心风险</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
              <li>特斯拉量产进度不及预期（2025 实际仅数百台）→ 全链条需求延后</li>
              <li>行星滚柱丝杠国产化率仅 20%，内螺纹磨削+高端磨床仍是硬瓶颈</li>
              <li>触觉传感器为灵巧手最大短板（实验室 10 万→消费级百元，鸿沟巨大）</li>
              <li>行业估值泡沫——部分标的 PE 超 500 倍，业绩兑现不及预期将大幅回调</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HumanoidRobot() {
  const [activeTab, setActiveTab] = useState(0);
  const isOverview = activeTab === 0;
  const currentSector = SECTORS[activeTab];
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">人形机器人板块</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-muted transition-colors text-sm disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          刷新
        </button>
      </div>

      {/* Tab bar */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1 min-w-max">
          {SECTORS.map((sector, idx) => (
            <button
              key={sector.key}
              onClick={() => setActiveTab(idx)}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                idx === activeTab
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {sector.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isOverview ? (
        <IndustryOverview />
      ) : currentSector.key === "reports" ? (
        <ReportLibrary key={refreshKey} />
      ) : (
        <SectorTemplate label={currentSector.label} sectorKey={currentSector.key} />
      )}
    </div>
  );
}
