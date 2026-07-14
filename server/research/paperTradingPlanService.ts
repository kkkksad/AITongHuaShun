import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import { buildDailyCandidates } from "./dailyCandidates";
import type { DailyCandidateReport } from "./dailyCandidates";
import { buildDailyQualityStocks } from "./dailyQualityStocks";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { PaperTradingPlan } from "./paperTradingPlan";
import { buildStrategyLeaderboard } from "./strategyLeaderboard";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";
import type { InMemoryResearchStore } from "./researchStore";

export interface CurrentPaperTradingPlanResult {
  plan: PaperTradingPlan;
  leaderboard: StrategyLeaderboardReport;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
}

export async function buildCurrentPaperTradingPlan(input: {
  system: TradingSystem;
  config: ServerConfig;
  researchStore?: InMemoryResearchStore;
  leaderboardBars?: number;
  candidateLimit?: number;
  qualityLimit?: number;
}): Promise<CurrentPaperTradingPlanResult> {
  const snapshot = input.system.market.getSnapshot();
  const account = input.system.broker.getAccount(snapshot);
  const positions = input.system.broker.getPositions(snapshot);
  const [leaderboard, candidates, qualityStocks] = await Promise.all([
    buildStrategyLeaderboard(
      snapshot,
      input.system.marketDataProvider,
      input.leaderboardBars ?? 120,
    ),
    buildDailyCandidates(
      snapshot,
      input.system.marketDataProvider,
      input.candidateLimit ?? 40,
    ),
    buildDailyQualityStocks(
      snapshot,
      input.system.marketDataProvider,
      input.qualityLimit ?? 60,
    ),
  ]);

  input.researchStore?.recordMarketSnapshot(snapshot, input.system.marketDataProvider);
  input.researchStore?.recordStrategyLeaderboard(leaderboard);
  input.researchStore?.recordDailyCandidates(candidates);
  input.researchStore?.recordDailyQualityStocks(qualityStocks);

  const plan = buildPaperTradingPlan({
    snapshot,
    provider: input.system.marketDataProvider,
    account,
    positions,
    leaderboard,
    candidates,
    qualityStocks,
    initialCapital: input.config.TRADING_STARTING_CASH,
    lotSize: input.system.limits.lotSize,
    maxPositionWeight: input.system.risk.getEffectiveMaxPositionWeight(),
    maxSingleOrderNotional: input.system.risk.getEffectiveMaxOrderNotional(),
    commissionRate: input.config.COMMISSION_RATE,
    minimumCommission: input.config.MIN_COMMISSION,
    cashReserveRatio: input.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
  });

  return {
    plan,
    leaderboard,
    candidates,
    qualityStocks,
  };
}
