import type {
  DcaPlan,
  IntradayPoint,
  MarketIndex,
  NewsItem,
  PaperOrder,
  PipelineStage,
  Position,
  SectorFlow,
  StrategyDefinition,
} from "../types";

export const strategies: StrategyDefinition[] = [
  {
    id: "momentum",
    name: "趋势动量",
    shortName: "动量",
    description: "捕捉中期价格趋势，在强势延续阶段提高仓位。",
    tag: "趋势",
    color: "#2563eb",
  },
  {
    id: "mean-reversion",
    name: "均值回归",
    shortName: "回归",
    description: "识别短期偏离，在价格回归统计中枢时获利。",
    tag: "反转",
    color: "#0f766e",
  },
  {
    id: "breakout",
    name: "波动突破",
    shortName: "突破",
    description: "以波动区间和成交量确认捕捉方向性突破。",
    tag: "波动",
    color: "#d97706",
  },
  {
    id: "multi-factor",
    name: "多因子精选",
    shortName: "多因子",
    description: "综合质量、估值、动量和低波动因子进行排序。",
    tag: "选股",
    color: "#7c3aed",
  },
  {
    id: "dca",
    name: "定投建仓",
    shortName: "定投",
    description: "定期定额投入，平滑市场波动，适合长期建仓。",
    tag: "定投",
    color: "#059669",
  },
];

export const dcaPlans: DcaPlan[] = [
  {
    id: "dca-001",
    name: "沪深300指数定投",
    symbol: "510300",
    symbolName: "沪深300ETF",
    totalAmount: 120000,
    perInvestAmount: 10000,
    interval: "monthly",
    startDate: "2026-01-15",
    currentInvested: 60000,
    currentShares: 15600,
    averageCost: 3.846,
    currentValue: 62400,
    profitPercent: 4.0,
    status: "active",
    takeProfitPercent: 20,
    stopLossPercent: 0,
  },
  {
    id: "dca-002",
    name: "科创50周定投",
    symbol: "588000",
    symbolName: "科创50ETF",
    totalAmount: 52000,
    perInvestAmount: 2000,
    interval: "weekly",
    startDate: "2026-03-01",
    currentInvested: 32000,
    currentShares: 28400,
    averageCost: 1.127,
    currentValue: 31200,
    profitPercent: -2.5,
    status: "active",
    takeProfitPercent: 15,
    stopLossPercent: 10,
  },
  {
    id: "dca-003",
    name: "中证红利月定投",
    symbol: "515080",
    symbolName: "中证红利ETF",
    totalAmount: 60000,
    perInvestAmount: 5000,
    interval: "monthly",
    startDate: "2026-02-01",
    currentInvested: 25000,
    currentShares: 20000,
    averageCost: 1.25,
    currentValue: 27500,
    profitPercent: 10.0,
    status: "active",
    takeProfitPercent: 25,
    stopLossPercent: 0,
  },
];

export const marketIndices: MarketIndex[] = [
  { symbol: "000001", name: "上证指数", value: 3521.84, change: 0.68, turnover: "5,286 亿" },
  { symbol: "399001", name: "深证成指", value: 10794.32, change: 1.12, turnover: "7,142 亿" },
  { symbol: "399006", name: "创业板指", value: 2238.61, change: 1.46, turnover: "3,018 亿" },
  { symbol: "000300", name: "沪深 300", value: 4146.28, change: 0.74, turnover: "3,492 亿" },
];

export const intradayData: IntradayPoint[] = [
  { time: "09:30", price: 3498, average: 3498, volume: 44 },
  { time: "10:00", price: 3510, average: 3505, volume: 68 },
  { time: "10:30", price: 3506, average: 3507, volume: 52 },
  { time: "11:00", price: 3518, average: 3510, volume: 61 },
  { time: "11:30", price: 3515, average: 3511, volume: 39 },
  { time: "13:00", price: 3517, average: 3512, volume: 31 },
  { time: "13:30", price: 3528, average: 3516, volume: 59 },
  { time: "14:00", price: 3523, average: 3518, volume: 48 },
  { time: "14:30", price: 3532, average: 3520, volume: 72 },
  { time: "15:00", price: 3521.84, average: 3521, volume: 84 },
];

export const sectorFlows: SectorFlow[] = [
  { name: "半导体", flow: 28.4, change: 2.91 },
  { name: "工业软件", flow: 19.7, change: 2.34 },
  { name: "证券", flow: 12.1, change: 1.52 },
  { name: "新能源车", flow: 7.8, change: 1.18 },
  { name: "食品饮料", flow: -5.4, change: -0.62 },
  { name: "银行", flow: -9.6, change: -0.44 },
];

export const newsItems: NewsItem[] = [
  {
    id: "news-1",
    source: "上交所",
    time: "14:36",
    title: "多家半导体企业披露上半年业绩预增公告",
    symbols: ["688981", "688012"],
    sentiment: "positive",
  },
  {
    id: "news-2",
    source: "央行",
    time: "13:20",
    title: "公开市场操作保持流动性合理充裕",
    symbols: ["银行", "证券"],
    sentiment: "neutral",
  },
  {
    id: "news-3",
    source: "深交所",
    time: "11:48",
    title: "新能源产业链公司提示原材料价格波动风险",
    symbols: ["300750"],
    sentiment: "negative",
  },
  {
    id: "news-4",
    source: "工信部",
    time: "10:12",
    title: "工业软件与智能制造融合应用试点扩围",
    symbols: ["软件", "智能制造"],
    sentiment: "positive",
  },
];

export const positions: Position[] = [
  { symbol: "600519", name: "贵州茅台", quantity: 120, averagePrice: 1468.2, currentPrice: 1492.6, weight: 24.8 },
  { symbol: "300750", name: "宁德时代", quantity: 560, averagePrice: 247.8, currentPrice: 253.4, weight: 20.1 },
  { symbol: "688981", name: "中芯国际", quantity: 1800, averagePrice: 88.5, currentPrice: 93.2, weight: 18.7 },
  { symbol: "601318", name: "中国平安", quantity: 2400, averagePrice: 51.3, currentPrice: 52.1, weight: 14.0 },
];

export const paperOrders: PaperOrder[] = [
  { id: "PO-260711-04", time: "14:31", symbol: "688981", side: "买入", quantity: 400, price: 92.86, status: "已成交" },
  { id: "PO-260711-03", time: "13:42", symbol: "300750", side: "卖出", quantity: 120, price: 252.72, status: "已成交" },
  { id: "PO-260711-02", time: "10:18", symbol: "600519", side: "买入", quantity: 20, price: 1488.0, status: "已成交" },
  { id: "PO-260711-01", time: "09:46", symbol: "601318", side: "买入", quantity: 600, price: 51.92, status: "已成交" },
];

export const pipelineStages: PipelineStage[] = [
  {
    name: "候选策略生成",
    description: "从参数空间生成可解释的策略候选。",
    status: "done",
    detail: "完成 24 / 24",
  },
  {
    name: "样本外验证",
    description: "使用隔离时间窗口检查泛化表现。",
    status: "done",
    detail: "通过 7 / 24",
  },
  {
    name: "模拟盘观察",
    description: "在延迟行情和成本约束下持续跟踪。",
    status: "running",
    detail: "运行第 8 天",
  },
  {
    name: "风险人工审批",
    description: "确认数据、仓位、回撤和行为边界。",
    status: "review",
    detail: "等待复核",
  },
];
