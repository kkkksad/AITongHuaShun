import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
  TradingMode,
} from "../../shared/trading";

export type DailyMarketTone =
  | "risk-on"
  | "balanced"
  | "risk-off"
  | "insufficient-data";

export interface MarketSnapshotAssessment {
  tone: DailyMarketTone;
  summary: string;
  breadth: {
    total: number;
    advancers: number;
    decliners: number;
    flat: number;
    averageChangePercent: number;
    advanceDeclineRatio: number;
  };
}

export interface DailyMarketReviewTrade {
  orderId: string;
  symbol: string;
  name: string;
  side: OrderRecord["side"];
  status: OrderRecord["status"];
  quantity: number;
  price: number;
  notional: number;
  commission: number;
  rejectionReason: string | null;
  createdAt: string;
  strategy: string;
  reason: string;
  reasonSource: "decision-audit" | "historical-fallback";
  ruleChecks: string[];
}

export interface DailyMarketReview {
  generatedAt: string;
  tradingDate: string;
  mode: TradingMode;
  provider: string;
  market: {
    snapshotTime: string;
    tone: DailyMarketTone;
    summary: string;
    breadth: {
      total: number;
      advancers: number;
      decliners: number;
      flat: number;
      averageChangePercent: number;
      advanceDeclineRatio: number;
    };
    indices: Array<{
      symbol: string;
      name: string;
      price: number;
      changePercent: number;
      updatedAt: string;
    }>;
  };
  account: {
    equity: number;
    cash: number;
    marketValue: number;
    dailyPnl: number;
    dailyPnlPercent: number;
    cashRatio: number;
    capitalDeployedPercent: number;
    positionCount: number;
    t1LockedPositions: number;
  };
  trades: {
    submitted: number;
    filled: number;
    rejected: number;
    filledBuys: number;
    filledSells: number;
    filledBuyNotional: number;
    filledSellNotional: number;
    commission: number;
    items: DailyMarketReviewTrade[];
  };
  strategyReview: {
    grade: "disciplined" | "watch" | "needs-improvement";
    summary: string;
    strengths: string[];
    issues: string[];
    nextActions: string[];
  };
  guardrails: string[];
}

interface DailyMarketReviewInput {
  snapshot: MarketSnapshot;
  provider: string;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  auditEvents: AuditEvent[];
  now?: Date;
}

interface DecisionAuditData {
  orderId?: string;
  strategy?: string;
  reason?: string;
  ruleChecks?: unknown;
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function chinaParts(value: Date): { date: string; minutes: number } {
  const shifted = new Date(value.getTime() + CHINA_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function decisionAuditMap(events: AuditEvent[]): Map<string, DecisionAuditData> {
  const decisions = new Map<string, DecisionAuditData>();
  for (const event of events) {
    if (event.action !== "paper-auto-execution.decision" || !event.data) continue;
    const data = event.data as DecisionAuditData;
    if (typeof data.orderId === "string" && !decisions.has(data.orderId)) {
      decisions.set(data.orderId, data);
    }
  }
  return decisions;
}

function fallbackReason(order: OrderRecord): string {
  if (order.rejectionReason?.includes("资金不足")) {
    return "自动 paper 买单因资金不足被风控拒绝；该订单暴露了同批计划未累计预留现金的问题。";
  }
  if (order.clientOrderId?.startsWith("kairos-auto-paper:")) {
    return "该订单由 KAIROS 自动 paper 计划提交，但历史版本未持久化逐笔策略理由，不能事后补写不存在的依据。";
  }
  return "历史订单没有保存策略决策理由，只保留了订单与成交事实。";
}

function marketTone(
  total: number,
  averageChangePercent: number,
  advanceDeclineRatio: number,
): DailyMarketTone {
  if (total < 10) return "insufficient-data";
  if (averageChangePercent >= 0.8 && advanceDeclineRatio >= 1.5) return "risk-on";
  if (averageChangePercent <= -0.8 && advanceDeclineRatio <= 0.67) return "risk-off";
  return "balanced";
}

function marketSummary(
  tone: DailyMarketTone,
  advancers: number,
  decliners: number,
  averageChangePercent: number,
): string {
  if (tone === "insufficient-data") {
    return "当前快照没有足够的可交易股票，无法形成可靠盘面复盘。";
  }
  const label = tone === "risk-on" ? "偏强" : tone === "risk-off" ? "偏弱" : "分化";
  return `当前观察池盘面${label}：上涨 ${advancers} 只、下跌 ${decliners} 只，平均涨跌幅 ${averageChangePercent.toFixed(2)}%。`;
}

export function assessMarketSnapshot(
  snapshot: MarketSnapshot,
): MarketSnapshotAssessment {
  const tradableQuotes = snapshot.quotes.filter(
    (quote) => quote.tradable && quote.price > 0,
  );
  const advancers = tradableQuotes.filter((quote) => quote.changePercent > 0).length;
  const decliners = tradableQuotes.filter((quote) => quote.changePercent < 0).length;
  const flat = tradableQuotes.length - advancers - decliners;
  const averageChangePercent = tradableQuotes.length > 0
    ? tradableQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) /
      tradableQuotes.length
    : 0;
  const advanceDeclineRatio = decliners > 0
    ? advancers / decliners
    : advancers > 0
      ? advancers
      : 0;
  const tone = marketTone(
    tradableQuotes.length,
    averageChangePercent,
    advanceDeclineRatio,
  );

  return {
    tone,
    summary: marketSummary(tone, advancers, decliners, averageChangePercent),
    breadth: {
      total: tradableQuotes.length,
      advancers,
      decliners,
      flat,
      averageChangePercent: round(averageChangePercent),
      advanceDeclineRatio: round(advanceDeclineRatio),
    },
  };
}

export function buildDailyMarketReview(
  input: DailyMarketReviewInput,
): DailyMarketReview {
  const now = input.now ?? new Date();
  const tradingDate = chinaParts(now).date;
  const marketAssessment = assessMarketSnapshot(input.snapshot);
  const { tone } = marketAssessment;
  const {
    advancers,
    decliners,
    averageChangePercent,
  } = marketAssessment.breadth;
  const quoteMap = new Map(input.snapshot.quotes.map((quote) => [quote.symbol, quote]));
  const positionMap = new Map(input.positions.map((position) => [position.symbol, position]));
  const decisions = decisionAuditMap(input.auditEvents);
  const dailyOrders = input.orders
    .filter((order) => chinaParts(new Date(order.createdAt)).date === tradingDate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const tradeItems: DailyMarketReviewTrade[] = dailyOrders.map((order) => {
    const decision = decisions.get(order.id);
    const ruleChecks = Array.isArray(decision?.ruleChecks)
      ? decision.ruleChecks.filter((rule): rule is string => typeof rule === "string")
      : [];
    return {
      orderId: order.id,
      symbol: order.symbol,
      name: quoteMap.get(order.symbol)?.name ??
        positionMap.get(order.symbol)?.name ??
        order.symbol,
      side: order.side,
      status: order.status,
      quantity: order.quantity,
      price: order.filledPrice ?? order.requestedPrice,
      notional: order.notional,
      commission: order.commission,
      rejectionReason: order.rejectionReason ?? null,
      createdAt: order.createdAt,
      strategy: decision?.strategy ?? "历史 paper 计划",
      reason: decision?.reason ?? fallbackReason(order),
      reasonSource: decision?.reason ? "decision-audit" : "historical-fallback",
      ruleChecks,
    };
  });

  const filled = dailyOrders.filter((order) => order.status === "filled");
  const rejected = dailyOrders.filter((order) => order.status === "rejected");
  const filledBuys = filled.filter((order) => order.side === "buy");
  const filledSells = filled.filter((order) => order.side === "sell");
  const cashRatio = input.account.equity > 0
    ? input.account.cash / input.account.equity
    : 0;
  const capitalDeployedPercent = input.account.equity > 0
    ? input.account.marketValue / input.account.equity
    : 0;
  const openingBuyAttempts = dailyOrders.filter((order) => {
    if (order.side !== "buy") return false;
    const { minutes } = chinaParts(new Date(order.createdAt));
    return minutes >= 9 * 60 + 30 && minutes <= 9 * 60 + 35;
  }).length;
  const missingDecisionReasons = tradeItems.filter(
    (trade) => trade.reasonSource === "historical-fallback",
  ).length;
  const adaptiveReductionCounts = new Map<string, number>();
  for (const trade of tradeItems) {
    if (
      trade.status !== "filled" ||
      trade.side !== "sell" ||
      trade.strategy !== "市场状态减仓"
    ) {
      continue;
    }
    adaptiveReductionCounts.set(
      trade.symbol,
      (adaptiveReductionCounts.get(trade.symbol) ?? 0) + 1,
    );
  }
  const repeatedAdaptiveReductionSymbols = [...adaptiveReductionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([symbol]) => symbol);
  const issues: string[] = [];
  const strengths: string[] = [
    "所有订单均保留在本地 paper 账户，真实交易继续关闭。",
    "A 股一手、T+1 和风险引擎在订单提交时仍然生效。",
  ];

  if (rejected.some((order) => order.rejectionReason?.includes("资金不足"))) {
    issues.push("出现资金不足拒绝，说明同批买单曾重复使用原始现金预算。");
  }
  if (cashRatio < 0.1 && input.account.equity > 0) {
    issues.push(`收盘现金比例仅 ${(cashRatio * 100).toFixed(1)}%，资金部署过满，缺少调整余地。`);
  }
  if (openingBuyAttempts >= 2) {
    issues.push(`开盘 5 分钟内连续尝试 ${openingBuyAttempts} 笔买单，建仓节奏过于集中。`);
  }
  if (missingDecisionReasons > 0) {
    issues.push(`${missingDecisionReasons} 笔历史订单缺少逐笔策略理由，旧记录只能复核成交事实。`);
  }
  if (repeatedAdaptiveReductionSymbols.length > 0) {
    issues.push(
      `同一标的在一个交易日内重复执行普通市场状态减仓：${repeatedAdaptiveReductionSymbols.join("、")}；连续“减半”会突破原本的单次风险预算。`,
    );
  }
  if (tone === "risk-off" && capitalDeployedPercent > 0.7) {
    issues.push(
      `观察池盘面偏弱时收盘仓位仍为 ${(capitalDeployedPercent * 100).toFixed(1)}%，高于 70% 风险观察线；防守现金目标需要转成分阶段减仓。`,
    );
  }

  const nextActions = [
    "继续按成交额、滑点和手续费累计预留现金，资金不足时不创建 paper 订单。",
    "维持每轮最多 1 笔、每天最多 4 笔的自动执行节奏。",
  ];
  if (openingBuyAttempts >= 2) {
    nextActions.push("将开盘集中建仓改为分批确认，观察首个价格区间后再增加下一笔 paper 仓位。");
  }
  if (missingDecisionReasons > 0) {
    nextActions.push("从下一笔自动订单开始持久化策略名称、买卖理由和全部规则检查。");
  }
  if (repeatedAdaptiveReductionSymbols.length > 0) {
    nextActions.push(
      "普通市场状态减仓调整为每个标的每天最多一次；持仓浮亏达到硬止损时允许覆盖该限制。",
    );
  }
  if (tone === "risk-off" && capitalDeployedPercent > 0.7) {
    nextActions.push(
      "risk-off 下优先减持趋势恶化、信号不清或数据不足的仓位，按一手分阶段接近防守现金目标，不机械卖出健康趋势和洗盘候选。",
    );
  }
  nextActions.push("至少积累一周 paper 样本后再比较胜率、回撤和盈亏比，不用单日结果证明策略有效。");

  const grade = issues.length >= 2
    ? "needs-improvement"
    : issues.length === 1
      ? "watch"
      : "disciplined";

  return {
    generatedAt: now.toISOString(),
    tradingDate,
    mode: input.snapshot.mode,
    provider: input.provider,
    market: {
      snapshotTime: input.snapshot.marketTime,
      tone,
      summary: marketAssessment.summary,
      breadth: marketAssessment.breadth,
      indices: input.snapshot.quotes
        .filter((quote) => !quote.tradable && quote.price > 0)
        .map((quote) => ({
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price,
          changePercent: quote.changePercent,
          updatedAt: quote.updatedAt,
        })),
    },
    account: {
      equity: round(input.account.equity),
      cash: round(input.account.cash),
      marketValue: round(input.account.marketValue),
      dailyPnl: round(input.account.dailyPnl),
      dailyPnlPercent: round(input.account.dailyPnlPercent, 4),
      cashRatio: round(cashRatio, 4),
      capitalDeployedPercent: round(capitalDeployedPercent, 4),
      positionCount: input.positions.length,
      t1LockedPositions: input.positions.filter(
        (position) => (position.t1LockedQuantity ?? 0) > 0,
      ).length,
    },
    trades: {
      submitted: dailyOrders.length,
      filled: filled.length,
      rejected: rejected.length,
      filledBuys: filledBuys.length,
      filledSells: filledSells.length,
      filledBuyNotional: round(
        filledBuys.reduce((sum, order) => sum + order.notional, 0),
      ),
      filledSellNotional: round(
        filledSells.reduce((sum, order) => sum + order.notional, 0),
      ),
      commission: round(filled.reduce((sum, order) => sum + order.commission, 0)),
      items: tradeItems,
    },
    strategyReview: {
      grade,
      summary: issues.length > 0
        ? `今日本地 paper 流程发现 ${issues.length} 项需要改进的问题，先修执行纪律，再评价策略收益。`
        : "今日本地 paper 执行未发现明显纪律问题，仍需继续积累样本。",
      strengths,
      issues,
      nextActions,
    },
    guardrails: [
      "本报告只复盘本地 paper 模拟结果，不代表真实收益。",
      "盘面统计基于当前配置股票池和最新快照，不等同于完整交易所全市场统计。",
      "缺失的历史策略理由不会被推测或补写。",
      "真实交易与同花顺账户连接保持关闭。",
    ],
  };
}
