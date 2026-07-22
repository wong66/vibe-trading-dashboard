import { Cog, Drill, Zap, Gauge, Hand, Wrench } from "lucide-react";

// ── sector data ──────────────────────────────────────────────────────────

export interface SectorDef {
  key: string;
  label: string;
}

export const SECTORS: SectorDef[] = [
  { key: "overview", label: "总览" },
  { key: "harmonic_reducer", label: "谐波减速器" },
  { key: "planetary_roller_screw", label: "行星滚柱丝杠" },
  { key: "frameless_motor", label: "无框力矩电机" },
  { key: "six_axis_sensor", label: "六维力传感器" },
  { key: "dexterous_hand", label: "灵巧手" },
  { key: "ball_screw", label: "滚珠丝杠" },
  { key: "reports", label: "研报库" },
];

export interface SectorContent {
  positioning: string;        // 环节定位
  intlLandscape: string;       // 国际竞争格局
  domLandscape: string;        // 国内竞争格局
  techBarrier: string;         // 科技壁垒
  capacityBarrier: string;     // 产能壁垒
}

export const SECTOR_CONTENT: Record<string, SectorContent> = {
  harmonic_reducer: {
    positioning:
      "旋转关节核心传动部件，负责将电机高速低扭矩转换为低速高扭矩输出，适配小臂腕部等轻载精密场景。" +
      "单台人形机器人用量 10–20 台（特斯拉 Optimus 20 台），占整机 BOM 成本约 8–12%。",
    intlLandscape:
      "日本哈默纳科（Harmonic Drive）全球市占率约 58%，长期垄断高端市场，核心专利布局严密。" +
      "日系（哈默纳科 + Nidec-Shimpo）合计占全球 70% 以上。",
    domLandscape:
      "绿的谐波全球第二（12–15%），国产绝对龙头。中大力德、来福机器人、同川科技等快速追赶。" +
      "2025 年内资国内市占率首次过半。哈默纳科核心专利陆续到期，国产替代窗口明确打开。",
    techBarrier:
      "柔轮精密加工需微米级精度，热处理工艺直接影响寿命与精度保持性。" +
      "从研发到稳定量产需 5–8 年积累。材料（特种钢材 + 精密轴承）纯度与疲劳寿命要求极高。",
    capacityBarrier:
      "自研设备能力决定扩产速度——核心加工设备（高精度磨齿机等）长期依赖进口。" +
      "绿的谐波已实现五轴加工中心、数控系统、检测设备自研突破，产能瓶颈逐步打开。",
  },
  planetary_roller_screw: {
    positioning:
      "线性关节核心传动部件，将旋转运动转换为直线运动，是人形机器人大腿/大臂等高负载关节的不可替代部件。" +
      "价值量占整机 BOM 约 19%，为单一零部件中价值量最高的环节。单台 Optimus 14 根。承载力为滚珠丝杠 3–6 倍，寿命 10–15 倍。",
    intlLandscape:
      "欧洲企业主导全球约 80% 份额：瑞士 Rollvis / GSA、瑞典/德国 Ewellix (Schaeffler)、德国 Bosch Rexroth。" +
      "欧美企业长期垄断高端行星滚柱丝杠市场。",
    domLandscape:
      "国产化率仅约 20%，是人形机器人产业链中替代空间最大的环节。" +
      "恒立液压（定增 15 亿布局）、北特科技（特斯拉链送样）、五洲新春（98 万套产能规划）为第一梯队。" +
      "2026–2028 年为国产替代关键窗口期。",
    techBarrier:
      "内螺纹精密磨削为最大瓶颈——大长径比螺母磨削时砂轮磨杆极易颤振，严重影响精度。" +
      "正向研发设计涉及啮合理论、多体接触力学、材料科学等多学科交叉。",
    capacityBarrier:
      "高端磨床被欧日出口管制，进口难度大、交付周期长。" +
      "国产螺纹磨床精度逐步跟上但核心部件仍有差距。产能规模化释放仍需设备自主突破。",
  },
  frameless_motor: {
    positioning:
      "旋转/线性关节的动力源，取消外壳与轴承仅保留定转子，实现高扭矩密度与紧凑设计。" +
      "单台 Optimus 28 个执行器均搭载无框力矩电机。2026 年全球人形机器人电机市场空间约 39 亿元，2030 年有望达 918 亿元（CAGR 120%）。",
    intlLandscape:
      "Kollmorgen（美，开创者）、TQ RoboDrive（德，DLR 航天技术）、Nidec（日，特斯拉核心供应商）主导高端。" +
      "Maxon（瑞士）、Faulhaber（德）垄断空心杯电机全球 60%+ 份额。",
    domLandscape:
      "雷赛智能（无框 30 万台/年 + 空心杯 12 万台/年产能）、步科股份（第四代 + 一体化方案）、" +
      "汇川技术（伺服国内市占率第一 30.1%）、伟创电气（产品矩阵最完整）。国产价格仅为海外 50–70%，核心参数已追平。",
    techBarrier:
      "市场普遍低估壁垒——'高扭矩密度–低转矩波动–强过载能力'不可能三角。" +
      "灵巧手场景转矩波动需控制在 2% 以内。需在毫米级空间实现多参数极致平衡。空心杯电机核心专利多被海外垄断。",
    capacityBarrier:
      "量产一致性与良品率控制为核心考验。竞争焦点已从技术突破转向成本控制与规模化交付能力。" +
      "国产厂商凭借响应速度与头部整机厂深度协同，正加速蚕食海外份额。",
  },
  six_axis_sensor: {
    positioning:
      "力觉感知核心，同时测量 Fx/Fy/Fz/Mx/My/Mz 六个分量，用于精密力控装配与灵巧操作。" +
      "单台机器人 4–6 颗（腕部 + 踝部）。2030 年全球需求 232 万套（东吴证券），市场空间 328 亿元。产业链价值排序：丝杠 > 六维力 > 无框力矩电机 > 减速器 > 空心杯。",
    intlLandscape:
      "ATI（美，精度标杆）、Schunk（德）、Kistler（瑞士）、FANUC（日）、Bota Systems（瑞士）为海外龙头。" +
      "海外单价约 10 万元/颗，成本高企限制大规模商用。",
    domLandscape:
      "2025 年内资市占率 58.8%，首次反超外资。坤维科技（国内机器人领域 >50%）、宇立仪器（拓展欧美）、" +
      "柯力传感（送样 50 家本体厂）。国产单价约 2.7 万元/颗，性价比优势显著。",
    techBarrier:
      "弹性体结构设计与多维力解耦为最核心难点——维间耦合解耦技术难度极高。" +
      "标定精度、长期漂移/温漂控制、抗电磁干扰、高带宽低时延均为关键挑战。标定设备自研能力本身也是壁垒。",
    capacityBarrier:
      "高成本与可靠性仍是量产瓶颈。冲击工况过载保护与高循环标定一致性要求极高。" +
      "应变片粘贴工艺、封装工艺的良率控制决定产能天花板。从实验室到量产线需工艺体系重构。",
  },
  dexterous_hand: {
    positioning:
      "机器人末端执行器，物理世界交互接口，直接决定机器人的操作能力上限。" +
      "技术路线三足鼎立：直驱（高精度）、连杆（低成本）、腱绳（高自由度仿生）。" +
      "特斯拉 Optimus 三代预计 2026Q1 发布，全球高自由度灵巧手市场灵心巧手市占率超 80%。",
    intlLandscape:
      "Shadow Robot（英）、Schunk（德）为传统海外龙头，但在高自由度灵巧手领域已被中国企业超越。" +
      "整机厂自研：特斯拉 Optimus、智元 OmniHand、宇树 Dex5 各有技术方案。",
    domLandscape:
      "灵心巧手（全球高自由度份额 >80%，月交付破千台，全球最轻量产手 370g）、" +
      "因时机器人（2025 年交付破万台，全栈自研）、帕西尼感知（触觉传感器壁垒，估值破百亿）。兆威机电 ZWHAND B20 直驱方案。",
    techBarrier:
      "触觉感知为最大短板——现有灵巧手'能抓不会摸'。实验室高精度传感器单价高达 10 万元，消费级指尖 BOM 需控制在百元级。" +
      "腱绳材料成本高（钨丝腱绳 160 万次寿命但单套万元+）。'高出力–高精度–轻量化'不可能三角。",
    capacityBarrier:
      "精密装配仍依赖人工，软硬件接口碎片化，缺乏统一测试标准。" +
      "多技术融合（电容/压电/压阻/光学/霍尔）+ 感控一体是量产前提。产业链从'能用'到'会用'再到'会学'的范式跃迁尚未完成。",
  },
  ball_screw: {
    positioning:
      "相对于行星滚柱丝杠，滚珠丝杠承载力与寿命较低但成本更低、技术更成熟，适用于灵巧手微型化和中低负载关节。" +
      "单台机器人灵巧手用量 12–50 根微型滚珠丝杠。2025 年全球人形机器人滚珠丝杠市场约 18.5 亿元。",
    intlLandscape:
      "日本 THK、NSK，中国台湾上银、银泰主导中高端精密丝杠市场，日台合计全球约 60%+。" +
      "欧美在高端机床丝杠领域仍有深厚积累。",
    domLandscape:
      "恒立液压（定增布局年产 10.4 万根标准滚珠丝杠产能）、南方精工（获优必选 Walker S 订单，单机 14 个）、" +
      "江苏雷利（丝杠模组集成方案，成本较行业低 20%）。国产化速度快于行星滚柱丝杠。",
    techBarrier:
      "精密螺纹磨削为核心工艺，大长径比 / 大螺旋角加工难度高。但与行星滚柱丝杠相比，滚珠丝杠技术成熟度更高，" +
      "壁垒相对较低。高端丝杠精度等级（C0–C1 级）仍由日台把控。",
    capacityBarrier:
      "高端磨床进口限制同样存在。规模化下的精度一致性与良品率控制是产能释放关键。" +
      "国产磨床精度逐步跟上，但在超高精度等级仍有差距。",
  },
};

// ── Stock-level data ────────────────────────────────────────────────────

export interface StockScoreEntry {
  code: string;
  name: string;
  irreplaceability: number; // 1-5 不可替代性
  valuation: number;         // 1-5 估值吸引力（5=低估值）
  performance: number;       // 1-5 业绩增长
  customer: number;          // 1-5 客户质量
  management: number;        // 1-5 管理层
  overall: string;           // 综合评分
  note: string;              // 备注
}

export const SECTOR_STOCKS: Record<string, StockScoreEntry[]> = {
  harmonic_reducer: [
    {
      code: "688017", name: "绿的谐波",
      irreplaceability: 5, valuation: 1, performance: 5, customer: 5, management: 5,
      overall: "★★★★★", note: "谐波全球第二，特斯拉 Optimus 独家供应商，在手订单超48亿",
    },
    {
      code: "002472", name: "双环传动",
      irreplaceability: 4, valuation: 4, performance: 3, customer: 4, management: 4,
      overall: "★★★★", note: "RV+谐波双线布局，汽车齿轮基本盘稳健，特斯拉/比亚迪链",
    },
    {
      code: "002896", name: "中大力德",
      irreplaceability: 4, valuation: 2, performance: 3, customer: 3, management: 3,
      overall: "★★★★", note: "RV+谐波+行星三轮驱动，国产第二梯队领先，优必选/埃斯顿客户",
    },
    {
      code: "688160", name: "步科股份",
      irreplaceability: 3, valuation: 3, performance: 5, customer: 4, management: 4,
      overall: "★★★", note: "无框力矩电机国内龙头，减速器配套补充，小米/优必选深度绑定",
    },
  ],
  planetary_roller_screw: [
    {
      code: "601100", name: "恒立液压",
      irreplaceability: 5, valuation: 5, performance: 4, customer: 5, management: 5,
      overall: "★★★★★", note: "定增15亿布局丝杠，特斯拉最大供应商(份额≥70%)，远期百万套产能",
    },
    {
      code: "603009", name: "北特科技",
      irreplaceability: 4, valuation: 3, performance: 3, customer: 3, management: 3,
      overall: "★★★★", note: "汽车转向齿条工艺同源，行星滚柱丝杠送样特斯拉链，进度领先",
    },
    {
      code: "603667", name: "五洲新春",
      irreplaceability: 4, valuation: 4, performance: 3, customer: 3, management: 4,
      overall: "★★★★", note: "定增98万套行星滚柱丝杠产能规划，规模最大，已入头部机器人供应链",
    },
    {
      code: "300100", name: "双林股份",
      irreplaceability: 3, valuation: 4, performance: 3, customer: 3, management: 3,
      overall: "★★★", note: "收购科之鑫掌握螺纹磨床，反向式丝杠突破，特斯拉二级供应链",
    },
  ],
  frameless_motor: [
    {
      code: "002979", name: "雷赛智能",
      irreplaceability: 5, valuation: 2, performance: 5, customer: 5, management: 5,
      overall: "★★★★★", note: "无框电机年产能30万台，灵巧手已批量供应，覆盖80%国内机器人厂商",
    },
    {
      code: "688160", name: "步科股份",
      irreplaceability: 5, valuation: 3, performance: 5, customer: 4, management: 4,
      overall: "★★★★★", note: "无框力矩电机国内龙头，Q1出货+246%，第四代产品+氮化镓驱动",
    },
    {
      code: "300124", name: "汇川技术",
      irreplaceability: 4, valuation: 4, performance: 3, customer: 4, management: 5,
      overall: "★★★★", note: "伺服国内市占率第一(30.1%)，工控龙头平台化布局关节模组",
    },
    {
      code: "688698", name: "伟创电气",
      irreplaceability: 3, valuation: 4, performance: 3, customer: 2, management: 3,
      overall: "★★★", note: "产品矩阵最完整(无框/空心杯/轴向磁通)，多客户送样中",
    },
  ],
  six_axis_sensor: [
    {
      code: "603662", name: "柯力传感",
      irreplaceability: 5, valuation: 3, performance: 4, customer: 4, management: 4,
      overall: "★★★★★", note: "六维力送样超70家，小批量交付，华为/小鹏链，MEMS硅基研发中",
    },
    {
      code: "300007", name: "汉威科技",
      irreplaceability: 4, valuation: 4, performance: 3, customer: 3, management: 3,
      overall: "★★★★", note: "气体+力+柔性多传感器平台，品类最全，机器人增量可期",
    },
    {
      code: "002338", name: "奥普光电",
      irreplaceability: 3, valuation: 3, performance: 3, customer: 2, management: 3,
      overall: "★★★", note: "精密光电传感技术积累，编码器+力传感器协同布局",
    },
  ],
  dexterous_hand: [
    {
      code: "003021", name: "兆威机电",
      irreplaceability: 5, valuation: 3, performance: 4, customer: 4, management: 5,
      overall: "★★★★★", note: "灵巧手龙头，ZWHAND B20全驱量产，订单超6亿，苏州10万套产能",
    },
    {
      code: "603728", name: "鸣志电器",
      irreplaceability: 4, valuation: 3, performance: 3, customer: 3, management: 4,
      overall: "★★★★", note: "空心杯电机打破海外垄断，特斯拉送样，国际供应链导入",
    },
    {
      code: "002747", name: "埃斯顿",
      irreplaceability: 4, valuation: 3, performance: 3, customer: 4, management: 4,
      overall: "★★★★", note: "国产工业机器人第一，基本盘稳固，人形机器人整机+部件双布局",
    },
    {
      code: "688017", name: "绿的谐波",
      irreplaceability: 4, valuation: 1, performance: 5, customer: 5, management: 5,
      overall: "★★★★", note: "谐波全球第二延伸至关节总成+灵巧手微型减速器，特斯拉链核心",
    },
  ],
  ball_screw: [
    {
      code: "601100", name: "恒立液压",
      irreplaceability: 5, valuation: 5, performance: 4, customer: 5, management: 5,
      overall: "★★★★★", note: "10.4万根滚珠丝杠产能，远期百万套，特斯拉份额≥70%，300+机床客户",
    },
    {
      code: "002553", name: "南方精工",
      irreplaceability: 4, valuation: 4, performance: 3, customer: 3, management: 3,
      overall: "★★★★", note: "微型滚珠丝杠领先，获优必选Walker S独家订单(单机14个)，灵巧手适配",
    },
    {
      code: "300660", name: "江苏雷利",
      irreplaceability: 3, valuation: 5, performance: 3, customer: 2, management: 3,
      overall: "★★★", note: "空心杯+丝杠模组集成方案，成本较行业低20%，傅利叶智能验证通过",
    },
    {
      code: "300580", name: "贝斯特",
      irreplaceability: 3, valuation: 4, performance: 3, customer: 2, management: 3,
      overall: "★★★", note: "行星滚柱+滚珠丝杠双线布局，精密加工技术积累，汽车基本盘支撑",
    },
  ],
};

// ── Report Library constants ─────────────────────────────────────────────

export const REPORT_SECTORS = ["全部", "机器人", "减速器", "丝杠", "执行器", "灵巧手"] as const;

export const SECTOR_COLORS: Record<string, string> = {
  "机器人": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "减速器": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "丝杠": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "执行器": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "灵巧手": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

// ── IndustryOverview constants ───────────────────────────────────────────

export const CORE_COMPONENTS = [
  { key: "harmonic_reducer", label: "谐波减速器", icon: Cog, desc: "关节传动核心", stat: "日系 CR~70%，国产~15%" },
  { key: "planetary_roller_screw", label: "行星滚柱丝杠", icon: Drill, desc: "线性执行器", stat: "BOM 占比 19%，国产~20%" },
  { key: "frameless_motor", label: "无框力矩电机", icon: Zap, desc: "动力输出", stat: "2030 年市场 918 亿" },
  { key: "six_axis_sensor", label: "六维力传感器", icon: Gauge, desc: "力觉反馈", stat: "国产 58.8% 首超外资" },
  { key: "dexterous_hand", label: "灵巧手", icon: Hand, desc: "末端执行", stat: "中国高自由度 >80%" },
  { key: "ball_screw", label: "滚珠丝杠", icon: Wrench, desc: "精密传动", stat: "日台主导 ~60%+" },
] as const;
