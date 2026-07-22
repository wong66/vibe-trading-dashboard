import { useState, useEffect, useCallback } from "react";
import { ChevronRight, RefreshCw, Cpu, Factory, Gem, Drill, Cog, Shield, BarChart3, TrendingUp, FileText, Calendar, Building2, Tag, ExternalLink, Gauge, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type IndustryReport } from "@/lib/api";
import {
  SECTORS,
  SECTOR_CONTENT,
  SECTOR_STOCKS,
  REPORT_SECTORS,
  SECTOR_COLORS,
  CORE_COMPONENTS,
} from "@/lib/aiComputeData";

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

      {/* ── 6. 全球竞争格局 ── */}
      {content?.globalCompetition && content.globalCompetition.length > 0 && (
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Globe className="h-4 w-4" />
            全球{label}竞争格局
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium w-[3rem]">排名</th>
                  <th className="px-3 py-2 text-left font-medium w-[7rem]">公司</th>
                  <th className="px-3 py-2 text-left font-medium w-[4rem]">国家</th>
                  <th className="px-3 py-2 text-left font-medium w-[4.5rem]">市占率</th>
                  <th className="px-3 py-2 text-left font-medium">核心优势</th>
                  <th className="px-3 py-2 text-left font-medium w-[6rem]">A股关联度</th>
                </tr>
              </thead>
              <tbody>
                {content.globalCompetition.map((entry, idx) => (
                  <tr key={`${entry.company}-${idx}`} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      {typeof entry.rank === "number" ? (
                        <span className={cn(
                          "inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold shrink-0",
                          entry.rank === 1 ? "bg-amber-500 text-white" :
                          entry.rank === 2 ? "bg-gray-400 text-white" :
                          entry.rank === 3 ? "bg-orange-700 text-white" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {entry.rank}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{entry.rank}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{entry.company}</td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{entry.country}</td>
                    <td className="px-3 py-2.5">
                      {entry.share ? (
                        <span className="font-semibold text-primary">{entry.share}</span>
                      ) : (
                        <span className="text-muted-foreground/50">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground leading-relaxed max-w-[280px]">{entry.advantage}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {entry.arelation ? (
                        <span className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          entry.arelation.includes("直接") ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                          entry.arelation.includes("间接") ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {entry.arelation}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center leading-relaxed">
            数据来源：东方财富研报平台 · AI算力板块研报综合整理
          </p>
        </div>
      )}
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
      const res = await api.getIndustryReports("ai-compute");
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
            <span className="text-sm text-muted-foreground/70">上游硅基/化合物材料</span>
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
            <Cpu className="h-4 w-4 text-danger/60" />
            <span className="text-sm font-medium text-danger/80">AI 数据中心</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 text-center leading-relaxed">
          上游硅基材料、化合物半导体、封装基板 → 八大核心环节 → 英伟达/AMD/华为/寒武纪等算力整机厂商。<br />
          2025 年全球 AI 算力基础设施支出预计突破 3000 亿美元，2030 年有望冲击万亿美元级别。
        </p>
      </div>

      {/* ── 2. 八大核心环节卡片 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
              <span className="text-sm font-medium">先进制程晶圆</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI 算力芯片依赖 5nm/3nm 先进制程，台积电 CoWoS 封装产能为核心瓶颈。2025 年 CoWoS 月产能预计突破 7 万片。
            </p>
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/20">
            <div className="flex items-center gap-2">
              <Cog className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">封装基板与材料</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ABF 载板、玻璃基板、EMIB 等先进封装材料决定芯片互连密度。玻璃基板有望在 2027-2028 年替代硅中介层进入量产。
            </p>
          </div>
          <div className="border rounded-lg p-3 space-y-1 bg-muted/20">
            <div className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">光刻与量测设备</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              ASML EUV 光刻机、KLA 量测设备为核心卡脖子环节。国产光刻机/量测设备仍处于追赶阶段，是算力产业链最大瓶颈。
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
              { label: "产业空间", score: 5, note: "2030 年全球万亿美元级别市场" },
              { label: "国产替代进程", score: 3, note: "芯片/先进封装受限，光模块/PCB 已突破" },
              { label: "技术壁垒", score: 5, note: "先进制程+封装+互联，壁垒极高" },
              { label: "量产确定性", score: 4, note: "英伟达 Blackwell 2025H2 放量，国产 GPU 追赶" },
              { label: "政策支持", score: 5, note: "新质生产力核心方向，大基金三期加持" },
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
            <Cpu className="h-4 w-4" />
            核心标的池
          </h3>
          <div className="space-y-1.5 text-xs">
            {[
              { name: "寒武纪", code: "688256", why: "国产 AI 芯片龙头，思元系列，云端推理+训练全覆盖" },
              { name: "海光信息", code: "688041", why: "国产 x86 CPU+GPU 双线，深算系列对标英伟达" },
              { name: "中际旭创", code: "300308", why: "全球光模块龙头，800G/1.6T 领先放量" },
              { name: "沪电股份", code: "002463", why: "AI 服务器 PCB 龙头，高阶 HDI 全球领先" },
              { name: "深南电路", code: "002916", why: "封装基板龙头，FC-BGA 载板国产突破" },
              { name: "英维克", code: "002837", why: "液冷散热龙头，英伟达 NVL 方案核心供应商" },
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

      {/* ── 5. 整机成本构成 + 技术路线时间轴 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Drill className="h-4 w-4" />
            AI 服务器成本构成
          </h3>
          <div className="space-y-2">
            {[
              { part: "GPU/算力芯片", pct: 55, note: "最大成本项，英伟达 GPU 垄断定价" },
              { part: "HBM 高带宽存储", pct: 15, note: "HBM3E 12Hi 单价 $2500+，需求紧缺" },
              { part: "光模块/互连", pct: 8, note: "800G→1.6T 升级周期，单机价值量持续提升" },
              { part: "PCB/载板", pct: 6, note: "高多层+高阶 HDI，AI 单机 ASP $3000+" },
              { part: "液冷散热", pct: 8, note: "GPU TDP 突破 1000W，液冷成标配" },
              { part: "电源/MLCC/其他", pct: 8, note: "电源模块+被动元件 3-5× 用量提升" },
            ].map(({ part, pct, note }) => (
              <div key={part} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{part}</span>
                  <span className="font-mono font-medium">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct * 1.5}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground/60">{note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="border rounded-xl p-4 bg-card space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            技术路线演进
          </h3>
          <div className="space-y-3">
            {[
              { time: "2024", event: "英伟达 H200/B200 发布，HBM3E 量产，1.6T 光模块送样" },
              { time: "2025H1", event: "Blackwell 平台量产，CoWoS-L 封装，液冷渗透率突破 30%" },
              { time: "2025H2", event: "Rubin 平台发布，HBM4 送样，CPO 共封装光学商用化启动" },
              { time: "2026-2027", event: "1.6T 光模块规模放量，玻璃基板进入量产验证，液冷成数据中心标配" },
              { time: "2028-2030", event: "硅光/CPO 大规模商用，HBM4 量产，玻璃基板替代硅中介层，算力成本断崖式下降" },
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
              <li>AI 大模型 Scaling Law 延续，算力需求指数级增长，2025-2030 年全球 AI 算力 Capex CAGR &gt;30%</li>
              <li>英伟达 Blackwell → Rubin 平台迭代加速，配套产业链（光模块/HBM/液冷）同步升级放量</li>
              <li>国产算力芯片（寒武纪/海光/昇腾）生态加速完善，国产替代从 0→1 导入期进入 1→10 爆发期</li>
              <li>光模块/PCB/液冷等环节中国厂商全球份额持续提升，AI 算力是确定性最高的产业趋势</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground/90">🔴 核心风险</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
              <li>美国对华 AI 芯片制裁升级——BIS 出口管制可能进一步收紧先进 GPU/光刻设备供应</li>
              <li>大模型 Scaling Law 触及天花板，算力需求增速放缓，导致产业链库存积压</li>
              <li>HBM/CoWoS 产能高度集中于 SK 海力士 + 台积电，地缘风险不可忽视</li>
              <li>部分环节（如 CPO/玻璃基板）技术路线仍未收敛，押注单一技术路径存在失败风险</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AICompute() {
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
        <h1 className="text-2xl font-bold tracking-tight">AI 算力板块</h1>
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
