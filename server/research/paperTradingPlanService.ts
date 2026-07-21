import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import type { PositionSnapshot } from "../../shared/trading";
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

export function buildPreferredHistoricalStocks(input: {
  positions: Array<Pick<PositionSnapshot, "symbol" | "name">>;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
  limit: number;
}): Array<{ symbol: string; name: string }> {
  const ordered = [
    ...input.positions.map((position) => ({
      symbol: position.symbol,
      name: position.name,
    })),
    ...input.candidates.candidates
      .filter((candidate) => candidate.action === "paper-buy" || candidate.action === "watch")
      .map((candidate) => ({ symbol: candidate.symbol, name: candidate.name })),
    ...input.qualityStocks.stocks
      .filter((stock) => stock.action === "focus" || stock.action === "watch")
      .map((stock) => ({ symbol: stock.symbol, name: stock.name })),
  ];
  return ordered
    .filter((stock, index, items) =>
      /^\d{6}$/.test(stock.symbol) &&
      items.findIndex((candidate) => candidate.symbol === stock.symbol) === index,
    )
    .slice(0, Math.max(1, Math.min(input.limit, 12)));
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
  const strategyProfile = input.system.store.getStrategyProfile();
  const candidates = buildDailyCandidates(
    snapshot,
    input.system.marketDataProvider,
    input.candidateLimit ?? 40,
  );
  const qualityStocks = buildDailyQualityStocks(
    snapshot,
    input.system.marketDataProvider,
    input.qualityLimit ?? 60,
  );
  const preferredHistoricalStocks = buildPreferredHistoricalStocks({
    positions,
    candidates,
    qualityStocks,
    limit: 12,
  });
  const [
    leaderboard,
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
  ] = await Promise.all([
    buildStrategyLeaderboard(
      snapshot,
      input.system.marketDataProvider,
      input.leaderboardBars ?? 120,
    ),
    buildMarketRegimeResearch({
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
      marketDataProvider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      snapshot,
      preferredStocks: preferredHistoricalStocks,
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
      preferredSymbols: positions.map((position) => position.symbol),
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
    initialCapital: account.startingEquity ?? input.config.TRADING_STARTING_CASH,
    lotSize: input.system.limits.lotSize,
    maxPositionWeight: input.system.risk.getEffectiveMaxPositionWeight(),
    maxSingleOrderNotional: input.system.risk.getEffectiveMaxOrderNotional(),
    commissionRate: input.config.COMMISSION_RATE,
    minimumCommission: input.config.MIN_COMMISSION,
    cashReserveRatio: input.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
    strategyProfile,
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
