export type ViewId = "overview" | "strategy" | "market" | "account" | "learning" | "settings";

export type AccountModuleTab =
  | "portfolio"
  | "trading"
  | "orders"
  | "risk"
  | "strategies"
  | "monitor"
  | "logs";

export type StrategyModuleStage = "configure" | "backtest" | "validate" | "observe";

export type MarketModuleTab =
  | "a-share"
  | "turning"
  | "stock"
  | "regime"
  | "hong-kong"
  | "futures"
  | "external"
  | "crypto"
  | "events"
  | "esoteric";

export type SettingsModuleSection = "profile" | "execution" | "account";

export type LearningModuleSection =
  | "pipeline"
  | "weekly-review"
  | "memory"
  | "daily-review"
  | "paper-plan"
  | "optimization";

export interface ModuleCatalogItem {
  id: string;
  view: ViewId;
  path: string;
  query?: Record<string, string>;
  group: string;
  label: string;
  description: string;
  keywords: string[];
}

const catalog: ModuleCatalogItem[] = [
  {
    id: "overview",
    view: "overview",
    path: "/",
    group: "工作台",
    label: "总览",
    description: "账户、行情、每日任务和核心入口。",
    keywords: ["首页", "工作台", "今日"],
  },
  {
    id: "market",
    view: "market",
    path: "/market",
    group: "市场研究",
    label: "市场研究",
    description: "进入 A 股与跨市场研究工作台。",
    keywords: ["行情", "研判", "市场"],
  },
  {
    id: "market-a-share",
    view: "market",
    path: "/market",
    query: { tab: "a-share" },
    group: "市场研究",
    label: "A 股概览",
    description: "指数、涨跌分布和 A 股市场快照。",
    keywords: ["大盘", "指数", "a股"],
  },
  {
    id: "market-turning",
    view: "market",
    path: "/market",
    query: { tab: "turning" },
    group: "市场研究",
    label: "变盘雷达",
    description: "识别波动、量能和结构变化。",
    keywords: ["变盘", "拐点", "雷达"],
  },
  {
    id: "market-stock",
    view: "market",
    path: "/market",
    query: { tab: "stock" },
    group: "市场研究",
    label: "个股研判",
    description: "查看个股趋势预测和研究证据。",
    keywords: ["个股", "股票", "趋势"],
  },
  {
    id: "market-regime",
    view: "market",
    path: "/market",
    query: { tab: "regime" },
    group: "市场研究",
    label: "板块形态",
    description: "观察板块强弱、轮动和市场状态。",
    keywords: ["板块", "轮动", "形态"],
  },
  {
    id: "market-hong-kong",
    view: "market",
    path: "/market",
    query: { tab: "hong-kong" },
    group: "市场研究",
    label: "港股观察",
    description: "港股指数和重点资产观察。",
    keywords: ["港股", "恒生"],
  },
  {
    id: "market-futures",
    view: "market",
    path: "/market",
    query: { tab: "futures" },
    group: "市场研究",
    label: "期货研判",
    description: "期货市场状态和跨资产线索。",
    keywords: ["期货", "商品"],
  },
  {
    id: "market-external",
    view: "market",
    path: "/market",
    query: { tab: "external" },
    group: "市场研究",
    label: "全球影响",
    description: "外盘隔夜、亚洲市场和风险偏好。",
    keywords: ["全球", "美股", "外盘"],
  },
  {
    id: "market-crypto",
    view: "market",
    path: "/market",
    query: { tab: "crypto" },
    group: "市场研究",
    label: "数字资产",
    description: "BTC、ETH 与数字资产市场观察。",
    keywords: ["crypto", "比特币", "以太坊"],
  },
  {
    id: "market-events",
    view: "market",
    path: "/market",
    query: { tab: "events" },
    group: "市场研究",
    label: "事件资讯",
    description: "市场新闻、事件和影响线索。",
    keywords: ["新闻", "资讯", "事件"],
  },
  {
    id: "market-esoteric",
    view: "market",
    path: "/market",
    query: { tab: "esoteric" },
    group: "市场研究",
    label: "玄学观察",
    description: "明确标注为研究的辅助观察模块。",
    keywords: ["玄学", "周期", "辅助"],
  },
  {
    id: "strategy",
    view: "strategy",
    path: "/strategy",
    group: "策略研究",
    label: "策略工作流",
    description: "配置、回测、验证和观察策略。",
    keywords: ["策略", "实验"],
  },
  {
    id: "strategy-configure",
    view: "strategy",
    path: "/strategy",
    query: { stage: "configure" },
    group: "策略研究",
    label: "配置与运行回测",
    description: "选择策略、调整参数并生成确定性回测。",
    keywords: ["回测配置", "参数", "运行"],
  },
  {
    id: "strategy-backtest",
    view: "strategy",
    path: "/strategy",
    query: { stage: "backtest" },
    group: "策略研究",
    label: "回测结果对比",
    description: "查看收益、回撤、交易成本和策略横向对比。",
    keywords: ["回测", "收益", "回撤"],
  },
  {
    id: "strategy-validate",
    view: "strategy",
    path: "/strategy",
    query: { stage: "validate" },
    group: "策略研究",
    label: "稳健性验证",
    description: "读取真实样本排行榜和窗口稳健性结果。",
    keywords: ["验证", "稳健性", "排行榜"],
  },
  {
    id: "strategy-observe",
    view: "strategy",
    path: "/strategy",
    query: { stage: "observe" },
    group: "策略研究",
    label: "候选与观察",
    description: "查看候选池、质量股票和 Paper 观察项。",
    keywords: ["候选", "观察", "股票池"],
  },
  {
    id: "account",
    view: "account",
    path: "/account",
    group: "Paper 交易",
    label: "模拟账户",
    description: "查看账户、下单、订单、风控和监控。",
    keywords: ["账户", "paper"],
  },
  {
    id: "account-portfolio",
    view: "account",
    path: "/account",
    query: { tab: "portfolio" },
    group: "Paper 交易",
    label: "持仓",
    description: "当前模拟持仓、市值和浮动盈亏。",
    keywords: ["持仓", "资产", "仓位"],
  },
  {
    id: "account-trading",
    view: "account",
    path: "/account",
    query: { tab: "trading" },
    group: "Paper 交易",
    label: "模拟下单",
    description: "提交受风控约束的本地 Paper 订单。",
    keywords: ["下单", "买入", "卖出"],
  },
  {
    id: "account-orders",
    view: "account",
    path: "/account",
    query: { tab: "orders" },
    group: "Paper 交易",
    label: "订单与成交",
    description: "查看成交价、金额、策略来源和拒单原因。",
    keywords: ["订单", "成交", "拒单"],
  },
  {
    id: "account-risk",
    view: "account",
    path: "/account",
    query: { tab: "risk" },
    group: "Paper 交易",
    label: "风控限制",
    description: "查看账户当前生效的交易边界。",
    keywords: ["风控", "限制", "额度"],
  },
  {
    id: "account-strategies",
    view: "account",
    path: "/account",
    query: { tab: "strategies" },
    group: "Paper 交易",
    label: "执行策略状态",
    description: "查看当前账户绑定的执行策略和计划。",
    keywords: ["执行策略", "固定策略", "自动路由"],
  },
  {
    id: "account-monitor",
    view: "account",
    path: "/account",
    query: { tab: "monitor" },
    group: "Paper 交易",
    label: "系统监控",
    description: "查看后端服务、任务和连接状态。",
    keywords: ["监控", "服务", "状态"],
  },
  {
    id: "account-logs",
    view: "account",
    path: "/account",
    query: { tab: "logs" },
    group: "Paper 交易",
    label: "运行日志",
    description: "查看前后端运行事件和错误。",
    keywords: ["日志", "错误", "审计"],
  },
  {
    id: "learning",
    view: "learning",
    path: "/learning",
    group: "研究复盘",
    label: "研究管线",
    description: "查看候选验证、Paper 复盘和研究记忆。",
    keywords: ["学习", "复盘", "研究"],
  },
  {
    id: "learning-pipeline",
    view: "learning",
    path: "/learning",
    query: { section: "pipeline" },
    group: "研究复盘",
    label: "候选策略验证",
    description: "查看受控研究流程和当前候选。",
    keywords: ["候选", "验证", "管线"],
  },
  {
    id: "learning-weekly-review",
    view: "learning",
    path: "/learning",
    query: { section: "weekly-review" },
    group: "研究复盘",
    label: "周度 Paper 复盘",
    description: "查看资金使用和闭合成交表现。",
    keywords: ["周复盘", "资金使用", "成交"],
  },
  {
    id: "learning-memory",
    view: "learning",
    path: "/learning",
    query: { section: "memory" },
    group: "研究复盘",
    label: "研究记忆",
    description: "查看样本积累和已验证结论。",
    keywords: ["样本", "记忆"],
  },
  {
    id: "learning-daily-review",
    view: "learning",
    path: "/learning",
    query: { section: "daily-review" },
    group: "研究复盘",
    label: "每日复盘",
    description: "查看最近交易日结论与执行差距。",
    keywords: ["日复盘", "每日"],
  },
  {
    id: "learning-paper-plan",
    view: "learning",
    path: "/learning",
    query: { section: "paper-plan" },
    group: "研究复盘",
    label: "今日 Paper 计划",
    description: "查看操作记录、阻塞原因和资金计划。",
    keywords: ["今日计划", "操作过程"],
  },
  {
    id: "learning-optimization",
    view: "learning",
    path: "/learning",
    query: { section: "optimization" },
    group: "研究复盘",
    label: "策略训练与存储",
    description: "查看自优化状态和本地存储控制。",
    keywords: ["自动优化", "训练", "缓存"],
  },
  {
    id: "settings",
    view: "settings",
    path: "/settings",
    group: "系统设置",
    label: "系统设置",
    description: "管理策略、资金档位和模拟账户。",
    keywords: ["设置", "配置"],
  },
  {
    id: "settings-profile",
    view: "settings",
    path: "/settings",
    query: { section: "profile" },
    group: "系统设置",
    label: "策略档位",
    description: "选择现金防守、稳健、均衡或进取档位。",
    keywords: ["档位", "现金", "风险偏好"],
  },
  {
    id: "settings-execution",
    view: "settings",
    path: "/settings",
    query: { section: "execution" },
    group: "系统设置",
    label: "固定策略与金额",
    description: "手动选择执行策略并查看金额诊断。",
    keywords: ["固定策略", "金额", "执行策略"],
  },
  {
    id: "settings-account",
    view: "settings",
    path: "/settings",
    query: { section: "account" },
    group: "系统设置",
    label: "模拟账户管理",
    description: "查看账户概况或建立一段新的 Paper 模拟。",
    keywords: ["重置", "初始资金", "账户"],
  },
];

export const moduleCatalog: ReadonlyArray<ModuleCatalogItem> = Object.freeze(catalog);

const accountTabs = new Set<AccountModuleTab>([
  "portfolio",
  "trading",
  "orders",
  "risk",
  "strategies",
  "monitor",
  "logs",
]);
const strategyStages = new Set<StrategyModuleStage>([
  "configure",
  "backtest",
  "validate",
  "observe",
]);
const marketTabs = new Set<MarketModuleTab>([
  "a-share",
  "turning",
  "stock",
  "regime",
  "hong-kong",
  "futures",
  "external",
  "crypto",
  "events",
  "esoteric",
]);
const settingsSections = new Set<SettingsModuleSection>([
  "profile",
  "execution",
  "account",
]);
const learningSections = new Set<LearningModuleSection>([
  "pipeline",
  "weekly-review",
  "memory",
  "daily-review",
  "paper-plan",
  "optimization",
]);

function queryValue(search: string, key: string): string | null {
  return new URLSearchParams(search).get(key);
}

function parseAllowed<T extends string>(
  search: string,
  key: string,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  const value = queryValue(search, key);
  return value && allowed.has(value as T) ? value as T : fallback;
}

export function parseAccountTab(search: string): AccountModuleTab {
  return parseAllowed(search, "tab", accountTabs, "portfolio");
}

export function parseStrategyStage(search: string): StrategyModuleStage {
  return parseAllowed(search, "stage", strategyStages, "configure");
}

export function parseMarketTab(search: string): MarketModuleTab {
  return parseAllowed(search, "tab", marketTabs, "a-share");
}

export function parseSettingsSection(search: string): SettingsModuleSection {
  return parseAllowed(search, "section", settingsSections, "execution");
}

export function parseLearningSection(search: string): LearningModuleSection {
  return parseAllowed(search, "section", learningSections, "pipeline");
}

export function getModuleHref(item: Pick<ModuleCatalogItem, "path" | "query">): string {
  const params = new URLSearchParams(item.query);
  const query = params.toString();
  return query ? `${item.path}?${query}` : item.path;
}

export function getModuleById(id: string): ModuleCatalogItem | undefined {
  return moduleCatalog.find((item) => item.id === id);
}

export function getActiveModuleId(
  view: ViewId,
  search: string,
): string {
  switch (view) {
    case "account":
      return `account-${parseAccountTab(search)}`;
    case "strategy":
      return `strategy-${parseStrategyStage(search)}`;
    case "market":
      return `market-${parseMarketTab(search)}`;
    case "learning":
      return `learning-${parseLearningSection(search)}`;
    case "settings":
      return `settings-${parseSettingsSection(search)}`;
    case "overview":
      return "overview";
  }
}