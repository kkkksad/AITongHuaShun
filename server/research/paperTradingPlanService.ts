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
  selectNewsSymbols,
} from "./realResearchData";
import type { RealResearchDataFeed } from "./realResearchData";
import { buildUnavailableStrategyLeaderboard, buildUnrequestedStrategyLeaderboard } from "./strategyLeaderboard";
import { buildCachedStrategyLeaderboard } from "./strategyLeaderboardService";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";
import type { InMemoryResearchStore } from "./researchStore";
import { ResearchResultCache } from "./researchResultCache";
import { withResearchDeadline } from "./researchDeadline";
import { assertPaperExecutionRevision, assertPaperLedgerContext, capturePaperLedgerContext } from "../trading/paperExecutionContext";
import { executionCosts, hasSufficientCash } from "../broker/executionCosts";
import { BackgroundResearchCache } from "./backgroundResearchCache";
import type { BackgroundResearchFallback } from "./backgroundResearchCache";
import { buildPaperPortfolioRisk } from "./paperPortfolioRisk";

const PAPER_RESEARCH_CACHE_TTL_MS = 30_000;
const PAPER_DEGRADED_RESEARCH_CACHE_TTL_MS = 5_000;
const PAPER_AUXILIARY_RESEARCH_TIMEOUT_MS = 4_000;
const PAPER_CORE_RESEARCH_TIMEOUT_MS = 12_000;

interface PaperResearchContext {
  leaderboard: StrategyLeaderboardReport;
  marketRegimeResearch: MarketRegimeResearchReport;
}

const auxiliaryCaches = new WeakMap<TradingSystem, {
  news: BackgroundResearchCache<RealResearchDataFeed>;
  external: BackgroundResearchCache<ExternalMarketImpactReport>;
}>();

function auxiliaryWarning(reason: BackgroundResearchFallback): string {
  if (reason === "capacity") return "辅助上下文后台读取已满，当前无可用快照；核心研究继续。";
  if (reason === "not-yet-observed" || reason === "invalid-time") return "辅助上下文不在当前计划时点内，保持降级；核心研究继续。";
  return "辅助上下文正在后台预热，当前无有效快照；核心研究继续。";
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

interface PaperHistoryEntryBudget {
  cash: number;
  equity: number;
  lotSize: number;
  maxOrderNotional: number;
  maxPositionWeight: number;
  commissionRate: number;
  minimumCommission: number;
  slippageBps: number;
}

export function buildPreferredHistoricalStocks(input: {
  positions: Array<Pick<PositionSnapshot, "symbol" | "name">>;
  candidates: DailyCandidateReport;
  qualityStocks: DailyQualityStockReport;
  limit: number;
  /** An upper bound for research priority; market/strategy sizing still follows history. */
  entryBudget?: PaperHistoryEntryBudget;
  /** Optional deterministic exploration of one affordable tail slot; no extra capacity. */
  rotationSeed?: number;
}): Array<{ symbol: string; name: string }> {
  if (input.rotationSeed !== undefined &&
      (!Number.isSafeInteger(input.rotationSeed) || input.rotationSeed < 0)) {
    throw new Error("Invalid historical rotation seed");
  }
  const positions = input.positions.map((position) => ({
      symbol: position.symbol,
      name: position.name,
    }));
  const canFitLot = (price: number): boolean => {
    const budget = input.entryBudget;
    if (!budget) return true;
    if (!Number.isFinite(price) || price <= 0 || budget.lotSize <= 0) return false;
    const costs = executionCosts({ symbol: "HISTORY", side: "buy", type: "market", quantity: budget.lotSize }, price, budget);
    const equityAfterFill = budget.equity - costs.cashDebit + price * budget.lotSize;
    return hasSufficientCash(budget.cash, costs.cashDebit) &&
      costs.notional <= budget.maxOrderNotional &&
      costs.notional <= equityAfterFill * budget.maxPositionWeight;
  };
  const interleave = (candidateAction: "paper-buy" | "watch", qualityAction: "focus" | "watch", affordable: boolean) => {
    const candidates = input.candidates.candidates.filter((candidate) => candidate.action === candidateAction && canFitLot(candidate.price) === affordable);
    const qualityStocks = input.qualityStocks.stocks.filter((stock) => stock.action === qualityAction && canFitLot(stock.price) === affordable);
    const stocks: Array<{ symbol: string; name: string }> = [];
    for (let index = 0; index < Math.max(candidates.length, qualityStocks.length); index += 1) {
      if (candidates[index]) stocks.push({ symbol: candidates[index].symbol, name: candidates[index].name });
      if (qualityStocks[index]) stocks.push({ symbol: qualityStocks[index].symbol, name: qualityStocks[index].name });
    }
    return stocks;
  };
  // Positions always retain risk coverage. An impossible new lot cannot evict
  // a feasible candidate, but remains available as bounded research backfill.
  const affordable = [
    ...interleave("paper-buy", "focus", true),
    ...interleave("watch", "watch", true),
  ];
  const ordered = [
    ...positions,
    ...affordable,
    ...interleave("paper-buy", "focus", false),
    ...interleave("watch", "watch", false),
  ];
  const seen = new Set<string>();
  const unique = ordered.filter((stock) => {
      if (!/^\d{6}$/.test(stock.symbol) || seen.has(stock.symbol)) return false;
      seen.add(stock.symbol);
      return true;
    });
  const capacity = Math.max(1, Math.min(input.limit, 12));
  const selected = unique.slice(0, capacity);
  if (input.rotationSeed === undefined || selected.length < capacity) return selected;
  const held = new Set(positions.map(stock => stock.symbol));
  if (held.has(selected.at(-1)!.symbol)) return selected;
  const feasible = new Set(affordable.map(stock => stock.symbol));
  const explorationPool = unique.slice(capacity - 1)
    .filter(stock => !held.has(stock.symbol) && feasible.has(stock.symbol));
  if (explorationPool.length < 2) return selected;
  return [...selected.slice(0, -1), explorationPool[input.rotationSeed % explorationPool.length]];
}

export function findLatestConfirmedRestrictiveRouting(
  audits: AuditEvent[],
  tradingDate: string,
  asOf = new Date(),
): ConfirmedRestrictiveRouting | null {
  const cutoff = asOf.getTime();
  if (!Number.isFinite(cutoff)) return null;
  let event: AuditEvent | null = null;
  let latestTime = -Infinity;
  for (const audit of audits) {
    const time = Date.parse(audit.timestamp);
    if (
      Number.isFinite(time) && time <= cutoff && time > latestTime &&
      audit.action === "paper-auto-execution.run" &&
      audit.data?.tradingDate === tradingDate &&
      resolveChinaTradingDate(new Date(time)) === tradingDate &&
      audit.data?.session === "open" &&
      audit.data?.sourceStatus === "live-read-only" &&
      (audit.data?.regime === "risk-off" ||
        audit.data?.regime === "risk-off-recovery")
    ) {
      event = audit;
      latestTime = time;
    }
  }
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
  const upperBound = now.getTime();
  if (!Number.isFinite(upperBound) || !Number.isFinite(lookbackDays)) return {};
  const cutoff = upperBound - Math.max(1, lookbackDays) * 24 * 60 * 60_000;
  const usage: Record<string, number> = {};
  for (const audit of audits) {
    const time = Date.parse(audit.timestamp);
    if (
      audit.action !== "paper-auto-execution.decision" ||
      audit.data?.status !== "filled" ||
      !Number.isFinite(time) || time < cutoff || time > upperBound
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
  historyCutoffDay?: string;
}): string {
  // Market sequence changes on every quote tick; the TTL is the research
  // freshness boundary, so volatile snapshots must not defeat deduplication.
  return [
    input.provider,
    input.mode,
    input.bridgeUrl,
    input.leaderboardBars,
    input.criticalHistoryStockLimit,
    input.historyCutoffDay ?? "unspecified",
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
  asOf: Date;
  system: TradingSystem;
  config: ServerConfig;
  snapshot: ReturnType<TradingSystem["market"]["getSnapshot"]>;
  positions: Array<Pick<PositionSnapshot, "symbol">>;
  preferredHistoricalStocks: Array<{ symbol: string; name: string }>;
  leaderboardBars: number;
  criticalHistoryStockLimit: number;
}): Promise<PaperResearchContext & { realResearchDataFeed: RealResearchDataFeed; externalMarketImpact: ExternalMarketImpactReport }> {
  const snapshotTime = Date.parse(input.snapshot.marketTime);
  const cutoff = Math.min(input.asOf.getTime(), snapshotTime);
  // A-share daily candles complete at 07:00 UTC. Keep the TTL shared across
  // quote ticks, but never reuse a history context across that evidence boundary.
  const historyCutoffDay = Number.isFinite(cutoff) && snapshotTime <= input.asOf.getTime() + 5_000
    ? new Date(cutoff - 7 * 60 * 60_000).toISOString().slice(0, 10)
    : "invalid";
  const core = await getPaperResearchCache(input.system).getOrCreate(
    buildPaperResearchCacheKey({
      provider: input.system.marketDataProvider,
      mode: input.config.MARKET_MODE,
      bridgeUrl: input.config.AKSHARE_BRIDGE_URL,
      leaderboardBars: input.leaderboardBars,
      criticalHistoryStockLimit: input.criticalHistoryStockLimit,
      preferredHistoricalStocks: input.preferredHistoricalStocks,
      positionSymbols: input.positions.map((position) => position.symbol),
      historyCutoffDay,
    }),
    (value) => value.marketRegimeResearch.sourceStatus === "degraded"
      ? PAPER_DEGRADED_RESEARCH_CACHE_TTL_MS
      : PAPER_RESEARCH_CACHE_TTL_MS,
    async () => {
      const coreResearch = Promise.all([
        input.system.marketDataProvider === "akshare"
          ? buildUnrequestedStrategyLeaderboard(input.snapshot, input.system.marketDataProvider, input.leaderboardBars)
          : buildCachedStrategyLeaderboard({
              system: input.system,
              snapshot: input.snapshot,
              bars: input.leaderboardBars,
            }).catch((error) => buildUnavailableStrategyLeaderboard(
              input.snapshot,
              input.system.marketDataProvider,
              input.leaderboardBars,
              error instanceof Error ? error.message : "策略研究暂时不可用",
            )),
        withResearchDeadline({
          task: buildMarketRegimeResearch({
            now: input.asOf,
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
              now: input.asOf,
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
      // Reserve bridge capacity for the decision-critical history first.
      // Optional history can otherwise occupy both workers while the core is
      // still discovering sectors, delaying the stock/sector requests behind it.
      const [leaderboard, marketRegimeResearch] = await coreResearch;
      return { leaderboard, marketRegimeResearch };
    },
    input.asOf.getTime(),
  );
  // Auxiliary snapshots are read independently of the core cache, so a warm
  // core cannot pin an earlier warming placeholder for its entire TTL.
  let caches = auxiliaryCaches.get(input.system);
  if (!caches) {
    caches = { news: new BackgroundResearchCache(), external: new BackgroundResearchCache() };
    auxiliaryCaches.set(input.system, caches);
  }
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
  // Start optional sources only after core history, never await their snapshots.
  const key = JSON.stringify([
    input.config.AKSHARE_BRIDGE_URL, input.config.MARKET_MODE,
    input.system.marketDataProvider, auxiliaryTimeoutMs, historyCutoffDay,
  ]);
  const realResearchDataFeed = caches.news.getOrRefresh(
    key + JSON.stringify(selectNewsSymbols(input.snapshot, realResearchInput.preferredSymbols)), {
      asOf: input.asOf.getTime(), ttlMs: 60_000,
      fallback: reason => buildUnavailableRealResearchDataFeed(realResearchInput, auxiliaryWarning(reason)),
      create: () => withResearchDeadline({
        task: buildRealResearchDataFeed(realResearchInput),
        timeoutMs: auxiliaryTimeoutMs,
        fallback: (reason) => buildUnavailableRealResearchDataFeed(
          realResearchInput,
          "真实新闻与全球市场研究超过 " + auxiliaryTimeoutMs + "ms，已降级: " +
            (reason instanceof Error ? reason.message : "辅助源无响应"),
        ),
      }),
    },
  );
  const externalMarketImpact = caches.external.getOrRefresh(key, {
    asOf: input.asOf.getTime(), ttlMs: 60_000,
    fallback: reason => buildUnavailableExternalMarketImpact(externalMarketInput, auxiliaryWarning(reason)),
    create: () => withResearchDeadline({
      task: buildExternalMarketImpact(externalMarketInput),
      timeoutMs: auxiliaryTimeoutMs,
      fallback: (reason) => buildUnavailableExternalMarketImpact(
        externalMarketInput,
        "外部市场研究超过 " + auxiliaryTimeoutMs + "ms，已降级: " +
          (reason instanceof Error ? reason.message : "辅助源无响应"),
      ),
    }),
  });
  return { ...core, realResearchDataFeed, externalMarketImpact };
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
  // Freeze one evidence boundary and one audit snapshot before any shared async work.
  const asOf = new Date(input.now?.getTime() ?? Date.now());
  if (!Number.isFinite(asOf.getTime())) throw new Error("Invalid Paper plan clock");
  const executionRevision = input.system.store.getExecutionRevision();
  const auditEvidence = input.system.store.listAudit(10_000);
  const snapshot = input.system.market.getSnapshot();
  const account = input.system.broker.getAccount(snapshot);
  const positions = input.system.broker.getPositions(snapshot);
  const ledgerContext = capturePaperLedgerContext(input.system.store);
  const strategyProfile = input.system.store.getStrategyProfile();
  const executionStrategy = input.system.store.getExecutionStrategy();
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
    rotationSeed: executionStrategy === "auto" && input.activityTargetActive === true
      ? asOf.getUTCHours() * 60 + asOf.getUTCMinutes() : undefined,
    entryBudget: {
      cash: Math.max(0, account.cash - Math.max(0, account.equity * input.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO)),
      equity: account.equity,
      lotSize: input.system.limits.lotSize,
      maxOrderNotional: input.system.risk.getEffectiveMaxOrderNotional(),
      maxPositionWeight: input.system.risk.getEffectiveMaxPositionWeight(),
      commissionRate: input.config.COMMISSION_RATE,
      minimumCommission: input.config.MIN_COMMISSION,
      slippageBps: input.config.SLIPPAGE_BPS,
    },
  });
  const researchContext = await buildPaperResearchContext({
    asOf,
    system: input.system,
    config: input.config,
    snapshot,
    positions,
    preferredHistoricalStocks,
    leaderboardBars: input.leaderboardBars ?? 120,
    criticalHistoryStockLimit,
  });
  assertPaperExecutionRevision(input.system.store, executionRevision);
  assertPaperLedgerContext(input.system.store, ledgerContext);
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
      auditEvidence,
      resolveChinaTradingDate(asOf),
      asOf,
    ),
  });

  input.researchStore?.recordMarketSnapshot(snapshot, input.system.marketDataProvider);
  if (leaderboard.evaluationStatus !== "not-requested") {
    input.researchStore?.recordStrategyLeaderboard(leaderboard);
  }
  input.researchStore?.recordDailyCandidates(candidates);
  input.researchStore?.recordDailyQualityStocks(qualityStocks);

  const plan = buildPaperTradingPlan({
    snapshot,
    provider: input.system.marketDataProvider,
    account,
    positions,
    orders: ledgerContext.orders,
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
    slippageBps: input.config.SLIPPAGE_BPS,
    cashReserveRatio: input.config.PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO,
    strategyProfile,
    executionStrategy,
    activityTargetActive: input.activityTargetActive,
    activityMode: input.activityMode,
    strategyUsage: summarizeRecentPaperStrategyUsage(
      auditEvidence,
      asOf,
    ),
  });

  return {
    plan: { ...plan, portfolioRisk: buildPaperPortfolioRisk({
      positions, equity: account.equity, valuationAsOf: snapshot.marketTime, asOf,
      correlations: marketRegimeResearch.stockCorrelations,
    }) },
    leaderboard,
    candidates,
    qualityStocks,
    marketRegimeResearch,
    realResearchDataFeed,
    externalMarketImpact,
    adaptiveRouting,
  };
}
