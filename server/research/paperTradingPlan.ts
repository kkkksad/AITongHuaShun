import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
  TradingMode,
} from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";

export type PaperTradingOperationAction =
  | "observe"
  | "paper-buy-plan"
  | "paper-sell-plan"
  | "blocked"
  | "hold";

export interface PaperTradingOperation {
  timestamp: string;
  symbol: string;
  name: string;
  action: PaperTradingOperationAction;
  strategy: string;
  quantity: number;
  price: number;
  estimatedNotional: number;
  reason: string;
  ruleChecks: string[];
}

export interface PaperTradingPlanQualitySummary {
  candidatePoolSize: number;
  affordableCandidateCount: number;
  positionConflictCount: number;
  actionCounts: Record<PaperTradingOperationAction, number>;
  blockedReasons: Record<string, number>;
  plannedBuyNotional: number;
  plannedBuyFees: number;
  plannedCashRequired: number;
  plannedSellNotional: number;
  cashDeploymentPercent: number;
  remainingCashAfterPlan: number;
  planQuality: "actionable" | "watch-only" | "blocked";
  summary: string;
}

export interface PaperTradingPlan {
  generatedAt: string;
  tradingDate: string;
  mode: TradingMode;
  provider: string;
  account: {
    accountId: string;
    cash: number;
    equity: number;
    marketValue: number;
  };
  capitalPlan: {
    initialCapital: number;
    maxPositionWeight: number;
    maxSingleOrderNotional: number;
    lotSize: number;
    cashReserveRatio: number;
    cashReserveAmount: number;
  };
  rules: string[];
  topStrategy: {
    strategyKey: string;
    strategyName: string;
    winRate: number;
    totalTrades: number;
    qualityGate: string;
  } | null;
  adaptiveRouting: AdaptiveStrategyRouting | null;
  qualitySummary: PaperTradingPlanQualitySummary;
  operations: PaperTradingOperation[];
  guardrails: string[];
}

const DEFENSIVE_BUY_SCORE_MIN = 58;

function getChinaTradeDate(value = new Date()): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function roundLot(quantity: number, lotSize: number): number {
  return Math.floor(quantity / lotSize) * lotSize;
}

function uniqueBySymbol<T extends { symbol: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });
}

function filledAutoSellSymbols(
  orders: OrderRecord[],
  tradingDate: string,
): Set<string> {
  const prefix = `kairos-auto-paper:${tradingDate}:`;
  return new Set(
    orders
      .filter((order) =>
        order.status === "filled" &&
        order.side === "sell" &&
        order.clientOrderId?.startsWith(prefix),
      )
      .map((order) => order.symbol),
  );
}

function candidateQuantity(
  candidate: { price: number },
  cash: number,
  maxSingleOrderNotional: number,
  lotSize: number,
  commissionRate: number,
  minimumCommission: number,
): number {
  const price = Math.max(candidate.price, 1);
  let quantity = roundLot(
    Math.min(maxSingleOrderNotional, Math.max(0, cash - minimumCommission)) / price,
    lotSize,
  );
  while (quantity >= lotSize) {
    const notional = quantity * price;
    const commission = Math.max(minimumCommission, notional * commissionRate);
    if (notional + commission <= cash) return quantity;
    quantity -= lotSize;
  }
  return 0;
}

function estimatedCommission(
  notional: number,
  commissionRate: number,
  minimumCommission: number,
): number {
  if (notional <= 0) return 0;
  return Number(Math.max(minimumCommission, notional * commissionRate).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quoteAmount(quote: MarketQuote | undefined, price: number, volume = 0): number {
  return quote?.amount ?? price * volume;
}

function quoteAmplitude(quote: MarketQuote | undefined): number {
  if (quote?.amplitude !== undefined && Number.isFinite(quote.amplitude)) {
    return quote.amplitude;
  }
  return Math.abs(quote?.changePercent ?? 0) * 1.8;
}

function quoteIntradayPosition(quote: MarketQuote | undefined): number | null {
  if (!quote?.high || !quote.low || quote.high <= quote.low) return null;
  return (quote.price - quote.low) / (quote.high - quote.low);
}

function defensiveCandidateScore(candidate: {
  price: number;
  score: number;
  priority: number;
}, quote: MarketQuote | undefined): number {
  if (quote && (!quote.tradable || quote.price <= 0)) return 0;

  const change = quote?.changePercent ?? 0;
  const volume = quote?.volume ?? 0;
  const amount = quoteAmount(quote, candidate.price, volume);
  const amplitude = quoteAmplitude(quote);
  const turnover = quote?.turnover ?? 0;
  const intradayPosition = quoteIntradayPosition(quote);

  let score = 42 + candidate.score * 0.42 + candidate.priority * 3;

  if (amount >= 150_000_000 || volume >= 5_000_000) score += 8;
  else if (amount > 0 || volume > 0) score -= 6;

  if (change >= 0.2 && change <= 3.5) score += 9;
  else if (change > -1 && change < 0.2) score += 3;
  else if (change > 5) score -= 24;
  else if (change > 3.5) score -= 8;
  else if (change <= -2.2) score -= 18;

  if (amplitude <= 4.8) score += 8;
  else if (amplitude > 8) score -= 18;
  else if (amplitude > 6) score -= 8;

  if (turnover > 0 && turnover <= 10) score += 4;
  else if (turnover > 18) score -= 18;
  else if (turnover > 12) score -= 8;

  if (intradayPosition !== null) {
    if (intradayPosition >= 0.45 && intradayPosition <= 0.82) score += 5;
    else if (intradayPosition < 0.25) score -= 12;
    else if (intradayPosition > 0.92) score -= 6;
  }

  return Number(clamp(score, 0, 100).toFixed(2));
}

function countOperations(
  operations: PaperTradingOperation[],
): Record<PaperTradingOperationAction, number> {
  const counts: Record<PaperTradingOperationAction, number> = {
    observe: 0,
    "paper-buy-plan": 0,
    "paper-sell-plan": 0,
    blocked: 0,
    hold: 0,
  };

  for (const operation of operations) {
    counts[operation.action] += 1;
  }

  return counts;
}

function summarizeBlockedReasons(
  operations: PaperTradingOperation[],
): Record<string, number> {
  const reasons: Record<string, number> = {};

  for (const operation of operations) {
    if (operation.action !== "blocked") continue;
    const blockedRule =
      operation.ruleChecks.find((rule) => rule.includes("blocked")) ?? "blocked";
    reasons[blockedRule] = (reasons[blockedRule] ?? 0) + 1;
  }

  return reasons;
}

function buildQualitySummary(input: {
  operations: PaperTradingOperation[];
  candidatePoolSize: number;
  affordableCandidateCount: number;
  positionConflictCount: number;
  cash: number;
  commissionRate: number;
  minimumCommission: number;
}): PaperTradingPlanQualitySummary {
  const actionCounts = countOperations(input.operations);
  const plannedBuyNotional = input.operations
    .filter((operation) => operation.action === "paper-buy-plan")
    .reduce((sum, operation) => sum + operation.estimatedNotional, 0);
  const plannedSellNotional = input.operations
    .filter((operation) => operation.action === "paper-sell-plan")
    .reduce((sum, operation) => sum + operation.estimatedNotional, 0);
  const plannedBuyFees = input.operations
    .filter((operation) => operation.action === "paper-buy-plan")
    .reduce(
      (sum, operation) => sum + estimatedCommission(
        operation.estimatedNotional,
        input.commissionRate,
        input.minimumCommission,
      ),
      0,
    );
  const plannedCashRequired = plannedBuyNotional + plannedBuyFees;
  const remainingCashAfterPlan = Math.max(0, input.cash - plannedCashRequired);
  const cashDeploymentPercent =
    input.cash > 0 ? plannedCashRequired / input.cash : 0;
  const planQuality =
    actionCounts["paper-buy-plan"] > 0 || actionCounts["paper-sell-plan"] > 0
      ? "actionable"
      : actionCounts.blocked > 0
        ? "blocked"
        : "watch-only";

  const summary =
    planQuality === "actionable"
      ? `paper plan has ${actionCounts["paper-buy-plan"]} buy plans, ${actionCounts["paper-sell-plan"]} sell plans, and ${(cashDeploymentPercent * 100).toFixed(1)}% cash deployment.`
      : planQuality === "blocked"
        ? `paper plan is blocked by ${actionCounts.blocked} rule checks; keep cash until constraints clear.`
        : "paper plan stays watch-only; no forced trade under current snapshot.";

  return {
    candidatePoolSize: input.candidatePoolSize,
    affordableCandidateCount: input.affordableCandidateCount,
    positionConflictCount: input.positionConflictCount,
    actionCounts,
    blockedReasons: summarizeBlockedReasons(input.operations),
    plannedBuyNotional: Number(plannedBuyNotional.toFixed(2)),
    plannedBuyFees: Number(plannedBuyFees.toFixed(2)),
    plannedCashRequired: Number(plannedCashRequired.toFixed(2)),
    plannedSellNotional: Number(plannedSellNotional.toFixed(2)),
    cashDeploymentPercent: Number(cashDeploymentPercent.toFixed(4)),
    remainingCashAfterPlan: Number(remainingCashAfterPlan.toFixed(2)),
    planQuality,
    summary,
  };
}

export function buildPaperTradingPlan(input: {
  snapshot: MarketSnapshot;
  provider: string;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders?: OrderRecord[];
  leaderboard: StrategyLeaderboardReport;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
  adaptiveRouting?: AdaptiveStrategyRouting;
  marketRegimeResearch?: MarketRegimeResearchReport;
  initialCapital: number;
  lotSize: number;
  maxPositionWeight: number;
  maxSingleOrderNotional: number;
  commissionRate: number;
  minimumCommission: number;
  cashReserveRatio: number;
}): PaperTradingPlan {
  const marketTime = new Date(input.snapshot.marketTime);
  const now = marketTime.toISOString();
  const tradingDate = getChinaTradeDate(marketTime);
  const quoteMap = new Map(input.snapshot.quotes.map((quote) => [quote.symbol, quote]));
  const positionMap = new Map(input.positions.map((position) => [position.symbol, position]));
  const stockRegimeMap = new Map(
    (input.marketRegimeResearch?.stockRegimes ?? []).map((stock) => [stock.symbol, stock]),
  );
  const topStrategy = input.adaptiveRouting
    ? input.leaderboard.entries.find((entry) =>
        input.adaptiveRouting?.eligibleStrategyKeys.includes(entry.strategyKey),
      ) ?? null
    : input.leaderboard.entries[0] ?? null;
  const effectiveCashReserveRatio = Math.max(
    input.cashReserveRatio,
    input.adaptiveRouting?.cashReserveRatio ?? 0,
  );
  const cashReserveAmount = Math.min(
    input.account.cash,
    Math.max(0, input.account.equity * effectiveCashReserveRatio),
  );
  const plannedCashBudget = Math.max(0, input.account.cash - cashReserveAmount);
  const newPositionScale = input.adaptiveRouting?.newPositionScale ?? 1;
  const maxSingleOrderNotional = Math.min(
    input.maxSingleOrderNotional * newPositionScale,
    Math.max(0, input.account.equity * input.maxPositionWeight * newPositionScale),
    plannedCashBudget,
  );
  const alreadyReducedToday = filledAutoSellSymbols(
    input.orders ?? [],
    tradingDate,
  );

  const operations: PaperTradingOperation[] = [];

  for (const position of input.positions) {
    const quote = quoteMap.get(position.symbol);
    const price = quote?.price ?? position.currentPrice;
    const locked = position.t1LockedQuantity ?? 0;
    const available = position.availableQuantity ?? position.quantity;
    const historicalRegime = stockRegimeMap.get(position.symbol);
    const hardStop =
      position.unrealizedPnl / Math.max(1, position.marketValue) <= -0.03;
    const adaptiveReduction =
      input.adaptiveRouting?.positionPosture === "reduce" &&
      historicalRegime?.regime === "trend-deterioration" &&
      historicalRegime.confidence >= 0.65;
    const ordinaryReductionAllowed = !alreadyReducedToday.has(position.symbol);

    if (
      (hardStop || (adaptiveReduction && ordinaryReductionAllowed)) &&
      locked > 0 &&
      available <= 0
    ) {
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "blocked",
        strategy: "A股 T+1 卖出检查",
        quantity: locked,
        price,
        estimatedNotional: Number((locked * price).toFixed(2)),
        reason: "今日买入数量仍处于 T+1 锁定，不能当天卖出。",
        ruleChecks: ["T+1: blocked", `可卖 ${available} / 总持仓 ${position.quantity}`],
      });
    } else if (hardStop && available > 0) {
      const quantity = roundLot(
        Math.min(available, position.quantity),
        input.lotSize,
      );
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "paper-sell-plan",
        strategy: "回撤控制",
        quantity,
        price,
        estimatedNotional: Number((quantity * price).toFixed(2)),
        reason: "持仓浮亏超过 3%，纳入纸面减仓观察；不会触发真实下单。",
        ruleChecks: ["paper-only", "T+1: pass", "manual-review-required"],
      });
    } else if (adaptiveReduction && !ordinaryReductionAllowed) {
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "hold",
        strategy: "当日减仓纪律",
        quantity: 0,
        price,
        estimatedNotional: 0,
        reason: "该标的今日已完成一轮普通风险减仓，保留剩余仓位到下一交易日复核；硬止损仍可覆盖此限制。",
        ruleChecks: [
          "paper-only",
          "daily-reduction-limit",
          "hard-stop-override: enabled",
        ],
      });
    } else if (adaptiveReduction && available >= input.lotSize) {
      const targetQuantity = Math.max(
        input.lotSize,
        roundLot(position.quantity * 0.5, input.lotSize),
      );
      const quantity = roundLot(
        Math.min(available, targetQuantity),
        input.lotSize,
      );
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "paper-sell-plan",
        strategy: "市场状态减仓",
        quantity,
        price,
        estimatedNotional: Number((quantity * price).toFixed(2)),
        reason: "真实历史形态显示高置信度趋势恶化，按当前 risk-off 状态减半仓位并保留后续观察。",
        ruleChecks: [
          "paper-only",
          "T+1: pass",
          `stock-regime: trend-deterioration (${historicalRegime.confidence.toFixed(2)})`,
          "adaptive-position-reduction: 50%",
        ],
      });
    } else if (historicalRegime?.regime === "washout-candidate") {
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "hold",
        strategy: "洗盘候选持仓观察",
        quantity: 0,
        price,
        estimatedNotional: 0,
        reason: "真实历史形态仍是缩量洗盘候选，尚未确认趋势恶化，保持原仓位观察。",
        ruleChecks: ["paper-only", "stock-regime: washout-candidate", "no-forced-sell"],
      });
    } else if (historicalRegime?.regime === "healthy-trend") {
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "hold",
        strategy: "趋势健康持仓",
        quantity: 0,
        price,
        estimatedNotional: 0,
        reason: "真实历史形态仍处于健康趋势，保持原仓位并继续跟踪退出条件。",
        ruleChecks: ["paper-only", "stock-regime: healthy-trend", "no-forced-trade"],
      });
    }
  }

  if (
    input.adaptiveRouting?.positionPosture === "reduce" &&
    input.account.equity > 0
  ) {
    const targetInvestedRatio = clamp(1 - effectiveCashReserveRatio, 0, 1);
    const targetMarketValue = input.account.equity * targetInvestedRatio;
    const plannedSellSymbols = new Set(
      operations
        .filter((operation) => operation.action === "paper-sell-plan")
        .map((operation) => operation.symbol),
    );
    let projectedMarketValue = Math.max(
      0,
      input.account.marketValue - operations
        .filter((operation) => operation.action === "paper-sell-plan")
        .reduce((sum, operation) => sum + operation.estimatedNotional, 0),
    );
    const regimePriority = {
      "trend-deterioration": 3,
      unclear: 2,
      "insufficient-data": 1,
    } as const;
    const exposureCandidates = input.positions
      .map((position) => ({
        position,
        historicalRegime: stockRegimeMap.get(position.symbol),
      }))
      .filter(({ position, historicalRegime }) =>
        Boolean(historicalRegime) &&
        historicalRegime?.regime !== "healthy-trend" &&
        historicalRegime?.regime !== "washout-candidate" &&
        (position.availableQuantity ?? position.quantity) >= input.lotSize &&
        !plannedSellSymbols.has(position.symbol) &&
        !alreadyReducedToday.has(position.symbol),
      )
      .sort((a, b) => {
        const regimeDifference =
          (regimePriority[b.historicalRegime!.regime as keyof typeof regimePriority] ?? 0) -
          (regimePriority[a.historicalRegime!.regime as keyof typeof regimePriority] ?? 0);
        if (regimeDifference !== 0) return regimeDifference;
        const returnDifference =
          (a.historicalRegime?.features?.return20d ?? 0) -
          (b.historicalRegime?.features?.return20d ?? 0);
        if (returnDifference !== 0) return returnDifference;
        return b.position.weight - a.position.weight;
      });

    for (const { position, historicalRegime } of exposureCandidates) {
      if (projectedMarketValue <= targetMarketValue + 0.01) break;
      const available = position.availableQuantity ?? position.quantity;
      const quantity = roundLot(
        Math.min(
          available,
          Math.max(input.lotSize, position.quantity * 0.25),
        ),
        input.lotSize,
      );
      if (quantity < input.lotSize) continue;
      const quote = quoteMap.get(position.symbol);
      const price = quote?.price ?? position.currentPrice;
      const estimatedNotional = Number((quantity * price).toFixed(2));
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "paper-sell-plan",
        strategy: "风险仓位再平衡",
        quantity,
        price,
        estimatedNotional,
        reason: "当前 risk-off 仓位高于防守现金目标，对未确认健康趋势的持仓执行一手级分阶段减仓；不会触发真实下单。",
        ruleChecks: [
          "paper-only",
          "T+1: pass",
          "risk-off-target",
          `stock-regime: ${historicalRegime!.regime}`,
          `current-invested-ratio: ${(input.account.marketValue / input.account.equity).toFixed(4)}`,
          `target-invested-ratio: ${targetInvestedRatio.toFixed(4)}`,
          "adaptive-position-reduction: 25% max",
          "daily-reduction-limit: one-per-symbol",
        ],
      });
      plannedSellSymbols.add(position.symbol);
      projectedMarketValue = Math.max(0, projectedMarketValue - estimatedNotional);
    }
  }

  const candidatePool = uniqueBySymbol([
    ...input.candidates.candidates
      .filter((candidate) => candidate.action === "paper-buy" || candidate.action === "watch")
      .map((candidate) => {
        const priority = candidate.action === "paper-buy" ? 2 : 1;
        const base = {
          symbol: candidate.symbol,
          name: candidate.name,
          price: candidate.price,
          score: candidate.score,
          strategy: input.candidates.strategyName,
          reason: candidate.reasons.join("；"),
          priority,
        };
        return {
          ...base,
          defensiveScore: defensiveCandidateScore(
            base,
            quoteMap.get(candidate.symbol),
          ),
        };
      }),
    ...input.qualityStocks.stocks
      .filter((stock) => stock.action === "focus" || stock.action === "watch")
      .map((stock) => {
        const priority = stock.action === "focus" ? 2 : 1;
        const base = {
          symbol: stock.symbol,
          name: stock.name,
          price: stock.price,
          score: stock.score,
          strategy: "每日优质股评分",
          reason: stock.reasons.join("；"),
          priority,
        };
        return {
          ...base,
          defensiveScore: defensiveCandidateScore(
            base,
            quoteMap.get(stock.symbol),
          ),
        };
      }),
  ])
    .sort((a, b) => {
      const aQuantity = candidateQuantity(
        a,
        plannedCashBudget,
        maxSingleOrderNotional,
        input.lotSize,
        input.commissionRate,
        input.minimumCommission,
      );
      const bQuantity = candidateQuantity(
        b,
        plannedCashBudget,
        maxSingleOrderNotional,
        input.lotSize,
        input.commissionRate,
        input.minimumCommission,
      );
      const aAffordable = aQuantity >= input.lotSize ? 1 : 0;
      const bAffordable = bQuantity >= input.lotSize ? 1 : 0;
      if (bAffordable !== aAffordable) return bAffordable - aAffordable;
      if (b.defensiveScore !== a.defensiveScore) {
        return b.defensiveScore - a.defensiveScore;
      }
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.score !== a.score) return b.score - a.score;
      return a.price - b.price;
    })
    .slice(0, 12);
  const candidatePoolSize = candidatePool.length;
  const affordableCandidateCount = candidatePool.filter((candidate) => {
    const quantity = candidateQuantity(
      candidate,
      plannedCashBudget,
      maxSingleOrderNotional,
      input.lotSize,
      input.commissionRate,
      input.minimumCommission,
    );
    return quantity >= input.lotSize;
  }).length;
  const positionConflictCount = candidatePool.filter((candidate) =>
    positionMap.has(candidate.symbol),
  ).length;

  let remainingPlannedCash = plannedCashBudget;
  const routeAllowsBuying = input.adaptiveRouting?.allowNewPositions ?? true;
  if (!routeAllowsBuying) {
    operations.push({
      timestamp: now,
      symbol: "CASH",
      name: "现金观察",
      action: "observe",
      strategy: topStrategy?.strategyName ?? "资金盾牌",
      quantity: 0,
      price: 1,
      estimatedNotional: 0,
      reason: `当前市场状态 ${input.adaptiveRouting?.regime ?? "unclear"} 禁止新增仓位，等待状态和数据恢复。`,
      ruleChecks: ["paper-only", "adaptive-new-position: blocked", "no-forced-trade"],
    });
  } else if (candidatePoolSize > 0 && affordableCandidateCount === 0) {
    operations.push({
      timestamp: now,
      symbol: "CASH",
      name: "现金观察",
      action: "observe",
      strategy: topStrategy?.strategyName ?? "策略路由",
      quantity: 0,
      price: 1,
      estimatedNotional: 0,
      reason: "当前可用现金和现金缓冲不足以买入任一候选的一手，停止重复生成不可执行买单。",
      ruleChecks: ["paper-only", "cash-constrained", "lot-size: not-affordable"],
    });
  }

  for (const candidate of routeAllowsBuying && affordableCandidateCount > 0
    ? candidatePool
    : []) {
    const existing = positionMap.get(candidate.symbol);
    const quantity = candidateQuantity(
      candidate,
      remainingPlannedCash,
      maxSingleOrderNotional,
      input.lotSize,
      input.commissionRate,
      input.minimumCommission,
    );
    const estimatedNotional = Number((quantity * candidate.price).toFixed(2));
    const estimatedFee = estimatedCommission(
      estimatedNotional,
      input.commissionRate,
      input.minimumCommission,
    );
    const estimatedCashRequired = estimatedNotional + estimatedFee;

    if (existing) {
      if (operations.some((operation) => operation.symbol === candidate.symbol)) {
        continue;
      }
      operations.push({
        timestamp: now,
        symbol: candidate.symbol,
        name: candidate.name,
        action: "hold",
        strategy: candidate.strategy,
        quantity: 0,
        price: candidate.price,
        estimatedNotional: 0,
        reason: "已有持仓，优先观察现有仓位，不重复加仓。",
        ruleChecks: ["paper-only", "position-exists", "manual-review-required"],
      });
      continue;
    }

    if (quantity < input.lotSize) {
      operations.push({
        timestamp: now,
        symbol: candidate.symbol,
        name: candidate.name,
        action: "blocked",
        strategy: candidate.strategy,
        quantity: 0,
        price: candidate.price,
        estimatedNotional: 0,
        reason: "当前批次剩余可用现金不足，已计入前序计划、预计手续费和现金缓冲，不再创建模拟订单。",
        ruleChecks: [
          "lot-size: blocked",
          "cash-check: blocked",
          "cash-reservation: blocked",
          `remaining-planned-cash: ${remainingPlannedCash.toFixed(2)}`,
          "paper-only",
        ],
      });
      continue;
    }

    if (candidate.defensiveScore < DEFENSIVE_BUY_SCORE_MIN) {
      operations.push({
        timestamp: now,
        symbol: candidate.symbol,
        name: candidate.name,
        action: "blocked",
        strategy: candidate.strategy,
        quantity: 0,
        price: candidate.price,
        estimatedNotional: 0,
        reason: "候选防守分不足，宁愿空仓观察，不强行做本地 paper 买入。",
        ruleChecks: [
          `defensive-score: blocked (${candidate.defensiveScore})`,
          "paper-only",
          "no-forced-trade",
        ],
      });
      continue;
    }

    operations.push({
      timestamp: now,
      symbol: candidate.symbol,
      name: candidate.name,
      action: "paper-buy-plan",
      strategy: candidate.strategy,
      quantity,
      price: candidate.price,
      estimatedNotional,
      reason: candidate.reason || "候选策略与优质股评分同时进入纸面观察。",
      ruleChecks: [
        "paper-only",
        "lot-size: pass",
        "cash-check: pass",
        `cash-reservation: pass (${estimatedCashRequired.toFixed(2)})`,
        `defensive-score: pass (${candidate.defensiveScore})`,
        "T+1-after-buy",
      ],
    });
    remainingPlannedCash = Math.max(
      0,
      remainingPlannedCash - estimatedCashRequired,
    );
  }

  if (operations.length === 0) {
    operations.push({
      timestamp: now,
      symbol: "CASH",
      name: "现金观察",
      action: "observe",
      strategy: topStrategy?.strategyName ?? "策略排行榜",
      quantity: 0,
      price: 1,
      estimatedNotional: 0,
      reason: "当前快照下没有满足资金、仓位、T+1 与候选质量约束的纸面操作。",
      ruleChecks: ["paper-only", "no-forced-trade", "manual-review-required"],
    });
  }

  return {
    generatedAt: now,
    tradingDate,
    mode: input.snapshot.mode,
    provider: input.provider,
    account: {
      accountId: input.account.accountId,
      cash: input.account.cash,
      equity: input.account.equity,
      marketValue: input.account.marketValue,
    },
    capitalPlan: {
      initialCapital: input.initialCapital,
      maxPositionWeight: input.maxPositionWeight,
      maxSingleOrderNotional,
      lotSize: input.lotSize,
      cashReserveRatio: effectiveCashReserveRatio,
      cashReserveAmount: Number(cashReserveAmount.toFixed(2)),
    },
    rules: [
      "A 股一手 100 股。",
      "A 股 T+1：当日买入的股票当日不可卖出。",
      "所有动作仅为本地 paper 模拟或观察，不连接真实券商。",
      "真实交易必须人工复核、独立权限域、审计日志和额度控制。",
    ],
    topStrategy: topStrategy
      ? {
          strategyKey: topStrategy.strategyKey,
          strategyName: topStrategy.strategyName,
          winRate: topStrategy.metrics.winRate,
          totalTrades: topStrategy.metrics.totalTrades,
          qualityGate: topStrategy.qualityGate,
        }
      : null,
    adaptiveRouting: input.adaptiveRouting ?? null,
    qualitySummary: buildQualitySummary({
      operations,
      candidatePoolSize,
      affordableCandidateCount,
      positionConflictCount,
      cash: input.account.cash,
      commissionRate: input.commissionRate,
      minimumCommission: input.minimumCommission,
    }),
    operations,
    guardrails: [
      "本计划不代表真实收益，也不构成投资建议。",
      "同花顺或中信账户不得通过网页登录态、密码、Cookie 或明文 Token 接入本平台。",
      "当前只使用实时快照和合成研究样本，尚未接入授权历史 K 线样本外验证。",
    ],
  };
}
