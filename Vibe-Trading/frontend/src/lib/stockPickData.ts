import {
  TrendingUp, Shield, Gem, Target, Zap, Rocket,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

export interface SectorDashboardData {
  changePct: number;
  changeAmt: number;
  upCount: number;
  limitUpCount: number;
  downCount: number;
  limitDownCount: number;
  mainInflow: number;     // 亿元
  mainInflowMom: number;   // 环比 %
  totalVolume: number;     // 亿元
  volumeMom: number;       // 环比 %
}

export interface KlineItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  mainFlow: number;
  pe?: number;                // 行业估值（动态市盈率 TTM）
  pb?: number;                // 市净率
}

export interface TopStock {
  rank: number;
  code: string;
  name: string;
  changePct?: number;
  mainInflow?: number;
}

export interface StockScore {
  mainlineStrength: number;    // 主线强度
  productPurity: number;       // 产品纯度
  fundTrend: number;           // 资金趋势
  earningsSupport: number;     // 业绩/订单支撑
}

export interface PickStock {
  code: string;
  name: string;
  concepts: string[];
  allConcepts: string[];
  scores: StockScore;
  grade: "A" | "B";
  changePct: number;
  mainInflow: number;         // 万元
  tags: string[];             // 核心属性标签
  logicLabels: string[];      // 六大逻辑标签
  scoreDetails: {             // 展开详情
    radarData: { name: string; value: number; max: number }[];
    volumeAnalysis: string;
    breakthroughCheck: string;
    fundamentalBrief: string;
  };
}

// ── Constants ───────────────────────────────────────────────────────────

export const HOT_SECTORS = [
  "半导体", "AI算力", "新能源", "锂电", "军工", "医药", "消费电子", "机器人", "油气",
];

export const LOGIC_LABELS = [
  { key: "domestic_sub", label: "国产替代", icon: Shield, color: "#3b82f6" },
  { key: "demand_upgrade", label: "需求升级", icon: TrendingUp, color: "#f59e0b" },
  { key: "strategic_revalue", label: "战略重估", icon: Gem, color: "#8b5cf6" },
  { key: "earnings_deliver", label: "业绩兑现", icon: Target, color: "#10b981" },
  { key: "fund_cluster", label: "资金抱团", icon: Zap, color: "#ef4444" },
  { key: "position_structure", label: "位置结构", icon: Rocket, color: "#06b6d4" },
];

export const AUX_FILTERS = [
  { key: "volume_20d", label: "20日量价筛选" },
  { key: "breakout_5d", label: "5日突破筛选" },
  { key: "fundamental", label: "基本面门槛" },
  { key: "exclude_risk", label: "排除风险标的" },
];

export const DEFAULT_THRESHOLDS = {
  mainlineStrength: 70,
  productPurity: 60,
  fundTrend: 60,
  earningsSupport: 50,
};

// ── Mock / Demo Data ────────────────────────────────────────────────────

export const SECTOR_BASE_PE: Record<string, number> = {
  "半导体": 68, "AI算力": 55, "机器人": 45, "新能源": 28, "军工": 42,
  "医药": 35, "消费电子": 22, "油气": 12, "锂电": 25,
};

export function generateMockKline(days: number, sector?: string): KlineItem[] {
  // 不同行业给不同基准 PE，让估值差异更真实
  const basePE = SECTOR_BASE_PE[sector || ""] || 30;

  const data: KlineItem[] = [];
  let price = 1000;
  let pe = basePE;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const change = (Math.random() - 0.48) * 30;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 15;
    const low = Math.min(open, close) - Math.random() * 15;
    const volume = Math.floor(Math.random() * 5000 + 2000);
    const mainFlow = (Math.random() - 0.45) * 2000;

    // PE 随价格小幅漂移，但也会被业绩消化（带均值回归）
    const peChange = (close / price - 1) * 0.6 + (Math.random() - 0.5) * 1.2 - (pe - basePE) * 0.02;
    pe = Math.max(basePE * 0.6, Math.min(basePE * 1.8, pe + peChange));

    data.push({
      date: d.toISOString().slice(0, 10),
      open: +open.toFixed(2),
      close: +close.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      volume,
      mainFlow: +mainFlow.toFixed(0),
      pe: +pe.toFixed(2),
      pb: +(pe / 3.5 + (Math.random() - 0.5) * 0.8).toFixed(2),
    });
    price = close;
  }
  return data;
}

export const MOCK_SECTOR_DASHBOARD: Record<string, SectorDashboardData> = {
  "半导体": {
    changePct: 3.25, changeAmt: 28.5, upCount: 86, limitUpCount: 12,
    downCount: 23, limitDownCount: 0, mainInflow: 45.8, mainInflowMom: 23.5,
    totalVolume: 1280, volumeMom: 18.2,
  },
  "AI算力": {
    changePct: -1.52, changeAmt: -15.8, upCount: 34, limitUpCount: 3,
    downCount: 78, limitDownCount: 2, mainInflow: -22.3, mainInflowMom: -15.6,
    totalVolume: 890, volumeMom: -8.5,
  },
  "机器人": {
    changePct: 5.68, changeAmt: 42.1, upCount: 95, limitUpCount: 18,
    downCount: 12, limitDownCount: 0, mainInflow: 68.2, mainInflowMom: 45.3,
    totalVolume: 1560, volumeMom: 32.8,
  },
  "新能源": {
    changePct: 0.85, changeAmt: 6.2, upCount: 55, limitUpCount: 5,
    downCount: 48, limitDownCount: 1, mainInflow: 8.5, mainInflowMom: 5.2,
    totalVolume: 720, volumeMom: 3.1,
  },
  "军工": {
    changePct: 2.15, changeAmt: 18.3, upCount: 72, limitUpCount: 8,
    downCount: 18, limitDownCount: 0, mainInflow: 32.6, mainInflowMom: 18.8,
    totalVolume: 960, volumeMom: 12.5,
  },
  "医药": {
    changePct: -0.68, changeAmt: -5.2, upCount: 42, limitUpCount: 2,
    downCount: 68, limitDownCount: 1, mainInflow: -12.8, mainInflowMom: -8.3,
    totalVolume: 650, volumeMom: -5.2,
  },
  "消费电子": {
    changePct: 1.88, changeAmt: 12.5, upCount: 65, limitUpCount: 6,
    downCount: 32, limitDownCount: 0, mainInflow: 22.4, mainInflowMom: 15.6,
    totalVolume: 780, volumeMom: 10.3,
  },
  "油气": {
    changePct: 1.35, changeAmt: 8.8, upCount: 48, limitUpCount: 4,
    downCount: 28, limitDownCount: 0, mainInflow: 15.2, mainInflowMom: 8.5,
    totalVolume: 580, volumeMom: 5.8,
  },
  "锂电": {
    changePct: 2.18, changeAmt: 14.5, upCount: 68, limitUpCount: 7,
    downCount: 26, limitDownCount: 0, mainInflow: 35.6, mainInflowMom: 20.8,
    totalVolume: 920, volumeMom: 14.2,
  },
};

// Sector-specific stock pools
export const SECTOR_STOCKS: Record<string, { code: string; name: string; concepts: string[]; fundamentals: string }[]> = {
  "半导体": [
    { code: "002371", name: "北方华创", concepts: ["半导体设备","先进封装"], fundamentals: "半导体设备龙头，国产替代核心标的，28nm以下刻蚀/薄膜设备量产验证通过，订单覆盖18个月产能。" },
    { code: "688012", name: "中微公司", concepts: ["半导体设备","刻蚀"], fundamentals: "等离子体刻蚀设备国内领先，5nm节点验证通过，MOCVD设备全球前三。" },
    { code: "688981", name: "中芯国际", concepts: ["晶圆制造","先进制程"], fundamentals: "大陆晶圆代工龙头，14nm量产，N+1/N+2工艺逐步导入。" },
    { code: "603501", name: "韦尔股份", concepts: ["CIS芯片","图像传感"], fundamentals: "全球CIS三强，车载/安防/手机三线驱动，国产替代空间大。" },
    { code: "002049", name: "紫光国微", concepts: ["特种芯片","FPGA"], fundamentals: "特种IC龙头，军工+信创双轮驱动，FPGA国产替代加速。" },
    { code: "688536", name: "思瑞浦", concepts: ["模拟芯片","信号链"], fundamentals: "信号链模拟芯片领先，产品线持续扩充，工业/汽车级认证齐全。" },
    { code: "300661", name: "圣邦股份", concepts: ["模拟芯片","电源管理"], fundamentals: "国内模拟芯片品类最全，电源/信号链双线，替代TI/ADI空间大。" },
    { code: "603986", name: "兆易创新", concepts: ["存储芯片","MCU"], fundamentals: "NOR Flash全球前三，MCU国产龙头，DRAM布局推进中。" },
    { code: "688256", name: "寒武纪", concepts: ["AI芯片","智能计算"], fundamentals: "AI芯片国产化核心标的，思元系列迭代，算力基建受益。" },
    { code: "300782", name: "卓胜微", concepts: ["射频前端","滤波器"], fundamentals: "射频前端国产替代标杆，分立器件向模组化升级。" },
    { code: "688008", name: "澜起科技", concepts: ["内存接口","DDR5"], fundamentals: "DDR5内存接口芯片全球领先，PCIe Retimer放量。" },
    { code: "600703", name: "三安光电", concepts: ["化合物半导体","MiniLED"], fundamentals: "化合物半导体综合平台，碳化硅/氮化镓产能建设积极推进。" },
    { code: "002916", name: "深南电路", concepts: ["IC载板","PCB"], fundamentals: "高端IC封装基板龙头，ABF载板突破在即，受益先进封装。" },
    { code: "603290", name: "斯达半导", concepts: ["IGBT","功率器件"], fundamentals: "国产IGBT模块龙头，车规级产品已批量供货，市占率持续提升。" },
    { code: "688396", name: "华润微", concepts: ["功率器件","晶圆代工"], fundamentals: "功率半导体IDM龙头，MOSFET/IGBT/SiC全线布局。" },
  ],
  "AI算力": [
    { code: "688256", name: "寒武纪", concepts: ["AI芯片","算力"], fundamentals: "国产AI芯片龙头，思元系列持续迭代，大模型训练推理全覆盖。" },
    { code: "000977", name: "浪潮信息", concepts: ["AI服务器","云计算"], fundamentals: "国内AI服务器市占率第一，JDM模式深入绑定头部互联网客户。" },
    { code: "603019", name: "中科曙光", concepts: ["超算","AI服务器"], fundamentals: "国产超算龙头，海光芯片生态，算力基建主力军。" },
    { code: "300308", name: "中际旭创", concepts: ["光模块","800G"], fundamentals: "全球光模块龙头，800G/1.6T领先量产，AI数据中心最大受益者。" },
    { code: "300502", name: "新易盛", concepts: ["光模块","数通"], fundamentals: "高速光模块核心供应商，400G/800G批量出货，北美云厂主力。" },
    { code: "300394", name: "天孚通信", concepts: ["光器件","光引擎"], fundamentals: "光无源器件全球领先，光引擎切入增量市场。" },
    { code: "002335", name: "科华数据", concepts: ["液冷","数据中心"], fundamentals: "数据中心液冷方案领先，腾讯/字节等核心供应商。" },
    { code: "600602", name: "云赛智联", concepts: ["IDC","算力服务"], fundamentals: "上海国资IDC龙头，算力租赁+数据要素双驱动。" },
    { code: "688111", name: "金山办公", concepts: ["AI应用","SaaS"], fundamentals: "国产办公软件绝对龙头，WPS AI全面接入大模型。" },
    { code: "300033", name: "同花顺", concepts: ["金融AI","大模型"], fundamentals: "金融科技龙头，AI赋能投研/投顾，大模型应用深化。" },
    { code: "002415", name: "海康威视", concepts: ["AI视觉","边缘计算"], fundamentals: "AI视觉全球领先，观澜大模型发布，企业级AI落地标杆。" },
    { code: "002230", name: "科大讯飞", concepts: ["大模型","语音AI"], fundamentals: "星火大模型持续迭代，教育/医疗/汽车场景多点开花。" },
    { code: "688041", name: "海光信息", concepts: ["GPU","算力芯片"], fundamentals: "国产GPU龙头，深算系列对标NVIDIA，信创+AI双驱动。" },
    { code: "300476", name: "胜宏科技", concepts: ["AI PCB","HDI"], fundamentals: "AI服务器PCB核心供应商，高多层板市占率快速提升。" },
    { code: "603893", name: "瑞芯微", concepts: ["端侧AI","SoC"], fundamentals: "端侧AI SoC龙头，智能音箱/平板/机器视觉场景全面覆盖。" },
  ],
  "机器人": [
    { code: "300124", name: "汇川技术", concepts: ["伺服系统","工业机器人"], fundamentals: "国产伺服龙头，人形机器人关节模组核心供应商。" },
    { code: "688017", name: "绿的谐波", concepts: ["谐波减速器","机器人"], fundamentals: "国产谐波减速器龙头，人形机器人关节核心零部件。" },
    { code: "300024", name: "机器人", concepts: ["工业机器人","系统集成"], fundamentals: "中科院系机器人平台，焊接/装配机器人市占率领先。" },
    { code: "002747", name: "埃斯顿", concepts: ["工业机器人","控制器"], fundamentals: "国产工业机器人龙头，自主控制器+伺服系统全覆盖。" },
    { code: "603486", name: "科沃斯", concepts: ["服务机器人","扫地机"], fundamentals: "全球服务机器人龙头，家用+商用双线，AI赋能清洁。" },
    { code: "688165", name: "埃夫特", concepts: ["工业机器人","系统集成"], fundamentals: "科创板机器人第一股，汽车/光伏行业深度布局。" },
    { code: "603728", name: "鸣志电器", concepts: ["步进电机","灵巧手"], fundamentals: "精密电机龙头，空心杯电机切入人形机器人灵巧手。" },
    { code: "002979", name: "雷赛智能", concepts: ["运动控制","控制器"], fundamentals: "运动控制核心供应商，PLC/伺服/步进全线产品。" },
    { code: "300660", name: "江苏雷利", concepts: ["微特电机","机器人关节"], fundamentals: "微特电机龙头，空心杯电机批量供货，人形机器人受益。" },
    { code: "688160", name: "步科股份", concepts: ["低压伺服","协作机器人"], fundamentals: "低压伺服系统领先，协作机器人/AGV场景深度布局。" },
    { code: "301368", name: "丰立智能", concepts: ["精密减速器","传动"], fundamentals: "精密传动件领先，行星减速器量产，谐波研发推进。" },
    { code: "688025", name: "杰普特", concepts: ["机器视觉","激光"], fundamentals: "MOPA激光器龙头，机器视觉检测切入机器人产业链。" },
    { code: "600835", name: "上海机电", concepts: ["电梯","智能制造"], fundamentals: "上海电气工业自动化平台，精密减速器布局人形机器人。" },
    { code: "603416", name: "信捷电气", concepts: ["PLC","控制系统"], fundamentals: "小型PLC国产龙头，控制器+伺服+变频器整体方案。" },
    { code: "300567", name: "精测电子", concepts: ["机器视觉","AOI检测"], fundamentals: "面板检测龙头，机器视觉检测技术延伸至半导体/新能源。" },
  ],
  "新能源": [
    { code: "300750", name: "宁德时代", concepts: ["动力电池","储能"], fundamentals: "全球动力电池龙头，市占率超35%，麒麟电池/凝聚态电池持续创新。" },
    { code: "002594", name: "比亚迪", concepts: ["新能源车","刀片电池"], fundamentals: "新能源车全球销量冠军，垂直一体化+出海战略推进。" },
    { code: "601012", name: "隆基绿能", concepts: ["光伏","硅片"], fundamentals: "光伏硅片/组件双龙头，HBC电池效率持续刷新纪录。" },
    { code: "300274", name: "阳光电源", concepts: ["逆变器","储能"], fundamentals: "全球逆变器/储能系统龙头，海外电站业务高速增长。" },
    { code: "688599", name: "天合光能", concepts: ["光伏组件","分布式"], fundamentals: "大尺寸组件龙头，210mm技术路线行业领跑。" },
    { code: "002129", name: "中环股份", concepts: ["硅片","半导体材料"], fundamentals: "210mm大硅片技术领先，光伏+半导体双赛道。" },
    { code: "300763", name: "锦浪科技", concepts: ["组串逆变器","分布式"], fundamentals: "户用逆变器龙头，海外分布式市场市占率领先。" },
    { code: "688390", name: "固德威", concepts: ["储能逆变器","户用"], fundamentals: "储能逆变器全球领先，海外户用储能爆发收益。" },
    { code: "603806", name: "福斯特", concepts: ["光伏胶膜","封装材料"], fundamentals: "光伏胶膜全球龙头，市占率超50%，POE胶膜受益N型。" },
    { code: "300118", name: "东方日升", concepts: ["光伏组件","HJT"], fundamentals: "HJT电池技术领先，异质结效率持续突破。" },
    { code: "688223", name: "晶科能源", concepts: ["光伏组件","TOPCon"], fundamentals: "TOPCon电池出货量全球第一，技术路线红利持续释放。" },
    { code: "002459", name: "晶澳科技", concepts: ["光伏组件","N型"], fundamentals: "垂直一体化组件龙头，N型产能占比快速提升。" },
    { code: "601615", name: "明阳智能", concepts: ["风电","海上风电"], fundamentals: "海上风电机组龙头，16MW超大机型全球首发。" },
    { code: "300014", name: "亿纬锂能", concepts: ["锂电池","储能"], fundamentals: "大圆柱电池量产先锋，储能电池出货量位居前列。" },
    { code: "688005", name: "容百科技", concepts: ["正极材料","高镍"], fundamentals: "三元正极材料龙头，高镍/超高镍出货量行业第一。" },
  ],
  "军工": [
    { code: "600760", name: "中航沈飞", concepts: ["战斗机","军机"], fundamentals: "军用战斗机总装龙头，J-15/J-16放量，歼-35隐身舰载机列装。" },
    { code: "600893", name: "航发动力", concepts: ["航空发动机","军品"], fundamentals: "军用航空发动机唯一整机平台，WS-10/WZ-10等型号批产。" },
    { code: "002013", name: "中航机电", concepts: ["航空机电","系统"], fundamentals: "军用航空机电系统龙头，飞控/电源/环控系统全覆盖。" },
    { code: "600862", name: "中航高科", concepts: ["航空复材","碳纤维"], fundamentals: "军用航空复合材料龙头，歼-20/运-20核心材料供应商。" },
    { code: "002025", name: "航天电器", concepts: ["军用连接器","宇航"], fundamentals: "军用高端连接器龙头，导弹/卫星/火箭核心配套。" },
    { code: "000733", name: "振华科技", concepts: ["军用电子","芯片"], fundamentals: "军工电子元器件旗舰，IGBT/MLCC/LTCC等品类齐全。" },
    { code: "300034", name: "钢研高纳", concepts: ["高温合金","航空"], fundamentals: "高温合金龙头，航空发动机涡轮叶片核心材料。" },
    { code: "688122", name: "西部超导", concepts: ["超导","航空钛合金"], fundamentals: "高端钛合金/高温合金龙头，航空/舰船材料核心供应商。" },
    { code: "600184", name: "光电股份", concepts: ["军用光电","红外"], fundamentals: "军用光电器件龙头，红外制导/光电侦察系统核心。" },
    { code: "300777", name: "中简科技", concepts: ["碳纤维","军工材料"], fundamentals: "高性能碳纤维龙头，航空航天级ZT7/ZT9系列批量供货。" },
    { code: "002389", name: "航天彩虹", concepts: ["军用无人机","航天"], fundamentals: "军用无人机龙头，彩虹系列出口全球，察打一体。" },
    { code: "600391", name: "航发科技", concepts: ["航空发动机","部件"], fundamentals: "航空发动机叶片/盘环件核心供应商，内贸/外贸双轮。" },
    { code: "688281", name: "华秦科技", concepts: ["隐身材料","特种功能"], fundamentals: "隐身材料绝对龙头，歼-20/歼-35等型号核心配套。" },
    { code: "300114", name: "中航电测", concepts: ["航空测试","MEMS"], fundamentals: "航空测试设备龙头，传感器/MEMS军民用全覆盖。" },
    { code: "300775", name: "三角防务", concepts: ["航空锻件","结构件"], fundamentals: "航空锻件龙头，机身/起落架/发动机盘轴等结构件核心。" },
  ],
  "医药": [
    { code: "600276", name: "恒瑞医药", concepts: ["创新药","抗肿瘤"], fundamentals: "国内创新药龙头，PD-1/ADC/GLP-1管线丰富，国际化推进。" },
    { code: "603259", name: "药明康德", concepts: ["CXO","CRDMO"], fundamentals: "全球CXO龙头，一体化CRDMO平台，新分子布局领先。" },
    { code: "300760", name: "迈瑞医疗", concepts: ["医疗器械","监护"], fundamentals: "国内医疗器械龙头，监护/超声/体外诊断三线发力。" },
    { code: "002007", name: "华兰生物", concepts: ["血液制品","疫苗"], fundamentals: "血液制品龙头，浆站资源稀缺，流感疫苗市占率第一。" },
    { code: "300122", name: "智飞生物", concepts: ["疫苗","代理"], fundamentals: "国内疫苗龙头，代理+自研双轮，HPV疫苗持续放量。" },
    { code: "688029", name: "南微医学", concepts: ["内镜耗材","微创"], fundamentals: "内镜诊疗耗材龙头，海外增长驱动，产品结构升级。" },
    { code: "300759", name: "康龙化成", concepts: ["CXO","药物发现"], fundamentals: "药物发现CXO龙头，实验室服务+CMC+临床全覆盖。" },
    { code: "603392", name: "万泰生物", concepts: ["HPV疫苗","体外诊断"], fundamentals: "国产HPV疫苗唯一，9价HPV疫苗获批在即。" },
    { code: "688180", name: "君实生物", concepts: ["创新药","PD-1"], fundamentals: "PD-1抑制剂出海第一梯队，国际化里程碑突破。" },
    { code: "300896", name: "爱美客", concepts: ["医美","玻尿酸"], fundamentals: "医美注射剂龙头，嗨体/濡白天使等独家产品放量。" },
    { code: "688513", name: "苑东生物", concepts: ["仿制药","创新药"], fundamentals: "特色原料药+制剂一体化，研发管线差异化，CDMO承接。" },
    { code: "688520", name: "神州细胞", concepts: ["重组蛋白","血友病"], fundamentals: "重组凝血因子龙头，血友病长效产品国内独家。" },
    { code: "300685", name: "艾德生物", concepts: ["肿瘤基因检测","伴随诊断"], fundamentals: "肿瘤伴随诊断龙头，检测试剂覆盖肺癌/肠癌等大癌种。" },
    { code: "688202", name: "美迪西", concepts: ["临床前CRO","药物评价"], fundamentals: "临床前CRO领先，一站式药物研发服务平台。" },
    { code: "300347", name: "泰格医药", concepts: ["临床CRO","数统"], fundamentals: "临床CRO龙头，国内临床资源丰富，海外增长可期。" },
  ],
  "消费电子": [
    { code: "002475", name: "立讯精密", concepts: ["精密制造","连接器"], fundamentals: "消费电子精密制造龙头，苹果核心供应商，汽车电子拓展。" },
    { code: "300433", name: "蓝思科技", concepts: ["玻璃盖板","智能穿戴"], fundamentals: "玻璃盖板全球龙头，苹果/特斯拉核心供应商，AR/VR布局。" },
    { code: "002241", name: "歌尔股份", concepts: ["声学","VR/AR"], fundamentals: "声学器件全球龙头，VR/AR整机代工第一，Meta/Pico核心。" },
    { code: "603160", name: "汇顶科技", concepts: ["指纹识别","触控"], fundamentals: "指纹识别芯片龙头，超声波屏下指纹领先，IoT扩展。" },
    { code: "300782", name: "卓胜微", concepts: ["射频前端","SAW滤波器"], fundamentals: "射频前端国产替代标杆，滤波器/PA模组化升级。" },
    { code: "002600", name: "领益智造", concepts: ["精密功能件","散热"], fundamentals: "消费电子精密功能件龙头，散热/磁材/充电器多元化。" },
    { code: "300115", name: "长盈精密", concepts: ["金属结构件","电池盒"], fundamentals: "消费电子金属结构件龙头，新能源电池盒爆发增长。" },
    { code: "603678", name: "火炬电子", concepts: ["被动元器件","MLCC"], fundamentals: "军用MLCC龙头，消费/工业MLCC全系列覆盖。" },
    { code: "300408", name: "三环集团", concepts: ["陶瓷元件","MLCC"], fundamentals: "电子陶瓷龙头，MLCC/陶瓷基板/光纤插芯品类齐全。" },
    { code: "002045", name: "国光电器", concepts: ["电声器件","智能音箱"], fundamentals: "电声器件龙头，智能音箱整机ODM，AI音箱受益。" },
    { code: "300136", name: "信维通信", concepts: ["天线","无线充电"], fundamentals: "射频天线龙头，苹果/华为核心供应商，LCP天线升级。" },
    { code: "300709", name: "精研科技", concepts: ["MIM零件","折叠屏"], fundamentals: "MIM粉末注射成型龙头，折叠屏铰链核心供应商。" },
    { code: "688036", name: "传音控股", concepts: ["手机","非洲市场"], fundamentals: "非洲手机之王，智能机渗透率提升+新市场拓展。" },
    { code: "002056", name: "横店东磁", concepts: ["磁性材料","器件"], fundamentals: "永磁/软磁材料龙头，消费电子+新能源双驱动。" },
    { code: "688533", name: "上声电子", concepts: ["车载音响","扬声器"], fundamentals: "车载扬声器龙头，智能座舱声学方案升级驱动增长。" },
  ],
  "油气": [
    { code: "601857", name: "中国石油", concepts: ["油气开采","炼化"], fundamentals: "国内最大油气生产商，上游资源储量丰富，股息率稳定。" },
    { code: "600028", name: "中国石化", concepts: ["炼油","化工"], fundamentals: "国内最大炼化企业，成品油/化工品全产业链，高股息。" },
    { code: "600938", name: "中国海油", concepts: ["海上油气","勘探"], fundamentals: "国内海上油气绝对龙头，低成本+高分红，深海资源持续发现。" },
    { code: "600583", name: "海油工程", concepts: ["海洋工程","油气服务"], fundamentals: "海上油气工程龙头，深水铺管/安装核心能力。" },
    { code: "601808", name: "中海油服", concepts: ["油田服务","钻井"], fundamentals: "海上油田技术服务龙头，亚太最大海上钻井平台船队。" },
    { code: "603619", name: "中曼石油", concepts: ["钻井工程","海外"], fundamentals: "民营钻井服务龙头，海外中东/非洲市场布局深入。" },
    { code: "002207", name: "准油股份", concepts: ["油田技术服务"], fundamentals: "新疆油田技术服务核心供应商，油服细分领域领先。" },
    { code: "300157", name: "新锦动力", concepts: ["油气装备","压裂"], fundamentals: "油气高端装备龙头，压裂设备/连续油管技术领先。" },
    { code: "002278", name: "神开股份", concepts: ["钻采设备","井控"], fundamentals: "石油钻采设备龙头，防喷器/井口装置市场占有率高。" },
    { code: "300084", name: "海默科技", concepts: ["多相流量计","测井"], fundamentals: "多相计量技术全球领先，深海/页岩油领域核心设备。" },
    { code: "000852", name: "石化机械", concepts: ["钻头","井下工具"], fundamentals: "金刚石钻头国内龙头，页岩气/深井钻探核心工具。" },
    { code: "688377", name: "迪威尔", concepts: ["特种管材","管材"], fundamentals: "油气特种合金管材领先，深海/耐腐蚀管材核心供应商。" },
    { code: "002774", name: "快意电梯", concepts: ["电梯","特种设备"], fundamentals: "电梯行业领先，中东/东南亚等油气富集区工程渗透。" },
    { code: "001332", name: "锡装股份", concepts: ["压力容器","换热器"], fundamentals: "工业换热器领先，炼化/化工行业核心设备供应商。" },
    { code: "688257", name: "新锐股份", concepts: ["硬质合金","钻头"], fundamentals: "硬质合金工具龙头，油田开采钻头/矿用工具双轮。" },
  ],
  "锂电": [
    { code: "300750", name: "宁德时代", concepts: ["动力电池","储能电池"], fundamentals: "全球动力电池龙头，市占率超35%，麒麟/凝聚态电池持续迭代。" },
    { code: "002594", name: "比亚迪", concepts: ["刀片电池","新能源车"], fundamentals: "新能源车全球冠军，刀片电池+CTB技术，垂直整合优势明显。" },
    { code: "300014", name: "亿纬锂能", concepts: ["大圆柱电池","储能"], fundamentals: "4680大圆柱电池量产先锋，储能电池出货量全球前列。" },
    { code: "002074", name: "国轩高科", concepts: ["磷酸铁锂","动力电池"], fundamentals: "大众入股赋能，磷酸铁锂电池技术领先，全球产能布局。" },
    { code: "002460", name: "赣锋锂业", concepts: ["锂资源","锂盐"], fundamentals: "全球锂资源龙头，阿根廷/澳洲/非洲锂矿布局，一体化闭环。" },
    { code: "002466", name: "天齐锂业", concepts: ["锂矿","锂盐"], fundamentals: "控股全球最大在产锂矿Greenbushes，SQM第一大股东。" },
    { code: "688005", name: "容百科技", concepts: ["三元正极","高镍"], fundamentals: "三元正极材料龙头，高镍/超高镍出货量全球第一。" },
    { code: "300769", name: "德方纳米", concepts: ["磷酸铁锂正极","补锂剂"], fundamentals: "磷酸铁锂正极龙头，液相法技术优势，新型补锂剂打开空间。" },
    { code: "002709", name: "天赐材料", concepts: ["电解液","六氟磷酸锂"], fundamentals: "电解液全球龙头，六氟/LiFSI自供率高，成本优势显著。" },
    { code: "300037", name: "新宙邦", concepts: ["电解液","氟化工"], fundamentals: "电解液龙头，海外布局加速，氟化工第二增长曲线。" },
    { code: "603659", name: "璞泰来", concepts: ["负极材料","涂覆隔膜"], fundamentals: "负极材料+涂覆隔膜双龙头，一体化布局降低客户成本。" },
    { code: "688779", name: "长远锂科", concepts: ["正极材料","三元"], fundamentals: "五矿集团旗下正极材料平台，产能快速扩张，客户结构优质。" },
    { code: "688116", name: "天奈科技", concepts: ["碳纳米管","导电剂"], fundamentals: "碳纳米管导电浆料全球龙头，渗透率提升+硅基负极新需求。" },
    { code: "300457", name: "赢合科技", concepts: ["锂电设备","前段设备"], fundamentals: "锂电设备龙头，涂布/辊压等前段设备市占率第一。" },
    { code: "300432", name: "富临精工", concepts: ["磷酸铁锂","汽零"], fundamentals: "磷酸铁锂正极新锐，产能快速释放，汽零业务稳健。" },
  ],
};

// Default fallback stocks for unknown sectors
export const FALLBACK_STOCKS: { code: string; name: string; concepts: string[]; fundamentals: string }[] = [
  { code: "002371", name: "北方华创", concepts: ["高端制造","国产替代"], fundamentals: "高端制造设备龙头，国产替代核心标的。" },
  { code: "600519", name: "贵州茅台", concepts: ["白酒","消费升级"], fundamentals: "白酒行业绝对龙头，品牌壁垒深，现金流充裕。" },
  { code: "300750", name: "宁德时代", concepts: ["锂电池","新能源"], fundamentals: "全球动力电池龙头，市占率超35%。" },
  { code: "000858", name: "五粮液", concepts: ["白酒","高端消费"], fundamentals: "浓香白酒龙头，品牌力/渠道力双强。" },
  { code: "601318", name: "中国平安", concepts: ["保险","金融科技"], fundamentals: "综合金融集团龙头，科技赋能保险主业。" },
  { code: "002594", name: "比亚迪", concepts: ["新能源车","整车"], fundamentals: "新能源车全球冠军，垂直一体化+出海战略。" },
  { code: "601012", name: "隆基绿能", concepts: ["光伏","新能源"], fundamentals: "光伏硅片/组件双龙头，持续技术创新。" },
  { code: "600276", name: "恒瑞医药", concepts: ["创新药","医药"], fundamentals: "国内创新药龙头，研发管线深厚。" },
  { code: "600036", name: "招商银行", concepts: ["银行","零售"], fundamentals: "零售银行之王，财富管理业务行业领先。" },
  { code: "000333", name: "美的集团", concepts: ["家电","智能制造"], fundamentals: "白电龙头，全球化+ToB业务驱动增长。" },
  { code: "600900", name: "长江电力", concepts: ["水电","清洁能源"], fundamentals: "国内最大水电上市公司，现金流稳定。" },
  { code: "601899", name: "紫金矿业", concepts: ["黄金","有色"], fundamentals: "全球矿业巨头，铜/金/锂矿产资源丰富。" },
];

export const TAG_POOL = [
  "国产替代", "订单落地", "突破前高", "机构重仓", "北向增持",
  "客户验证通过", "量价齐升", "底部放量", "平台突破", "景气上行",
  "政策催化", "产能释放",
];

export function generateMockPickStocks(sector: string): PickStock[] {
  const pool = SECTOR_STOCKS[sector] || FALLBACK_STOCKS;
  const conceptPool = [...new Set(pool.flatMap(s => s.concepts))];

  return pool.map((n, i) => {
    const scores: StockScore = {
      mainlineStrength: 55 + Math.floor(Math.random() * 40),
      productPurity: 45 + Math.floor(Math.random() * 45),
      fundTrend: 50 + Math.floor(Math.random() * 40),
      earningsSupport: 40 + Math.floor(Math.random() * 50),
    };
    const met = [scores.mainlineStrength >= 70, scores.productPurity >= 60, scores.fundTrend >= 60, scores.earningsSupport >= 50].filter(Boolean).length;
    const grade: "A" | "B" = met >= 3 ? "A" : met >= 2 ? "B" : "B";
    const allConcepts = [...new Set([...n.concepts, ...conceptPool.slice(i % conceptPool.length, i % conceptPool.length + 3)])];
    return {
      code: n.code,
      name: n.name,
      concepts: n.concepts.slice(0, 2),
      allConcepts,
      scores,
      grade,
      changePct: +(Math.random() * 10 - 3).toFixed(2),
      mainInflow: +((Math.random() - 0.4) * 5000).toFixed(0),
      tags: [TAG_POOL[i % TAG_POOL.length], TAG_POOL[(i + 3) % TAG_POOL.length], TAG_POOL[(i + 7) % TAG_POOL.length]],
      logicLabels: [
        LOGIC_LABELS[i % LOGIC_LABELS.length].key,
        LOGIC_LABELS[(i + 2) % LOGIC_LABELS.length].key,
      ],
      scoreDetails: {
        radarData: [
          { name: "主线强度", value: scores.mainlineStrength, max: 100 },
          { name: "产品纯度", value: scores.productPurity, max: 100 },
          { name: "资金趋势", value: scores.fundTrend, max: 100 },
          { name: "业绩支撑", value: scores.earningsSupport, max: 100 },
        ],
        volumeAnalysis: `近20日均量较前20日均值放大${(20 + Math.floor(Math.random() * 60))}%，累计涨幅${(5 + Math.random() * 20).toFixed(1)}%，主力资金净流入占流通市值${(0.5 + Math.random() * 2.5).toFixed(1)}%。`,
        breakthroughCheck: `近5日均换手率较前20日均值放大${(30 + Math.floor(Math.random() * 80))}%，股价${Math.random() > 0.3 ? "已突破" : "接近"}近3个月平台高点` + (Math.random() > 0.5 ? "，确认有效突破" : "，待放量确认"),
        fundamentalBrief: n.fundamentals,
      },
    };
  }).filter(s => s.grade === "A" || s.grade === "B");
}

// Sector-specific top stocks
export function generateTopStocks(pool: PickStock[]): { gain: TopStock[]; flow: TopStock[] } {
  const sortedByGain = [...pool].sort((a, b) => b.changePct - a.changePct).slice(0, 5);
  const sortedByFlow = [...pool].sort((a, b) => b.mainInflow - a.mainInflow).slice(0, 5);
  return {
    gain: sortedByGain.map((s, i) => ({ rank: i + 1, code: s.code, name: s.name, changePct: s.changePct })),
    flow: sortedByFlow.map((s, i) => ({ rank: i + 1, code: s.code, name: s.name, mainInflow: s.mainInflow })),
  };
}

// ── Helper Functions ────────────────────────────────────────────────────

export function formatMoney(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(2) + "亿";
  if (abs >= 1e4) return (val / 1e4).toFixed(1) + "万";
  return val.toFixed(0);
}

export function formatFlow(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(2) + "亿";
  if (abs >= 1e4) return (val / 1e4).toFixed(1) + "万";
  return val.toFixed(0);
}

export function pctColor(val: number): string {
  if (val > 0) return "text-danger";
  if (val < 0) return "text-success";
  return "text-muted-foreground";
}

export function scoreColor(val: number, threshold: number): string {
  return val >= threshold ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";
}
