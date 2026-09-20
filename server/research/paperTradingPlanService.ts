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
import {
  buildMarketRegimeResearch,
  buildUnavailableMarketRegimeResearch,
} from "./marketRegimeResearch";
import type { MarketRegimeResearchReport } from "./marketRegimeResearch";
import {
  buildExternalMarketImpact,
  buildUnavailableExternalMarketImpact,
} from "./externalMarketImpact";
import type { ExternalMarketImpactReport } from "./externalMarketImpact";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import type { PaperTradingActivityMode, PaperTradingPlan } from "./paperTradingPlan";
import {
  buildRealResearchDataFeed,
  buildUnavailableRealResearchDataFeed,
} from "./realResearchData";
import type { RealResearchDataFeed } from "./realResearchData";
import {
  buildStrategyLeaderboard,
  buildUnavailableStrategyLeaderboard,
} from "./strategyLeaderboard";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";
import type { InMemoryResearchStore } from "./researchStore";
import { ResearchResultCache } from "./researchResultCache";
import { withResearchDeadline } from "./researchDeadline";

const PAPER_RESEARCH_CACHE_TTL_MS = 30_000;
const PAPER_DEGRADED_RESEARCH_CACHE_TTL_MS = 5_000;
const PAPER_AUXILIARY_RESEARCH_TIMEOUT_MS = 4_000;
const PAPER_CORE_RESEARCH_TIMEOUT_MS = 12_000;

interface PaperResearchContext {
  leaderboard: StrategyLeaderboardReport;
  marketRegimeResearch: MarketRegimeResearchReport;
  realResearchDataFeed: RealResearchDataFeed;
  externalMarketImpact: ExternalMarketImpactReport;
}

const paperResearchCaches = new WeakMap<
  TradingSystem,
  ResearchResultCache<PaperResearchContext>
>();

function getPaperResearchCache(
  system: TradingSystem,
): ResearchResultCache<PaperResearchContext> {
  const cached = paperResearchCaches.get(system);
  if (cached) return cached;

  const created = new ResearchResultCache<PaperResearchContext>({
    maxEntries: 8,
  });
  paperResearchCaches.set(system, created);
  return created;
}

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

export function buildPaperResearchCacheKey(input: {
  provider: string;
  mode: string;
  bridgeUrl: string;
  leaderboardBars: number;
  criticalHistoryStockLimit: number;
  preferredHistoricalStocks: Array<{ symbol: string; name: string }>;
  positionSymbols: string[];
}): string {
  // Market sequence changes on every quote tick; the TTL is the research
  // freshness boundary, so volatile snapshots must not defeat deduplication.
  return [
    input.provider,
    input.mode,
    input.bridgeUrl,
    input.leaderboardBars,
    input.criticalHistoryStockLimit,
    [...input.preferredHistoricalStocks]
      .map((stock) => stock.symbol)
      .sort()
      .join(","),
    [...input.positionSymbols].sort().join(","),
  ].join("|");
}

export function resolveAuxiliaryResearchTimeoutMs(baseTimeoutMs: number): number {
  return Math.min(
    PAPER_AUXILIARY_RESEARCH_TIMEOUT_MS,
    Math.max(1_500, Math.round(baseTimeoutMs / 2)),
  );
}

async function buildPaperResearchContext(input: {
  system: TradingSystem;
  config: ServerConfig;
  snapshot: ReturnType<TradingSystem["market"]["getSnapshot"]>;
  positions: Array<Pick<PositionSnapshot, "symbol">>;
  preferredHistoricalStocks: Array<{ symbol: string; name: string }>;
  leaderboardBars: number;
  criticalHistoryStockLimit: number;
}): Promise<PaperResearchContext> {
  return getPaperResearchCache(input.system).getOrCreate(
    buildPaperResearchCacheKey({
      provider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      leaderboardBars: input.leaderboardBars,
      criticalHistoryStockLimit: input.criticalHistoryStockLimit,
      preferredHistoricalStocks: input.preferredHistoricalStocks,
      positionSymbols: input.positions.map((position) => position.symbol),
    }),
    (value) => value.marketRegimeResearch.sourceStatus === "degraded"
      ? PAPER_DEGRADED_RESEARCH_CACHE_TTL_MS
      : PAPER_RESEARCH_CACHE_TTL_MS,
    async () => {
      const coreResearch = Promise.all([
        buildStrategyLeaderboard(
          input.snapshot,
          input.system.marketDataProvider,
          input.leaderboardBars,
        ).catch((error) => buildUnavailableStrategyLeaderboard(
          input.snapshot,
          input.system.marketDataProvider,
          input.leaderboardBars,
          error instanceof Error ? error.message : "策略研究暂时不可用",
        )),
        withResearchDeadline({
          task: buildMarketRegimeResearch({
            bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
            bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
            marketDataProvider: input.system.marketDataProvider,
            mode: input.config.MARKET_MODE,
            snapshot: input.snapshot,
            preferredStocks: input.preferredHistoricalStocks,
            sectorLimit: 6,
            stockLimit: input.criticalHistoryStockLimit,
            days: 180,
            timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
          }),
          timeoutMs: PAPER_CORE_RESEARCH_TIMEOUT_MS,
          fallback: (reason) => buildUnavailableMarketRegimeResearch(
            {
              bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
              bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
              marketDataProvider: input.system.marketDataProvider,
              mode: input.config.MARKET_MODE,
              snapshot: input.snapshot,
              preferredStocks: input.preferredHistoricalStocks,
              sectorLimit: 6,
              stockLimit: input.criticalHistoryStockLimit,
              days: 180,
              timeoutMs: input.config.MARKET_DATA_TIMEOUT_MS,
            },
            "核心板块与个股历史研究超过 " + PAPER_CORE_RESEARCH_TIMEOUT_MS + "ms，已降级: " +
              (reason instanceof Error ? reason.message : "核心研究无响应"),
          ),
        }),
      ]);
      const auxiliaryTimeoutMs = resolveAuxiliaryResearchTimeoutMs(
        input.config.MARKET_DATA_TIMEOUT_MS,
      );
      const realResearchInput = {
        bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
        bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
        marketDataProvider: input.system.marketDataProvider,
        mode: input.config.MARKET_MODE,
        snapshot: input.snapshot,
        preferredSymbols: input.positions.map((position) => position.symbol),
        timeoutMs: auxiliaryTimeoutMs,
      };
      const externalMarketInput = {
        bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
        bridgeToken: input.config.AKSHARE_BRIDGE_TOKEN || undefined,
        marketDataProvider: input.system.marketDataProvider,
        mode: input.config.MARKET_MODE,
        days: 500,
        timeoutMs: auxiliaryTimeoutMs,
      };
      // Auxiliary sources start beside the core research and cannot hold the
      // Paper plan hostage when the bridge is slow or partially unavailable.
      const auxiliaryResearch = Promise.all([
        withResearchDeadline({
          task: buildRealResearchDataFeed(realResearchInput),
          timeoutMs: auxiliaryTimeoutMs,
          fallback: (reason) => buildUnavailableRealResearchDataFeed(
            realResearchInput,
            "真实新闻与全球市场研究超过 " + auxiliaryTimeoutMs + "ms，已降级: " +
              (reason instanceof Error ? reason.message : "辅助源无响应"),
          ),
        }),
        withResearchDeadline({
          task: buildExternalMarketImpact(externalMarketInput),
          timeoutMs: auxiliaryTimeoutMs,
          fallback: (reason) => buildUnavailableExternalMarketImpact(
            externalMarketInput,
            "外部市场研究超过 " + auxiliaryTimeoutMs + "ms，已降级: " +
              (reason instanceof Error ? reason.message : "辅助源无响应"),
          ),
        }),
      ]);
      const [[leaderboard, marketRegimeResearch], [realResearchDataFeed, externalMarketImpact]] =
        await Promise.all([coreResearch, auxiliaryResearch]);
      return {
        leaderboard,
        marketRegimeResearch,
        realResearchDataFeed,
        externalMarketImpact,
      };
    },
  );
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
  const researchContext = await buildPaperResearchContext({
    system: input.system,
    config: input.config,
    snapshot,
    positions,
    preferredHistoricalStocks,
    leaderboardBars: input.leaderboardBars ?? 120,
    criticalHistoryStockLimit,
  });
  const {
    leaderboard,
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
  } = researchContext;
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
