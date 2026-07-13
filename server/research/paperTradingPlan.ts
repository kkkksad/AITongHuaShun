import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  PositionSnapshot,
  TradingMode,
} from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
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
  plannedSellNotional: number;
  cashDeploymentPercent: number;
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
  };
  rules: string[];
  topStrategy: {
    strategyKey: string;
    strategyName: string;
    winRate: number;
    totalTrades: number;
    qualityGate: string;
  } | null;
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

function candidateQuantity(
  candidate: { price: number },
  cash: number,
  maxSingleOrderNotional: number,
  lotSize: number,
): number {
  return roundLot(
    Math.min(maxSingleOrderNotional, cash) / Math.max(candidate.price, 1),
    lotSize,
  );
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
}): PaperTradingPlanQualitySummary {
  const actionCounts = countOperations(input.operations);
  const plannedBuyNotional = input.operations
    .filter((operation) => operation.action === "paper-buy-plan")
    .reduce((sum, operation) => sum + operation.estimatedNotional, 0);
  const plannedSellNotional = input.operations
    .filter((operation) => operation.action === "paper-sell-plan")
    .reduce((sum, operation) => sum + operation.estimatedNotional, 0);
  const cashDeploymentPercent =
    input.cash > 0 ? plannedBuyNotional / input.cash : 0;
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
    plannedSellNotional: Number(plannedSellNotional.toFixed(2)),
    cashDeploymentPercent: Number(cashDeploymentPercent.toFixed(4)),
    planQuality,
    summary,
  };
}

export function buildPaperTradingPlan(input: {
  snapshot: MarketSnapshot;
  provider: string;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  leaderboard: StrategyLeaderboardReport;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
  initialCapital: number;
  lotSize: number;
  maxPositionWeight: number;
  maxSingleOrderNotional: number;
}): PaperTradingPlan {
  const now = new Date().toISOString();
  const quoteMap = new Map(input.snapshot.quotes.map((quote) => [quote.symbol, quote]));
  const positionMap = new Map(input.positions.map((position) => [position.symbol, position]));
  const topStrategy = input.leaderboard.entries[0] ?? null;
  const maxSingleOrderNotional = Math.min(
    input.maxSingleOrderNotional,
    Math.max(0, input.account.equity * input.maxPositionWeight),
    Math.max(0, input.account.cash * 0.8),
  );

  const operations: PaperTradingOperation[] = [];

  for (const position of input.positions) {
    const quote = quoteMap.get(position.symbol);
    const price = quote?.price ?? position.currentPrice;
    const locked = position.t1LockedQuantity ?? 0;
    const available = position.availableQuantity ?? position.quantity;

    if (locked > 0) {
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
    } else if (position.unrealizedPnl / Math.max(1, position.marketValue) <= -0.03 && available > 0) {
      operations.push({
        timestamp: now,
        symbol: position.symbol,
        name: position.name,
        action: "paper-sell-plan",
        strategy: "回撤控制",
        quantity: roundLot(Math.min(available, position.quantity), input.lotSize),
        price,
        estimatedNotional: Number((roundLot(Math.min(available, position.quantity), input.lotSize) * price).toFixed(2)),
        reason: "持仓浮亏超过 3%，纳入纸面减仓观察；不会触发真实下单。",
        ruleChecks: ["paper-only", "T+1: pass", "manual-review-required"],
      });
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
        input.account.cash,
        maxSingleOrderNotional,
        input.lotSize,
      );
      const bQuantity = candidateQuantity(
        b,
        input.account.cash,
        maxSingleOrderNotional,
        input.lotSize,
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
      input.account.cash,
      maxSingleOrderNotional,
      input.lotSize,
    );
    return quantity >= input.lotSize;
  }).length;
  const positionConflictCount = candidatePool.filter((candidate) =>
    positionMap.has(candidate.symbol),
  ).length;

  for (const candidate of candidatePool) {
    const existing = positionMap.get(candidate.symbol);
    const quantity = candidateQuantity(
      candidate,
      input.account.cash,
      maxSingleOrderNotional,
      input.lotSize,
    );
    const estimatedNotional = Number((quantity * candidate.price).toFixed(2));

    if (existing) {
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
        reason: "1 万元纸面账户资金或单票仓位约束不足，无法满足 A 股 100 股一手。",
        ruleChecks: ["lot-size: blocked", "cash-check: blocked", "paper-only"],
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
        `defensive-score: pass (${candidate.defensiveScore})`,
        "T+1-after-buy",
      ],
    });
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
    tradingDate: getChinaTradeDate(),
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
    qualitySummary: buildQualitySummary({
      operations,
      candidatePoolSize,
      affordableCandidateCount,
      positionConflictCount,
      cash: input.account.cash,
    }),
    operations,
    guardrails: [
      "本计划不代表真实收益，也不构成投资建议。",
      "同花顺或中信账户不得通过网页登录态、密码、Cookie 或明文 Token 接入本平台。",
      "当前只使用实时快照和合成研究样本，尚未接入授权历史 K 线样本外验证。",
    ],
  };
}
