import type {
  AccountSnapshot,
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
  operations: PaperTradingOperation[];
  guardrails: string[];
}

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
      .filter((candidate) => candidate.action === "paper-buy")
      .map((candidate) => ({
        symbol: candidate.symbol,
        name: candidate.name,
        price: candidate.price,
        score: candidate.score,
        strategy: input.candidates.strategyName,
        reason: candidate.reasons.join("；"),
      })),
    ...input.qualityStocks.stocks
      .filter((stock) => stock.action === "focus")
      .map((stock) => ({
        symbol: stock.symbol,
        name: stock.name,
        price: stock.price,
        score: stock.score,
        strategy: "每日优质股评分",
        reason: stock.reasons.join("；"),
      })),
  ]).slice(0, 8);

  for (const candidate of candidatePool) {
    const existing = positionMap.get(candidate.symbol);
    const quantity = roundLot(
      Math.min(maxSingleOrderNotional, input.account.cash) / Math.max(candidate.price, 1),
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
      ruleChecks: ["paper-only", "lot-size: pass", "cash-check: pass", "T+1-after-buy"],
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
    operations,
    guardrails: [
      "本计划不代表真实收益，也不构成投资建议。",
      "同花顺或中信账户不得通过网页登录态、密码、Cookie 或明文 Token 接入本平台。",
      "当前只使用实时快照和合成研究样本，尚未接入授权历史 K 线样本外验证。",
    ],
  };
}
