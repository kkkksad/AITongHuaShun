import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";
import { ApiRequestError } from "./apiError";

export interface HealthSnapshot {
  ok: boolean;
  service: string;
  mode: TradingMode;
  marketDataProvider: MarketDataProviderName;
  realTradingEnabled: boolean;
  authEnabled: boolean;
  websocketConnections: number;
  timestamp: string;
}

export type MarketDataProviderName = "mock" | "akshare";

export interface CapabilitiesSnapshot {
  marketData: {
    provider: MarketDataProviderName;
    mode: TradingMode;
    readOnly: true;
    external: boolean;
  };
  execution: {
    provider: "paper-broker";
    mode: "paper";
    liveSupported: false;
    humanApprovalRequiredForLive: true;
  };
  autoPaperExecution: {
    enabled: boolean;
    mode: "local-paper-broker-only";
    tradeWindowOnly: boolean;
    intervalMs: number;
    maxOrdersPerRun: number;
    maxDailyOrders: number;
    liveTradingEnabled: false;
  };
  credentials: {
    browserAllowed: false;
    storage: "server-password-hash-only";
  };
  authentication: {
    enabled: boolean;
    mode: "server-session" | "test-unprotected";
    defaultCredentials: false;
  };
  researchData: {
    dataDir: string;
    maxSymbols: number;
    historyDays: number;
    maxCacheMb: number;
    storeRawNews: boolean;
  };
  openApi: string | null;
}

export interface TradingBootstrap {
  health: HealthSnapshot;
  capabilities: CapabilitiesSnapshot;
  market: MarketSnapshot;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  limits: RiskLimits;
}

export interface SystemStatus {
  health: HealthSnapshot;
  capabilities: CapabilitiesSnapshot;
}

export interface OrderSubmission {
  order: OrderRecord;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
}

export interface StrategyLeaderboardEntry {
  rank: number;
  strategyKey: string;
  strategyName: string;
  score: number;
  bestParams: Record<string, number>;
  metrics: {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdownPercent: number;
    winRate: number;
    totalTrades: number;
  };
  qualityGate: "pass" | "caution" | "blocked";
  trialCount: number;
}

export interface StrategyLeaderboardReport {
  generatedAt: string;
  seed: number;
  source: {
    provider: MarketDataProviderName;
    mode: TradingMode;
    sampleType: "synthetic-from-current-snapshot";
    quoteCount: number;
    tradableSymbols: string[];
    bars: number;
    snapshotSequence: number;
    snapshotTime: string;
  };
  dataQuality: {
    timestamp: string;
    score: {
      freshness: number;
      completeness: number;
      suspensionRate: number;
      limitUpCount: number;
      limitDownCount: number;
      adjustmentWarningCount: number;
      anomalyPriceCount: number;
      overall: number;
    };
    totalSymbols: number;
    summary: string;
  };
  objective: { metric: string; weight: number }[];
  costModel: {
    initialCapital: number;
    commissionRate: number;
    minimumCommission: number;
    slippageBps: number;
    maxOrderNotional: number;
    maxPositionWeight: number;
  };
  guardrails: string[];
  entries: StrategyLeaderboardEntry[];
}

export type StrategyRobustnessFamily =
  | "trend"
  | "pullback"
  | "breakout"
  | "mean-reversion"
  | "defensive";

export interface StrategyRobustnessEntry {
  rank: number;
  strategyKey: string;
  strategyName: string;
  strategyFamily: StrategyRobustnessFamily;
  fixedParams: Record<string, number>;
  windows: number;
  profitableWindows: number;
  totalTrades: number;
  medianReturn: number;
  worstReturn: number;
  averageMaxDrawdown: number;
  worstMaxDrawdown: number;
  averageWinRate: number;
  stabilityGate: "pass" | "caution" | "blocked";
}

export interface StrategyRobustnessReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    sampleType: "real-qfq-fixed-parameter-multi-window";
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    requestedSymbols: number;
    historySymbols: number;
    alignedTradingDays: number;
    windowCount: 3;
  };
  methodology: {
    parametersOptimizedOnReportData: false;
    nonOverlappingWindows: true;
    minimumAlignedTradingDays: number;
    stabilityMeaning: string;
  };
  entries: StrategyRobustnessEntry[];
  warnings: string[];
  guardrails: string[];
}

export type CrossMarketRiskTone = "risk-on" | "neutral" | "risk-off" | "mixed";
export type CrossMarketSignalTone = "positive" | "neutral" | "negative";

export interface CrossMarketSignalGroup {
  tone: CrossMarketSignalTone;
  coverage: number;
  averageChangePercent: number;
  averageReturn20d: number | null;
}

export interface CrossMarketGlobalSignal extends CrossMarketSignalGroup {
  advancerRatio: number;
}

export interface FuturesMarketResearchItem {
  symbol: string;
  name: string;
  category: string;
  price: number;
  previousSettlement: number;
  changePercent: number;
  volume: number;
  openInterest: number;
  updatedAt: string;
  source: string;
  history: {
    source: string;
    adjustment: "continuous-main";
    latestDate: string | null;
    barCount: number;
    return5d: number | null;
    return20d: number | null;
    return60d: number | null;
    annualizedVolatility20d: number | null;
    drawdownFrom60DayHigh: number | null;
  };
  forecast: {
    horizonDays: 5;
    direction: "bullish" | "bearish" | "range" | "insufficient";
    structure: "uptrend" | "downtrend" | "range" | "unknown";
    sampleQuality: "strong" | "usable" | "insufficient";
    sampleSize: number;
    upFrequency: number | null;
    downFrequency: number | null;
    rangeFrequency: number | null;
    medianForwardReturn: number | null;
    medianMaxFavorableMove: number | null;
    medianMaxAdverseMove: number | null;
    moveThreshold: number | null;
    currentReturn20d: number | null;
    currentVolatility20d: number | null;
    evidence: string[];
    invalidation: string;
  };
}

export interface CrossMarketStrategyContextReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    globalSource: string;
    futuresQuoteSource: string;
    futuresHistorySource: string;
    fetchedAt: string | null;
    requestedDays: number;
    globalCount: number;
    futuresQuoteCount: number;
    futuresHistoryCount: number;
  };
  riskTone: CrossMarketRiskTone;
  positionPosture: "normal" | "reduced" | "cash-only";
  preferredStrategyFamilies: StrategyRobustnessFamily[];
  deweightedStrategyFamilies: StrategyRobustnessFamily[];
  preferredStrategyKeys: string[];
  evidence: string[];
  signals: {
    global: CrossMarketGlobalSignal;
    equityFutures: CrossMarketSignalGroup;
    industrialFutures: CrossMarketSignalGroup;
    preciousMetals: CrossMarketSignalGroup;
  };
  futures: FuturesMarketResearchItem[];
  warnings: string[];
  guardrails: string[];
}

export type DailyCandidateAction = "watch" | "paper-buy" | "avoid";

export interface DailyCandidate {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  score: number;
  action: DailyCandidateAction;
  confidence: number;
  suggestedPositionWeight: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyCandidateReport {
  generatedAt: string;
  strategyKey: "aSharePullback";
  strategyName: "A股强势回踩确认";
  mode: TradingMode;
  source: {
    provider: MarketDataProviderName;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  autoUpdate: {
    marketRefresh: string;
    researchRefresh: string;
    execution: "paper-only";
    nextStep: string;
  };
  guardrails: string[];
  candidates: DailyCandidate[];
}

export type QualityStockAction = "focus" | "watch" | "avoid";
export type QualityStockGrade = "S" | "A" | "B" | "C";

export interface DailyQualityStock {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number | null;
  score: number;
  grade: QualityStockGrade;
  action: QualityStockAction;
  style: "core" | "growth" | "momentum" | "defensive";
  confidence: number;
  suggestedPositionWeight: number;
  factors: {
    liquidity: number;
    momentum: number;
    stability: number;
    intradayStrength: number;
    turnover: number;
  };
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyQualityStockReport {
  generatedAt: string;
  mode: TradingMode;
  source: {
    provider: string;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  methodology: {
    name: "每日优质股评分";
    version: string;
    dataScope: {
      realtimeQuote: boolean;
      historicalBars: boolean;
      news: boolean;
      fundamentals: boolean;
    };
    weights: Record<string, number>;
  };
  autoUpdate: {
    marketRefresh: string;
    qualityRefresh: string;
    execution: "paper-only";
  };
  guardrails: string[];
  stocks: DailyQualityStock[];
}

export interface ResearchRunSample {
  recordedAt: string;
  kind: "strategy-leaderboard" | "daily-candidates" | "daily-quality-stocks";
  provider: string;
  mode: TradingMode;
  snapshotSequence: number;
  snapshotTime: string;
  itemCount: number;
  topSymbols: string[];
  summary: string;
}

export interface LearningState {
  generatedAt: string;
  dataMemory: {
    storage: "in-memory";
    marketSnapshotSamples: number;
    researchRuns: number;
    firstSnapshotTime: string | null;
    latestSnapshotTime: string | null;
    providersSeen: string[];
    symbolsSeen: number;
    topSymbols: string[];
  };
  researchLoop: {
    strategyLeaderboardRuns: number;
    dailyCandidateRuns: number;
    dailyQualityRuns: number;
    latestRuns: ResearchRunSample[];
  };
  currentCapability: {
    realtimeQuotes: boolean;
    historicalBars: boolean;
    paperExecution: boolean;
    liveExecution: false;
    statement: string;
  };
  nextDataNeeds: string[];
  guardrails: string[];
}

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

export type AdaptiveMarketRegime =
  | "trend-up-low-volatility"
  | "trend-up-high-volatility"
  | "range-low-volatility"
  | "range-high-volatility"
  | "risk-off"
  | "unclear";

export type AdaptivePositionPosture = "accumulate" | "hold" | "reduce";

export interface AdaptiveStrategyPlaybook {
  primaryStrategyKeys: string[];
  useWhen: string;
  avoidWhen: string;
  recheckTriggers: string[];
}

export interface AdaptiveCapitalPacing {
  openingMaxInvestedRatio: number;
  morningMaxInvestedRatio: number;
  afternoonMaxInvestedRatio: number;
  closingMaxInvestedRatio: number;
}

export interface AdaptiveStrategyRouting {
  version: "1.1.0";
  generatedAt: string;
  regime: AdaptiveMarketRegime;
  confidence: number;
  positionPosture: AdaptivePositionPosture;
  allowNewPositions: boolean;
  cashReserveRatio: number;
  newPositionScale: number;
  eligibleStrategyKeys: string[];
  disabledStrategyKeys: string[];
  strategyPlaybook: AdaptiveStrategyPlaybook;
  capitalPacing: AdaptiveCapitalPacing;
  evidence: string[];
  riskFlags: string[];
  metrics: {
    constructiveSectorRatio: number;
    cautiousSectorRatio: number;
    averageReturn20d: number;
    averageReturn60d: number;
    averageMa20Slope5d: number;
    averageVolatility20d: number;
    averageBreadthRatio: number | null;
    healthyStockRatio: number;
    deterioratingStockRatio: number;
  };
}

export interface PaperTradingPlan {
  generatedAt: string;
  tradingDate: string;
  mode: TradingMode;
  provider: MarketDataProviderName;
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

export type SuperMindSignalAction = "buy" | "sell" | "hold";

export interface SuperMindSignalRow {
  signalId: string;
  tradingDate: string;
  symbol: string;
  name: string;
  action: SuperMindSignalAction;
  quantity: number;
  price: number;
  notional: number;
  strategy: string;
  reason: string;
  sourceAction: PaperTradingOperationAction;
  manualApprovalRequired: true;
}

export interface SuperMindSignalPackage {
  generatedAt: string;
  bridge: {
    provider: "supermind";
    mode: "signal-file-only";
    execution: "manual-upload-or-review";
    liveTradingEnabled: false;
  };
  sourcePlan: {
    generatedAt: string;
    tradingDate: string;
    provider: string;
    planQuality: PaperTradingPlanQualitySummary["planQuality"];
    operationCount: number;
  };
  signals: SuperMindSignalRow[];
  csv: string;
  supermindTemplate: string;
  nextSteps: string[];
  guardrails: string[];
}

export type PaperAutoExecutionTrigger = "timer" | "manual" | "startup";
export type PaperAutoExecutionSession =
  | "open"
  | "pre-market"
  | "lunch-break"
  | "after-hours"
  | "weekend";

export interface PaperAutoExecutionOrder {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  clientOrderId: string;
  status: OrderRecord["status"];
  orderId: string;
  rejectionReason?: string;
  strategy: string;
  reason: string;
  ruleChecks: string[];
  estimatedNotional: number;
}

export interface PaperAutoExecutionSkip {
  symbol: string;
  action: PaperTradingOperationAction;
  reason: string;
}

export interface PaperAutoExecutionRun {
  id: string;
  trigger: PaperAutoExecutionTrigger;
  startedAt: string;
  finishedAt: string;
  tradingDate: string;
  session: PaperAutoExecutionSession;
  planQuality: PaperTradingPlanQualitySummary["planQuality"] | "not-run";
  submittedOrders: PaperAutoExecutionOrder[];
  skippedOperations: PaperAutoExecutionSkip[];
  guardrails: string[];
}

export interface PaperAutoExecutionStatus {
  enabled: boolean;
  running: boolean;
  mode: "paper-auto";
  execution: "local-paper-broker-only";
  liveTradingEnabled: false;
  intervalMs: number;
  tradeWindowOnly: boolean;
  maxOrdersPerRun: number;
  maxDailyOrders: number;
  todaySubmittedOrders: number;
  phaseDailyOrderLimit: number;
  phaseRemainingOrders: number;
  currentSession: PaperAutoExecutionSession;
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  latestRun: PaperAutoExecutionRun | null;
  recentRuns: PaperAutoExecutionRun[];
  guardrails: string[];
}

export interface PaperAutoExecutionRunResponse {
  run: PaperAutoExecutionRun;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
}

export type DailyMarketTone =
  | "risk-on"
  | "balanced"
  | "risk-off"
  | "insufficient-data";

export interface DailyMarketReview {
  generatedAt: string;
  tradingDate: string;
  dateBasis:
    | "current-weekday"
    | "pre-market-previous-weekday"
    | "weekend-previous-weekday";
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
    dailyPnl: number | null;
    dailyPnlPercent: number | null;
    cumulativePnl: number;
    cumulativePnlPercent: number;
    performanceBasis: "mark-to-market" | "unavailable";
    openingEquity: number | null;
    missingPreviousCloseSymbols: string[];
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
    items: Array<{
      orderId: string;
      symbol: string;
      name: string;
      side: "buy" | "sell";
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
    }>;
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

export type RealResearchSourceStatus =
  | "live-read-only"
  | "mock-disabled"
  | "degraded";

export type RealResearchSentiment = "positive" | "neutral" | "negative";
export type GlobalImpactDirection = "risk-on" | "neutral" | "risk-off";

export interface RealNewsItem {
  id: string;
  source: string;
  title: string;
  publishedAt: string;
  fetchedAt: string;
  url: string | null;
  symbols: string[];
  sentiment: RealResearchSentiment;
  summary: string | null;
}

export interface GlobalMarketSignal {
  symbol: string;
  name: string;
  region: string;
  price: number;
  changePercent: number;
  updatedAt: string;
  source: string;
}

export interface RealResearchDataFeed {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: RealResearchSourceStatus;
  news: {
    provider: string;
    source: string;
    fetchedAt: string | null;
    items: RealNewsItem[];
    warning: string | null;
  };
  globalMarkets: {
    provider: string;
    fetchedAt: string | null;
    markets: GlobalMarketSignal[];
    warning: string | null;
  };
  impact: {
    direction: GlobalImpactDirection;
    score: number;
    summary: string;
    drivers: string[];
    aShareContext: string[];
  };
  guardrails: string[];
}

export type MarketRegimeSourceStatus =
  | "live-read-only"
  | "degraded"
  | "mock-disabled";
export type SectorOutlookDirection = "constructive" | "neutral" | "cautious";
export type StockRegime =
  | "washout-candidate"
  | "trend-deterioration"
  | "healthy-trend"
  | "unclear"
  | "insufficient-data";

export interface DirectionalValidation {
  horizon: 3 | 5;
  samples: number;
  directionalHitRate: number | null;
  averageForwardReturn: number | null;
  lastSignalDate: string | null;
  lastOutcomeDate: string | null;
}

export interface SectorOutlook {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string;
  barCount: number;
  direction: SectorOutlookDirection;
  score: number;
  confidence: number;
  growthProbability3d: number;
  growthProbability5d: number;
  current: {
    changePercent: number;
    mainNetInflow: number | null;
    advancers: number | null;
    decliners: number | null;
    leaderName: string | null;
  };
  factors: {
    return5d: number;
    return20d: number;
    return60d: number;
    ma20Slope5d: number;
    annualizedVolatility20d: number;
    volumeRatio5d: number;
    breadthRatio: number | null;
  };
  validation: {
    horizon3: DirectionalValidation;
    horizon5: DirectionalValidation;
  };
  evidence: string[];
  riskFlags: string[];
}

export interface StockRegimeResult {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string | null;
  barCount: number;
  regime: StockRegime;
  confidence: number;
  features: {
    return5d: number;
    return20d: number;
    return60d: number;
    pullbackFrom20DayHigh: number;
    distanceFromMa20: number;
    distanceFromMa60: number;
    ma20Slope5d: number;
    ma60Slope5d: number;
    volumeRatio: number;
  };
  validation: {
    samples: number;
    hitRate5d: number | null;
    averageForwardReturn5d: number | null;
  };
  evidence: string[];
  riskFlags: string[];
}

export interface MarketRegimeResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: MarketRegimeSourceStatus;
  source: {
    sectorSource: string;
    sectorHistorySource: string;
    stockHistorySource: string;
    fetchedAt: string | null;
    days: number;
    sectorAdjustment: "none";
    stockAdjustment: "qfq";
    sectorCount: number;
    stockCount: number;
  };
  methodology: {
    version: string;
    horizons: [3, 5];
    minimumBars: number;
    walkForward: true;
    probabilityMeaning: string;
  };
  sectorOutlooks: SectorOutlook[];
  stockRegimes: StockRegimeResult[];
  warnings: string[];
  guardrails: string[];
}

export type TurningBias =
  | "up"
  | "down"
  | "two-way"
  | "none"
  | "insufficient-data";

export interface TurningPointCandidate {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string | null;
  barCount: number;
  source: string;
  adjustment: string;
  bias: TurningBias;
  readinessScore: number;
  compressionScore: number;
  triggerScore: number;
  features: {
    atr14Percent: number;
    annualizedVolatility20d: number;
    bollingerBandwidth20d: number;
    rangeWidth20d: number;
    rangePosition20d: number;
    return5d: number;
    return20d: number;
    volumeRatio5d: number;
    distanceFromMa20: number;
  };
  validation: {
    samples: number;
    breakProbability: number | null;
    upProbability: number | null;
    downProbability: number | null;
    noBreakProbability: number | null;
    medianUpTradingDay: number | null;
    medianDownTradingDay: number | null;
    medianUpReturn: number | null;
    medianDownReturn: number | null;
    lastOutcomeDate: string | null;
  };
  evidence: string[];
  riskFlags: string[];
}

export interface TurningPointReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    universeCount: number;
    analyzedCount: number;
  };
  horizon: 5;
  minimumBars: 126;
  minimumSamples: 20;
  methodology: {
    version: string;
    eventDefinition: string;
    probabilityMeaning: string;
    rankingMeaning: string;
    walkForward: true;
  };
  candidates: TurningPointCandidate[];
  warnings: string[];
  guardrails: string[];
}

export type HongKongTrend =
  | "uptrend"
  | "recovering"
  | "range"
  | "weakening"
  | "downtrend"
  | "insufficient-data";

export interface HongKongMarketItem {
  rank: number;
  symbol: string;
  name: string;
  latestDate: string | null;
  barCount: number;
  price: number | null;
  changePercent: number | null;
  amount: number | null;
  trend: HongKongTrend;
  score: number;
  factors: {
    return5d: number;
    return20d: number;
    return60d: number;
    distanceFromMa20: number;
    distanceFromMa60: number;
    ma20Slope5d: number;
    annualizedVolatility20d: number;
    drawdownFrom20DayHigh: number;
    volumeRatio5d: number;
  };
  validation: {
    samples: number;
    upProbability5d: number | null;
    averageForwardReturn5d: number | null;
    worstForwardReturn5d: number | null;
    lastOutcomeDate: string | null;
  };
  evidence: string[];
  riskFlags: string[];
}

export interface HongKongMarketResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    quoteSource: string;
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    quoteCount: number;
    historyCount: number;
  };
  methodology: {
    version: string;
    minimumBars: 61;
    validationHorizon: 5;
    scoreMeaning: string;
    validationMeaning: string;
    walkForward: true;
  };
  items: HongKongMarketItem[];
  warnings: string[];
  guardrails: string[];
}

export type StockTrendHorizon = 3 | 5 | 10;
export type StockTrendDirection =
  | "bullish"
  | "slightly-bullish"
  | "sideways"
  | "slightly-bearish"
  | "bearish"
  | "insufficient-data";

export interface StockSearchMatch {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  updatedAt: string;
}

export interface StockTrendValidation {
  samples: number;
  directionalHitRate: number | null;
  empiricalUpProbability: number | null;
  empiricalDownProbability: number | null;
  empiricalFlatProbability: number | null;
  averageForwardReturn: number | null;
  bestForwardReturn: number | null;
  worstForwardReturn: number | null;
  medianPeakTradingDay: number | null;
  medianTroughTradingDay: number | null;
  medianPeakReturn: number | null;
  medianTroughReturn: number | null;
  lastSignalDate: string | null;
  lastOutcomeDate: string | null;
}

export interface StockTrendOutlook {
  horizon: StockTrendHorizon;
  direction: StockTrendDirection;
  score: number;
  signalStrength: number;
  volatilityReferencePercent: number;
  validation: StockTrendValidation;
}

export interface StockTrendForecastReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  query: string;
  resolution: "resolved" | "ambiguous" | "not-found" | "mock-disabled" | "degraded";
  selected: StockSearchMatch | null;
  matches: StockSearchMatch[];
  source: {
    searchSource: string;
    historySource: string;
    fetchedAt: string | null;
    adjustment: "qfq";
    requestedDays: number;
    barCount: number;
  };
  latest: {
    date: string;
    close: number;
    changePercent: number;
  } | null;
  factors: {
    return5d: number;
    return20d: number;
    return60d: number;
    distanceFromMa20: number;
    distanceFromMa60: number;
    ma20Slope5d: number;
    ma60Slope5d: number;
    rsi14: number;
    annualizedVolatility20d: number;
    atr14Percent: number;
    volumeRatio5d: number;
    drawdownFrom20DayHigh: number;
  } | null;
  supportResistance: {
    support20: number;
    resistance20: number;
  } | null;
  horizons: StockTrendOutlook[];
  chart: Array<{
    date: string;
    close: number;
    ma20: number | null;
    ma60: number | null;
  }>;
  evidence: string[];
  risks: string[];
  warnings: string[];
  methodology: {
    version: string;
    horizons: [3, 5, 10];
    minimumBars: number;
    walkForward: true;
    scoreMeaning: string;
    validationMeaning: string;
  };
  guardrails: string[];
}

export type IpoSubscriptionStatus =
  | "open-today"
  | "upcoming"
  | "awaiting-listing"
  | "listed-recently";

export type IpoRecommendation =
  | "consider"
  | "cautious"
  | "avoid"
  | "wait-for-pricing"
  | "closed";

export interface IpoSubscriptionResearchItem {
  symbol: string;
  name: string;
  subscriptionCode: string;
  exchange: string;
  board: string;
  issueTotalWanShares: number | null;
  onlineIssueShares: number | null;
  marketValueRequirementWan: number | null;
  maxSubscriptionShares: number | null;
  issuePrice: number | null;
  latestPrice: number | null;
  subscriptionDate: string | null;
  ballotDate: string | null;
  paymentDate: string | null;
  listingDate: string | null;
  issuePe: number | null;
  industryPe: number | null;
  winningRate: number | null;
  firstDayChangePercent: number | null;
  status: IpoSubscriptionStatus;
  score: number | null;
  recommendation: IpoRecommendation;
  reasons: string[];
  risks: string[];
}

export interface IpoSubscriptionResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: string;
  fetchedAt: string | null;
  window: {
    lookbackDays: 30;
    lookaheadDays: 30;
  };
  counts: {
    openToday: number;
    upcoming: number;
    awaitingListing: number;
    listedRecently: number;
  };
  methodology: {
    version: string;
    scoreMeaning: string;
    recommendationMeaning: string;
  };
  items: IpoSubscriptionResearchItem[];
  warning: string | null;
  guardrails: string[];
}

export interface AuthUser {
  username: string;
  role: string;
}

export interface LoginResponse {
  authenticated: true;
  expiresIn: number;
  expiresAt: string;
  csrfToken: string;
  user: AuthUser;
}

export interface AuthVerifyResponse {
  authenticated: true;
  expiresAt: string;
  csrfToken: string;
  user: AuthUser;
}

export interface SelfOptimizationStatus {
  generatedAt: string;
  mode: "paper-research";
  optimizer: {
    status: "guarded-ready";
    cadence: string;
    currentInputs: string[];
    nextInputs: string[];
    objective: string[];
  };
  retention: {
    backend: "bounded-local-cache";
    dataDir: string;
    maxSymbols: number;
    historyDays: number;
    maxCacheMb: number;
    storeRawNews: boolean;
    policy: string[];
    estimatedDailyBarMb: number;
  };
  dataSources: {
    marketProvider: string;
    historicalBars: string;
    news: string;
    globalMarkets: string;
  };
  guardrails: string[];
}

interface AccountResponse {
  account: AccountSnapshot;
}

const API_PROXY_MISS_HINT =
  "API 代理未命中：请求返回了前端 HTML。请确认使用 npm run dev 或 npm run dev:a-share 启动，且 4173 端口由 config/vite.app.config.js 提供；如果只启动前端，请设置 VITE_API_BASE_URL=http://127.0.0.1:8787。";
export const AUTH_EXPIRED_EVENT = "kairos:auth-expired";
let csrfToken: string | null = null;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return typeof configured === "string" && configured.trim()
    ? trimTrailingSlash(configured.trim())
    : "";
}

export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return path;
  }
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function getPayloadMessage(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return undefined;
}

function formatNonJsonError(path: string, response: Response, body: string): Error {
  const preview = body.trim().replace(/\s+/g, " ").slice(0, 140);
  const looksLikeHtml = /^<!doctype html/i.test(preview) || /^<html/i.test(preview);
  if (looksLikeHtml) {
    return new ApiRequestError(API_PROXY_MISS_HINT, response.status, response.status >= 500);
  }
  return new ApiRequestError(
    `API ${path} 返回了非 JSON 响应（HTTP ${response.status}）：${preview || "空响应"}`,
    response.status,
    response.status >= 500,
  );
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = getApiUrl(path);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知网络错误";
    throw new ApiRequestError(`无法连接交易 API：${url}（${detail}）`, null, true);
  }

  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new ApiRequestError(`请求失败：HTTP ${response.status}`, response.status, response.status >= 500);
    }
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw formatNonJsonError(path, response, text);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiRequestError(`API ${path} 返回了无法解析的 JSON 响应。`, response.status, false);
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/api/auth/login" &&
      path !== "/api/auth/session"
    ) {
      notifyAuthExpired();
    }
    throw new ApiRequestError(
      getPayloadMessage(payload) ?? `请求失败：HTTP ${response.status}`,
      response.status,
      response.status >= 500,
    );
  }

  return payload as T;
}

export function notifyAuthExpired(): void {
  csrfToken = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export async function authApiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);
  return apiRequest<T>(path, {
    ...init,
    headers: {
      ...(needsCsrf && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init?.headers,
    },
  });
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  csrfToken = response.csrfToken;
  return response;
}

export async function verifyLogin(): Promise<AuthVerifyResponse> {
  const response = await apiRequest<AuthVerifyResponse>("/api/auth/session");
  csrfToken = response.csrfToken;
  return response;
}

export async function logout(): Promise<void> {
  try {
    await authApiRequest<{ message: string }>("/api/auth/logout", { method: "POST" });
  } finally {
    csrfToken = null;
  }
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const [health, capabilities] = await Promise.all([
    apiRequest<HealthSnapshot>("/api/health"),
    authApiRequest<CapabilitiesSnapshot>("/api/capabilities"),
  ]);

  return { health, capabilities };
}

export async function fetchTradingBootstrap(): Promise<TradingBootstrap> {
  const { health, capabilities } = await fetchSystemStatus();
  const [market, account, positions, orders, limits] = await Promise.all([
    authApiRequest<MarketSnapshot>("/api/market/snapshot"),
    authApiRequest<AccountSnapshot>("/api/account"),
    authApiRequest<PositionSnapshot[]>("/api/positions"),
    authApiRequest<OrderRecord[]>("/api/orders?limit=50"),
    authApiRequest<RiskLimits>("/api/risk/limits"),
  ]);

  return { health, capabilities, market, account, positions, orders, limits };
}

export function submitPaperOrder(order: OrderRequest): Promise<OrderSubmission> {
  return authApiRequest<OrderSubmission>("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function fetchStrategyLeaderboard(
  bars = 90,
): Promise<StrategyLeaderboardReport> {
  return authApiRequest<StrategyLeaderboardReport>(
    `/api/research/strategy-leaderboard?bars=${bars}`,
  );
}

export function fetchStrategyRobustness(
  limit = 12,
  days = 500,
): Promise<StrategyRobustnessReport> {
  const boundedLimit = Math.min(12, Math.max(2, Math.round(limit)));
  const boundedDays = Math.min(500, Math.max(360, Math.round(days)));
  return authApiRequest<StrategyRobustnessReport>(
    `/api/research/strategy-robustness?limit=${boundedLimit}&days=${boundedDays}`,
  );
}

export function fetchCrossMarketStrategyContext(
  limit = 12,
  days = 180,
): Promise<CrossMarketStrategyContextReport> {
  const boundedLimit = Math.min(16, Math.max(4, Math.round(limit)));
  const boundedDays = Math.min(500, Math.max(60, Math.round(days)));
  return authApiRequest<CrossMarketStrategyContextReport>(
    "/api/research/cross-market-strategy-context" +
      `?limit=${boundedLimit}&days=${boundedDays}`,
  );
}

export function fetchDailyCandidates(limit = 8): Promise<DailyCandidateReport> {
  return authApiRequest<DailyCandidateReport>(
    `/api/research/daily-candidates?limit=${limit}`,
  );
}

export function fetchDailyQualityStocks(limit = 10): Promise<DailyQualityStockReport> {
  return authApiRequest<DailyQualityStockReport>(
    `/api/research/daily-quality-stocks?limit=${limit}`,
  );
}

export function fetchLearningState(): Promise<LearningState> {
  return authApiRequest<LearningState>("/api/research/learning-state");
}

export function fetchPaperTradingPlan(): Promise<PaperTradingPlan> {
  return authApiRequest<PaperTradingPlan>("/api/research/paper-trading-plan");
}

export function fetchDailyMarketReview(): Promise<DailyMarketReview> {
  return authApiRequest<DailyMarketReview>("/api/research/daily-review");
}

export function fetchSuperMindSignalPackage(): Promise<SuperMindSignalPackage> {
  return authApiRequest<SuperMindSignalPackage>(
    "/api/integrations/supermind/signal-package",
  );
}

export function fetchPaperAutoExecutionStatus(): Promise<PaperAutoExecutionStatus> {
  return authApiRequest<PaperAutoExecutionStatus>(
    "/api/trading/auto-paper-execution/status",
  );
}

export function runPaperAutoExecutionOnce(): Promise<PaperAutoExecutionRunResponse> {
  return authApiRequest<PaperAutoExecutionRunResponse>(
    "/api/trading/auto-paper-execution/run",
    { method: "POST" },
  );
}

export function fetchRealResearchDataFeed(): Promise<RealResearchDataFeed> {
  return authApiRequest<RealResearchDataFeed>("/api/research/real-data-feed");
}

export function fetchMarketRegimeResearch(
  sectorLimit = 10,
  stockLimit = 8,
  days = 180,
): Promise<MarketRegimeResearchReport> {
  const boundedSectorLimit = Math.min(20, Math.max(1, Math.round(sectorLimit)));
  const boundedStockLimit = Math.min(12, Math.max(1, Math.round(stockLimit)));
  const boundedDays = Math.min(500, Math.max(60, Math.round(days)));
  return authApiRequest<MarketRegimeResearchReport>(
    "/api/research/market-regime" +
      `?sectorLimit=${boundedSectorLimit}` +
      `&stockLimit=${boundedStockLimit}` +
      `&days=${boundedDays}`,
  );
}

export function fetchIpoSubscriptionResearch(
  limit = 40,
): Promise<IpoSubscriptionResearchReport> {
  const boundedLimit = Math.min(80, Math.max(1, Math.round(limit)));
  return authApiRequest<IpoSubscriptionResearchReport>(
    `/api/research/ipo-subscriptions?limit=${boundedLimit}`,
  );
}

export function fetchStockTrendForecast(
  query: string,
  days = 360,
): Promise<StockTrendForecastReport> {
  const boundedDays = Math.min(500, Math.max(120, Math.round(days)));
  const params = new URLSearchParams({
    query: query.trim(),
    days: String(boundedDays),
  });
  return authApiRequest<StockTrendForecastReport>(
    `/api/research/stock-trend?${params.toString()}`,
  );
}

export function fetchTurningPointResearch(
  limit = 12,
  days = 360,
): Promise<TurningPointReport> {
  const boundedLimit = Math.min(12, Math.max(1, Math.round(limit)));
  const boundedDays = Math.min(500, Math.max(180, Math.round(days)));
  return authApiRequest<TurningPointReport>(
    `/api/research/turning-points?limit=${boundedLimit}&days=${boundedDays}`,
  );
}

export function fetchHongKongMarketResearch(
  limit = 10,
  days = 180,
): Promise<HongKongMarketResearchReport> {
  const boundedLimit = Math.min(12, Math.max(1, Math.round(limit)));
  const boundedDays = Math.min(500, Math.max(60, Math.round(days)));
  return authApiRequest<HongKongMarketResearchReport>(
    `/api/research/hong-kong-market?limit=${boundedLimit}&days=${boundedDays}`,
  );
}

export function fetchSelfOptimizationStatus(): Promise<SelfOptimizationStatus> {
  return authApiRequest<SelfOptimizationStatus>("/api/research/self-optimization");
}

export function cancelPaperOrder(orderId: string): Promise<OrderSubmission> {
  return authApiRequest<OrderSubmission>(`/api/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function setPaperTradingPaused(paused: boolean): Promise<AccountResponse> {
  return authApiRequest<AccountResponse>(
    paused ? "/api/trading/pause" : "/api/trading/resume",
    { method: "POST" },
  );
}

export function fetchAuditEvents(limit = 100): Promise<AuditEvent[]> {
  return authApiRequest<AuditEvent[]>(`/api/audit?limit=${limit}`);
}

export function getTradingSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;

  if (typeof configured === "string" && configured.trim()) {
    const explicitUrl = new URL(configured.trim(), window.location.origin);
    return explicitUrl.toString();
  }

  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl) {
    const apiUrl = new URL(apiBaseUrl, window.location.origin);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = "/ws";
    apiUrl.search = "";
    apiUrl.hash = "";
    return apiUrl.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = new URL(`${protocol}//${window.location.host}/ws`);
  return socketUrl.toString();
}
