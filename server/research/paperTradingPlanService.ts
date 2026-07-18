import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import { buildDailyCandidates } from "./dailyCandidates";
import type { DailyCandidateReport } from "./dailyCandidates";
import { buildDailyQualityStocks } from "./dailyQualityStocks";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import { routeAdaptiveStrategies } from "./adaptiveStrategyRouter";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import { buildMarketRegimeResearch } from "./marketRegimeResearch";
import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import { buildExternalMarketImpact } from "./externalMarketImpact";
import type { ExternalMarketImpactReport } from "./externalMarketImpact";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { PaperTradingPlan } from "./paperTradingPlan";
import { buildRealResearchDataFeed } from "./realResearchData";
import type { RealResearchDataFeed } from "./realResearchData";
import { buildStrategyLeaderboard } from "./strategyLeaderboard";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";
import type { InMemoryResearchStore } from "./researchStore";

export interface CurrentPaperTradingPlanResult {
  plan: PaperTradingPlan;
  leaderboard: StrategyLeaderboardReport;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
  marketRegimeResearch: MarketRegimeResearchReport;
  realResearchDataFeed: RealResearchDataFeed;
  externalMarketImpact: ExternalMarketImpactReport;
  adaptiveRouting: AdaptiveStrategyRouting;
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
  const [
    leaderboard,
    candidates,
    qualityStocks,
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
  ] = await Promise.all([
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
    buildMarketRegimeResearch({
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      snapshot,
      preferredStocks: positions.map((position) => ({
        symbol: position.symbol,
        name: position.name,
      })),
      sectorLimit: 10,
      stockLimit: 12,
      days: 180,
      timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
    }),
    buildRealResearchDataFeed({
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      snapshot,
      timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
    }),
    buildExternalMarketImpact({
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      days: 500,
      timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
    }),
  ]);
  const adaptiveRouting = routeAdaptiveStrategies(marketRegimeResearch, {
    bias: externalMarketImpact.aShareImpact.bias,
    samples: externalMarketImpact.validation.samples,
    windows: externalMarketImpact.validation.windows,
    directionalHitRate: externalMarketImpact.validation.directionalHitRate,
  });

  input.researchStore?.recordMarketSnapshot(snapshot, input.system.marketDataProvider);
  input.researchStore?.recordStrategyLeaderboard(leaderboard);
  input.researchStore?.recordDailyCandidates(candidates);
  input.researchStore?.recordDailyQualityStocks(qualityStocks);

  const plan = buildPaperTradingPlan({
    snapshot,
    provider: input.system.marketDataProvider,
    account,
    positions,
    orders: input.system.store.listOrders(10_000),
    leaderboard,
    candidates,
    qualityStocks,
    adaptiveRouting:
      input.system.marketDataProvider === "akshare" ? adaptiveRouting : undefined,
    marketRegimeResearch:
      input.system.marketDataProvider === "akshare"
        ? marketRegimeResearch
        : undefined,
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
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
    adaptiveRouting,
  };
}
