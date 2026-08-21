import type { ServerConfig } from "../config";
import type { TradingSystem } from "../system";
import type { AuditEvent, PositionSnapshot } from "../../shared/trading";
import { buildDailyCandidates } from "./dailyCandidates";
import type { DailyCandidateReport } from "./dailyCandidates";
import { buildDailyQualityStocks } from "./dailyQualityStocks";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import {
  routeAdaptiveStrategies,
  stabilizeAdaptiveStrategyRouting,
} from "./adaptiveStrategyRouter";
import type { AdaptiveStrategyRouting } from "./adaptiveStrategyRouter";
import type { ConfirmedRestrictiveRouting } from "./adaptiveStrategyRouter";
import { buildMarketRegimeResearch } from "./marketRegimeResearch";
import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import { buildExternalMarketImpact } from "./externalMarketImpact";
import type { ExternalMarketImpactReport } from "./externalMarketImpact";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { PaperTradingActivityMode, PaperTradingPlan } from "./paperTradingPlan";
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
  const positions = input.positions.map((position) => ({
      symbol: position.symbol,
      name: position.name,
    }));
  const candidates = input.candidates.candidates
    .filter((candidate) => candidate.action === "paper-buy" || candidate.action === "watch")
    .map((candidate) => ({ symbol: candidate.symbol, name: candidate.name }));
  const qualityStocks = input.qualityStocks.stocks
    .filter((stock) => stock.action === "focus" || stock.action === "watch")
    .map((stock) => ({ symbol: stock.symbol, name: stock.name }));
  const interleavedResearchPool: Array<{ symbol: string; name: string }> = [];
  const scannerLength = Math.max(candidates.length, qualityStocks.length);
  for (let index = 0; index < scannerLength; index += 1) {
    if (candidates[index]) interleavedResearchPool.push(candidates[index]);
    if (qualityStocks[index]) interleavedResearchPool.push(qualityStocks[index]);
  }
  const ordered = [...positions, ...interleavedResearchPool];
  return ordered
    .filter((stock, index, items) =>
      /^\d{6}$/.test(stock.symbol) &&
      items.findIndex((candidate) => candidate.symbol === stock.symbol) === index,
    )
    .slice(0, Math.max(1, Math.min(input.limit, 12)));
}

export function findLatestConfirmedRestrictiveRouting(
  audits: AuditEvent[],
  tradingDate: string,
): ConfirmedRestrictiveRouting | null {
  const event = audits
    .filter((audit) => (
      audit.action === "paper-auto-execution.run" &&
      audit.data?.tradingDate === tradingDate &&
      audit.data?.session === "open" &&
      audit.data?.sourceStatus === "live-read-only" &&
      (audit.data?.regime === "risk-off" ||
        audit.data?.regime === "risk-off-recovery")
    ))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
  if (!event) return null;
  return {
    regime: event.data!.regime as ConfirmedRestrictiveRouting["regime"],
    confirmedAt: event.timestamp,
  };
}

export function resolveChinaTradingDate(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function resolveCriticalHistoryStockLimit(
  activityTargetActive: boolean,
): number {
  return activityTargetActive ? 12 : 6;
}

function strategyKeyFromDecision(audit: AuditEvent): string | null {
  const explicit = audit.data?.strategyKey;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const ruleChecks = audit.data?.ruleChecks;
  if (!Array.isArray(ruleChecks)) return null;
  for (const ruleCheck of ruleChecks) {
    if (typeof ruleCheck !== "string") continue;
    const match = /^strategy-route: pass \(([^)]+)\)$/.exec(ruleCheck);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function summarizeRecentPaperStrategyUsage(
  audits: AuditEvent[],
  now = new Date(),
  lookbackDays = 7,
): Record<string, number> {
  const cutoff = now.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60_000;
  const usage: Record<string, number> = {};
  for (const audit of audits) {
    if (
      audit.action !== "paper-auto-execution.decision" ||
      audit.data?.status !== "filled" ||
      Date.parse(audit.timestamp) < cutoff
    ) continue;
    const strategyKey = strategyKeyFromDecision(audit);
    if (!strategyKey) continue;
    usage[strategyKey] = (usage[strategyKey] ?? 0) + 1;
  }
  return usage;
}

export async function buildCurrentPaperTradingPlan(input: {
  system: TradingSystem;
  config: ServerConfig;
  researchStore?: InMemoryResearchStore;
  leaderboardBars?: number;
  candidateLimit?: number;
  qualityLimit?: number;
  now?: Date;
  activityTargetActive?: boolean;
  activityMode?: PaperTradingActivityMode;
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
  const criticalHistoryStockLimit = resolveCriticalHistoryStockLimit(
    input.activityTargetActive === true,
  );
  const preferredHistoricalStocks = buildPreferredHistoricalStocks({
    positions,
    candidates,
    qualityStocks,
    limit: criticalHistoryStockLimit,
  });
  const [leaderboard, marketRegimeResearch] = await Promise.all([
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
      sectorLimit: 6,
      stockLimit: criticalHistoryStockLimit,
      days: 180,
      timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
    }),
  ]);
  const [realResearchDataFeed, externalMarketImpact] = await Promise.all([
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
  const observedAdaptiveRouting = routeAdaptiveStrategies(marketRegimeResearch, {
    bias: externalMarketImpact.aShareImpact.bias,
    samples: externalMarketImpact.validation.samples,
    windows: externalMarketImpact.validation.windows,
    directionalHitRate: externalMarketImpact.validation.directionalHitRate,
  });
  const adaptiveRouting = stabilizeAdaptiveStrategyRouting({
    current: observedAdaptiveRouting,
    sourceStatus: marketRegimeResearch.sourceStatus,
    previousConfirmed: findLatestConfirmedRestrictiveRouting(
      input.system.store.listAudit(10_000),
      resolveChinaTradingDate(input.now ?? new Date()),
    ),
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
    activityTargetActive: input.activityTargetActive,
    activityMode: input.activityMode,
    strategyUsage: summarizeRecentPaperStrategyUsage(
      input.system.store.listAudit(10_000),
      input.now ?? new Date(),
    ),
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
