import type { MarketSnapshot, TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import { isTechnologySector } from "./sectorPulse";

export interface HistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number | null;
  changePercent: number | null;
  turnover: number | null;
}

export interface HistoricalSeries {
  symbol: string;
  name: string;
  source: string;
  adjustment: string;
  bars: HistoricalBar[];
}

export interface HistoricalBarsResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  series: HistoricalSeries[];
  warning: string | null;
}

export interface SectorSnapshot {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  updatedAt: string;
  amount: number | null;
  turnover: number | null;
  advancers: number | null;
  decliners: number | null;
  leaderName: string | null;
  leaderChangePercent: number | null;
  mainNetInflow: number | null;
}

export interface SectorSnapshotResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  sectors: SectorSnapshot[];
  warning: string | null;
}

export interface DirectionalValidation {
  horizon: 3 | 5;
  samples: number;
  directionalHitRate: number | null;
  averageForwardReturn: number | null;
  lastSignalDate: string | null;
  lastOutcomeDate: string | null;
}

export type SectorOutlookDirection = "constructive" | "neutral" | "cautious";

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

export type StockRegime =
  | "washout-candidate"
  | "trend-deterioration"
  | "healthy-trend"
  | "unclear"
  | "insufficient-data";

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
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
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
    version: "1.0.0";
    horizons: [3, 5];
    minimumBars: 60;
    walkForward: true;
    probabilityMeaning: string;
  };
  sectorOutlooks: SectorOutlook[];
  stockRegimes: StockRegimeResult[];
  warnings: string[];
  guardrails: string[];
}

export interface AnalyzeMarketRegimeInput {
  mode: TradingMode;
  provider: string;
  days: number;
  sectorResponse: SectorSnapshotResponse;
  sectorHistory: HistoricalBarsResponse;
  stockHistory: HistoricalBarsResponse;
  stockNames: Map<string, string>;
}

export interface BuildMarketRegimeResearchInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  snapshot: MarketSnapshot;
  preferredStocks?: Array<{
    symbol: string;
    name: string;
  }>;
  sectorLimit: number;
  stockLimit: number;
  days: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface CoreSectorScore {
  score: number;
  return5d: number;
  return20d: number;
  return60d: number;
  ma20Slope5d: number;
  annualizedVolatility20d: number;
  volumeRatio5d: number;
}

type StockFeatures = StockRegimeResult["features"];

const MINIMUM_BARS = 60;
const EMPTY_FEATURES: StockFeatures = {
  return5d: 0,
  return20d: 0,
  return60d: 0,
  pullbackFrom20DayHigh: 0,
  distanceFromMa20: 0,
  distanceFromMa60: 0,
  ma20Slope5d: 0,
  ma60Slope5d: 0,
  volumeRatio: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function trailingAverage(
  bars: HistoricalBar[],
  endIndex: number,
  period: number,
  field: "close" | "volume",
): number {
  const start = endIndex - period + 1;
  if (start < 0) return Number.NaN;
  return average(bars.slice(start, endIndex + 1).map((bar) => bar[field]));
}

function periodReturn(bars: HistoricalBar[], endIndex: number, period: number): number {
  const startIndex = endIndex - period;
  if (startIndex < 0 || bars[startIndex].close <= 0) return 0;
  return bars[endIndex].close / bars[startIndex].close - 1;
}

function dailyReturns(bars: HistoricalBar[], endIndex: number, period: number): number[] {
  const start = Math.max(1, endIndex - period + 1);
  const values: number[] = [];
  for (let index = start; index <= endIndex; index += 1) {
    if (bars[index - 1].close > 0) {
      values.push(bars[index].close / bars[index - 1].close - 1);
    }
  }
  return values;
}

function computeCoreSectorScore(
  bars: HistoricalBar[],
  endIndex: number,
): CoreSectorScore | null {
  if (endIndex < MINIMUM_BARS) return null;

  const return5d = periodReturn(bars, endIndex, 5);
  const return20d = periodReturn(bars, endIndex, 20);
  const return60d = periodReturn(bars, endIndex, 60);
  const ma20 = trailingAverage(bars, endIndex, 20, "close");
  const previousMa20 = trailingAverage(bars, endIndex - 5, 20, "close");
  const ma20Slope5d = previousMa20 > 0 ? ma20 / previousMa20 - 1 : 0;
  const annualizedVolatility20d = standardDeviation(
    dailyReturns(bars, endIndex, 20),
  ) * Math.sqrt(252);
  const recentVolume = trailingAverage(bars, endIndex, 5, "volume");
  const baselineVolume = trailingAverage(bars, endIndex - 5, 20, "volume");
  const volumeRatio5d = baselineVolume > 0 ? recentVolume / baselineVolume : 1;

  const score = clamp(
    50 +
      clamp(return5d * 100, -8, 8) * 1.2 +
      clamp(return20d * 100, -20, 20) * 0.8 +
      clamp(return60d * 100, -35, 35) * 0.35 +
      clamp(ma20Slope5d * 100, -8, 8) * 2.2 -
      Math.max(0, annualizedVolatility20d - 0.35) * 24 -
      Math.max(0, volumeRatio5d - 2) * 4,
    0,
    100,
  );

  return {
    score,
    return5d,
    return20d,
    return60d,
    ma20Slope5d,
    annualizedVolatility20d,
    volumeRatio5d,
  };
}

export function validateDirectionalSignals(
  bars: HistoricalBar[],
  horizon: 3 | 5,
): DirectionalValidation {
  let hits = 0;
  let samples = 0;
  let forwardReturnSum = 0;
  let lastSignalDate: string | null = null;
  let lastOutcomeDate: string | null = null;

  for (
    let index = MINIMUM_BARS;
    index + horizon < bars.length;
    index += 1
  ) {
    const score = computeCoreSectorScore(bars, index);
    if (!score || (score.score > 45 && score.score < 55)) continue;
    const forwardReturn = bars[index + horizon].close / bars[index].close - 1;
    const predictsGrowth = score.score >= 55;
    const hit = predictsGrowth ? forwardReturn > 0 : forwardReturn <= 0;
    samples += 1;
    hits += hit ? 1 : 0;
    forwardReturnSum += forwardReturn;
    lastSignalDate = bars[index].date;
    lastOutcomeDate = bars[index + horizon].date;
  }

  return {
    horizon,
    samples,
    directionalHitRate: samples > 0 ? round(hits / samples) : null,
    averageForwardReturn: samples > 0 ? round(forwardReturnSum / samples) : null,
    lastSignalDate,
    lastOutcomeDate,
  };
}

function sectorEvidence(core: CoreSectorScore, snapshot: SectorSnapshot): {
  evidence: string[];
  riskFlags: string[];
} {
  const evidence: string[] = [];
  const riskFlags: string[] = [];
  if (core.return20d > 0.03) evidence.push("20 日价格动量保持正向。");
  if (core.return60d > 0.06) evidence.push("60 日中期趋势仍向上。");
  if (core.ma20Slope5d > 0) evidence.push("20 日均线近 5 日继续抬升。");
  if ((snapshot.mainNetInflow ?? 0) > 0) evidence.push("当日主力净流入为正。");
  if (
    snapshot.advancers !== null &&
    snapshot.decliners !== null &&
    snapshot.advancers > snapshot.decliners
  ) {
    evidence.push("板块上涨家数多于下跌家数。");
  }
  if (core.annualizedVolatility20d > 0.45) riskFlags.push("20 日波动率偏高，评分不稳定。");
  if (core.return5d > 0.1) riskFlags.push("近 5 日涨幅偏大，短线追高风险上升。");
  if ((snapshot.mainNetInflow ?? 0) < 0) riskFlags.push("当日主力资金为净流出。");
  if (core.ma20Slope5d < 0) riskFlags.push("20 日均线斜率已经转弱。");
  if (evidence.length === 0) evidence.push("当前没有形成足够强的正向共振。");
  return { evidence, riskFlags };
}

export function scoreSectorOutlook(
  snapshot: SectorSnapshot,
  bars: HistoricalBar[],
): Omit<SectorOutlook, "rank"> {
  const endIndex = bars.length - 1;
  const core = computeCoreSectorScore(bars, endIndex);
  if (!core) {
    throw new Error(`Sector ${snapshot.name} requires at least ${MINIMUM_BARS + 1} bars`);
  }

  const breadthTotal = (snapshot.advancers ?? 0) + (snapshot.decliners ?? 0);
  const breadthRatio = breadthTotal > 0 ? (snapshot.advancers ?? 0) / breadthTotal : null;
  const breadthAdjustment = breadthRatio === null ? 0 : (breadthRatio - 0.5) * 18;
  const flow = snapshot.mainNetInflow ?? 0;
  const flowAdjustment =
    flow === 0 ? 0 : Math.sign(flow) * Math.min(6, Math.log10(Math.abs(flow) / 10_000_000 + 1) * 2);
  const score = clamp(
    core.score + breadthAdjustment + flowAdjustment + clamp(snapshot.changePercent, -5, 5),
    0,
    100,
  );
  const horizon3 = validateDirectionalSignals(bars, 3);
  const horizon5 = validateDirectionalSignals(bars, 5);
  const sampleConfidence = Math.min(0.2, horizon5.samples / 500);
  const confidence = clamp(0.45 + sampleConfidence + Math.min(0.2, bars.length / 1_000), 0, 0.9);
  const growthProbability3d = clamp(
    score + clamp(core.return5d * 100, -5, 5) * 1.5,
    5,
    95,
  );
  const growthProbability5d = clamp(
    score + clamp(core.return20d * 100, -10, 10) * 0.6,
    5,
    95,
  );
  const direction: SectorOutlookDirection =
    score >= 60 ? "constructive" : score <= 42 ? "cautious" : "neutral";
  const notes = sectorEvidence(core, snapshot);

  return {
    symbol: snapshot.symbol,
    name: snapshot.name,
    latestDate: bars[endIndex].date,
    barCount: bars.length,
    direction,
    score: round(score, 2),
    confidence: round(confidence, 2),
    growthProbability3d: round(growthProbability3d, 1),
    growthProbability5d: round(growthProbability5d, 1),
    current: {
      changePercent: snapshot.changePercent,
      mainNetInflow: snapshot.mainNetInflow,
      advancers: snapshot.advancers,
      decliners: snapshot.decliners,
      leaderName: snapshot.leaderName,
    },
    factors: {
      return5d: round(core.return5d),
      return20d: round(core.return20d),
      return60d: round(core.return60d),
      ma20Slope5d: round(core.ma20Slope5d),
      annualizedVolatility20d: round(core.annualizedVolatility20d),
      volumeRatio5d: round(core.volumeRatio5d),
      breadthRatio: breadthRatio === null ? null : round(breadthRatio),
    },
    validation: { horizon3, horizon5 },
    ...notes,
  };
}

function computeStockFeatures(bars: HistoricalBar[], endIndex: number): StockFeatures | null {
  if (endIndex < MINIMUM_BARS) return null;
  const close = bars[endIndex].close;
  const ma20 = trailingAverage(bars, endIndex, 20, "close");
  const ma60 = trailingAverage(bars, endIndex, 60, "close");
  const previousMa20 = trailingAverage(bars, endIndex - 5, 20, "close");
  const previousMa60 = trailingAverage(bars, endIndex - 5, 60, "close");
  const priorHigh20 = Math.max(...bars.slice(endIndex - 20, endIndex + 1).map((bar) => bar.high));
  const recentVolume = trailingAverage(bars, endIndex, 5, "volume");
  const baselineVolume = trailingAverage(bars, endIndex - 5, 55, "volume");

  return {
    return5d: periodReturn(bars, endIndex, 5),
    return20d: periodReturn(bars, endIndex, 20),
    return60d: periodReturn(bars, endIndex, 60),
    pullbackFrom20DayHigh: priorHigh20 > 0 ? 1 - close / priorHigh20 : 0,
    distanceFromMa20: ma20 > 0 ? close / ma20 - 1 : 0,
    distanceFromMa60: ma60 > 0 ? close / ma60 - 1 : 0,
    ma20Slope5d: previousMa20 > 0 ? ma20 / previousMa20 - 1 : 0,
    ma60Slope5d: previousMa60 > 0 ? ma60 / previousMa60 - 1 : 0,
    volumeRatio: baselineVolume > 0 ? recentVolume / baselineVolume : 1,
  };
}

function regimeFromFeatures(
  features: StockFeatures,
  bars: HistoricalBar[],
  endIndex: number,
): { regime: StockRegime; confidence: number; evidence: string[]; riskFlags: string[] } {
  const close = bars[endIndex].close;
  const previousClose = bars[endIndex - 1].close;
  const reboundConfirmed = close > previousClose && features.return5d > -0.05;
  const washoutConditions = [
    features.return60d > 0.04,
    features.ma60Slope5d > 0,
    features.pullbackFrom20DayHigh >= 0.02 && features.pullbackFrom20DayHigh <= 0.12,
    features.distanceFromMa60 >= -0.03,
    features.volumeRatio <= 0.8,
    reboundConfirmed,
  ];
  const deteriorationConditions = [
    features.distanceFromMa20 < -0.015,
    features.distanceFromMa60 < 0,
    features.ma20Slope5d < 0,
    features.return20d < -0.05,
    features.volumeRatio > 1.2,
  ];

  if (washoutConditions.every(Boolean)) {
    return {
      regime: "washout-candidate",
      confidence: 0.72,
      evidence: [
        "60 日趋势和长期均线斜率仍为正。",
        "回撤深度处于受控区间，价格未有效跌破 60 日均线。",
        "回撤阶段成交量明显收缩，最新一根价格出现企稳。",
      ],
      riskFlags: [
        "洗盘只能作为候选解释，需要后续放量转强确认，不能预先认定必然拉升。",
      ],
    };
  }

  if (deteriorationConditions.filter(Boolean).length >= 4) {
    return {
      regime: "trend-deterioration",
      confidence: 0.8,
      evidence: [
        "价格同时位于 20 日和 60 日均线下方。",
        "20 日收益与均线斜率转负，趋势结构变差。",
        features.volumeRatio > 1.2
          ? "下跌阶段成交量放大，弱势并非单纯缩量回撤。"
          : "下跌量能尚未明显收缩。",
      ],
      riskFlags: ["趋势修复前不应把下跌自动解释为洗盘。"],
    };
  }

  if (
    features.distanceFromMa20 > 0 &&
    features.distanceFromMa60 > 0 &&
    features.ma20Slope5d > 0 &&
    features.ma60Slope5d > 0
  ) {
    return {
      regime: "healthy-trend",
      confidence: 0.68,
      evidence: ["价格位于 20 日和 60 日均线上方，且两条均线保持抬升。"],
      riskFlags:
        features.return5d > 0.1 ? ["近 5 日涨幅偏大，短线追高风险上升。"] : [],
    };
  }

  return {
    regime: "unclear",
    confidence: 0.4,
    evidence: ["趋势、量能与回撤特征尚未形成一致信号。"],
    riskFlags: ["等待更多日线和确认信号，不将模糊形态强行归类。"],
  };
}

function validateStockRegime(
  bars: HistoricalBar[],
  targetRegime: StockRegime,
): StockRegimeResult["validation"] {
  if (targetRegime === "insufficient-data" || targetRegime === "unclear") {
    return { samples: 0, hitRate5d: null, averageForwardReturn5d: null };
  }
  let samples = 0;
  let hits = 0;
  let returns = 0;
  for (let index = MINIMUM_BARS; index + 5 < bars.length; index += 1) {
    const features = computeStockFeatures(bars, index);
    if (!features) continue;
    const regime = regimeFromFeatures(features, bars, index).regime;
    if (regime !== targetRegime) continue;
    const forwardReturn = bars[index + 5].close / bars[index].close - 1;
    const hit =
      targetRegime === "trend-deterioration" ? forwardReturn <= 0 : forwardReturn > 0;
    samples += 1;
    hits += hit ? 1 : 0;
    returns += forwardReturn;
  }
  return {
    samples,
    hitRate5d: samples > 0 ? round(hits / samples) : null,
    averageForwardReturn5d: samples > 0 ? round(returns / samples) : null,
  };
}

export function classifyStockRegime(
  symbol: string,
  name: string,
  bars: HistoricalBar[],
): Omit<StockRegimeResult, "rank"> {
  const endIndex = bars.length - 1;
  const features = computeStockFeatures(bars, endIndex);
  if (!features) {
    return {
      symbol,
      name,
      latestDate: bars.at(-1)?.date ?? null,
      barCount: bars.length,
      regime: "insufficient-data",
      confidence: 0,
      features: EMPTY_FEATURES,
      validation: { samples: 0, hitRate5d: null, averageForwardReturn5d: null },
      evidence: [],
      riskFlags: [`至少需要 ${MINIMUM_BARS + 1} 根日线才能判断形态。`],
    };
  }

  const classification = regimeFromFeatures(features, bars, endIndex);
  return {
    symbol,
    name,
    latestDate: bars[endIndex].date,
    barCount: bars.length,
    regime: classification.regime,
    confidence: classification.confidence,
    features: Object.fromEntries(
      Object.entries(features).map(([key, value]) => [key, round(value)]),
    ) as unknown as StockFeatures,
    validation: validateStockRegime(bars, classification.regime),
    evidence: classification.evidence,
    riskFlags: classification.riskFlags,
  };
}

function warningList(...warnings: Array<string | null | undefined>): string[] {
  return [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];
}

export function analyzeMarketRegimeData(
  input: AnalyzeMarketRegimeInput,
): MarketRegimeResearchReport {
  const historyByName = new Map(
    input.sectorHistory.series.map((series) => [series.name || series.symbol, series]),
  );
  for (const series of input.sectorHistory.series) {
    historyByName.set(series.symbol, series);
  }
  const sectorOutlooks = input.sectorResponse.sectors
    .flatMap((sector) => {
      const series = historyByName.get(sector.name) ?? historyByName.get(sector.symbol);
      if (!series || series.bars.length <= MINIMUM_BARS) return [];
      return [scoreSectorOutlook(sector, series.bars)];
    })
    .sort((a, b) => b.growthProbability5d - a.growthProbability5d)
    .map((sector, index) => ({ rank: index + 1, ...sector }));

  const regimePriority: Record<StockRegime, number> = {
    "washout-candidate": 5,
    "trend-deterioration": 4,
    "healthy-trend": 3,
    unclear: 2,
    "insufficient-data": 1,
  };
  const stockRegimes = input.stockHistory.series
    .map((series) =>
      classifyStockRegime(
        series.symbol,
        input.stockNames.get(series.symbol) ?? series.name ?? series.symbol,
        series.bars,
      ),
    )
    .sort((a, b) => {
      const priority = regimePriority[b.regime] - regimePriority[a.regime];
      return priority || b.confidence - a.confidence;
    })
    .map((stock, index) => ({ rank: index + 1, ...stock }));

  const warnings = warningList(
    input.sectorResponse.warning,
    input.sectorHistory.warning,
    input.stockHistory.warning,
  );
  if (sectorOutlooks.length === 0) warnings.push("没有板块具备至少 61 根有效日线。");
  if (stockRegimes.length === 0) warnings.push("没有取得候选股票历史日线。");
  const sourceStatus =
    warnings.length === 0 && sectorOutlooks.length > 0 && stockRegimes.length > 0
      ? "live-read-only"
      : "degraded";

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.provider,
    sourceStatus,
    source: {
      sectorSource: input.sectorResponse.source,
      sectorHistorySource: input.sectorHistory.source,
      stockHistorySource: input.stockHistory.source,
      fetchedAt:
        input.stockHistory.fetchedAt ||
        input.sectorHistory.fetchedAt ||
        input.sectorResponse.fetchedAt ||
        null,
      days: input.days,
      sectorAdjustment: "none",
      stockAdjustment: "qfq",
      sectorCount: sectorOutlooks.length,
      stockCount: stockRegimes.length,
    },
    methodology: {
      version: "1.0.0",
      horizons: [3, 5],
      minimumBars: MINIMUM_BARS,
      walkForward: true,
      probabilityMeaning:
        "增长概率是 0-100 的启发式研究评分，不是经过校准的真实概率；必须结合滚动历史命中率和样本数阅读。",
    },
    sectorOutlooks,
    stockRegimes,
    warnings,
    guardrails: [
      "板块和个股历史数据来自 AkShare 只读公开数据源，来源不可用时明确降级，不使用静态数据替代。",
      "所有滚动验证只使用评分时点及之前的数据，再与之后 3/5 个交易日结果比较，禁止未来数据泄漏。",
      "洗盘只能识别为候选解释；没有后续确认前，不能断言一定拉升。",
      "该模块只用于研究与本地 paper 观察，不连接真实券商，不构成投资建议。",
    ],
  };
}

function emptyBridgeResponses(): {
  sectorResponse: SectorSnapshotResponse;
  history: HistoricalBarsResponse;
} {
  return {
    sectorResponse: {
      provider: "none",
      source: "mock-disabled",
      fetchedAt: "",
      sectors: [],
      warning: null,
    },
    history: {
      provider: "none",
      source: "mock-disabled",
      fetchedAt: "",
      series: [],
      warning: null,
    },
  };
}

function unavailableReport(input: BuildMarketRegimeResearchInput): MarketRegimeResearchReport {
  const empty = emptyBridgeResponses();
  const report = analyzeMarketRegimeData({
    mode: input.mode,
    provider: input.marketDataProvider,
    days: input.days,
    sectorResponse: empty.sectorResponse,
    sectorHistory: empty.history,
    stockHistory: empty.history,
    stockNames: new Map(),
  });
  return {
    ...report,
    sourceStatus: "mock-disabled",
    warnings: ["当前未启用 AkShare，真实板块和历史 K 线研究不可用。"],
    guardrails: [
      "真实源未启用时不会使用静态板块数据替代。",
      ...report.guardrails,
    ],
  };
}

export function selectSectorUniverse(
  sectors: SectorSnapshot[],
  limit: number,
): SectorSnapshot[] {
  const boundedLimit = Math.max(1, Math.min(limit, sectors.length));
  if (sectors.length <= boundedLimit) return sectors.slice();
  if (boundedLimit === 1) return [sectors[0]];
  const selected = Array.from({ length: boundedLimit }, (_, index) => {
    const sourceIndex = Math.round(index * (sectors.length - 1) / (boundedLimit - 1));
    return sectors[sourceIndex];
  });
  if (boundedLimit < 3) return selected;

  const key = (sector: SectorSnapshot) => `${sector.symbol}\u0000${sector.name}`;
  const selectedKeys = new Set(selected.map(key));
  const technologyLimit = Math.max(1, Math.floor(boundedLimit / 3));
  const technologySectors = sectors
    .filter((sector) => isTechnologySector(sector.name))
    .slice(0, technologyLimit);
  const replaceableIndexes = Array.from(
    { length: boundedLimit - 2 },
    (_, index) => boundedLimit - 2 - index,
  );

  for (const sector of technologySectors) {
    if (selectedKeys.has(key(sector))) continue;
    const replaceIndex = replaceableIndexes.shift();
    if (replaceIndex === undefined) break;
    selectedKeys.delete(key(selected[replaceIndex]));
    selected[replaceIndex] = sector;
    selectedKeys.add(key(sector));
  }

  const sourceIndexByKey = new Map(sectors.map((sector, index) => [key(sector), index]));
  return selected.sort(
    (left, right) =>
      (sourceIndexByKey.get(key(left)) ?? 0) - (sourceIndexByKey.get(key(right)) ?? 0),
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function failedHistory(source: string, warning: string): HistoricalBarsResponse {
  return {
    provider: "akshare",
    source,
    fetchedAt: "",
    series: [],
    warning,
  };
}

export async function buildMarketRegimeResearch(
  input: BuildMarketRegimeResearchInput,
): Promise<MarketRegimeResearchReport> {
  if (input.marketDataProvider !== "akshare") return unavailableReport(input);

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  let sectorResponse: SectorSnapshotResponse;
  try {
    sectorResponse = await fetchBridgeJson<SectorSnapshotResponse>({
      url: `${baseUrl}/api/market/sectors?limit=80`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs,
      fetchImpl,
    });
  } catch (error) {
    sectorResponse = {
      provider: "akshare",
      source: "unavailable",
      fetchedAt: "",
      sectors: [],
      warning: `行业板块快照暂不可用: ${bridgeErrorMessage(error)}`,
    };
  }

  const sectorNames = selectSectorUniverse(sectorResponse.sectors, input.sectorLimit)
    .map((sector) => sector.name);
  const stockLimit = Math.max(1, Math.min(input.stockLimit, 12));
  const preferredStocks = (input.preferredStocks ?? [])
    .filter((stock) => /^\d{6}$/.test(stock.symbol))
    .map((stock) => ({ symbol: stock.symbol, name: stock.name }));
  const stockQuotes = [...input.snapshot.quotes]
    .filter((quote) => quote.tradable && /^\d{6}$/.test(quote.symbol) && quote.price > 0)
    .sort((a, b) => (b.amount ?? b.price * b.volume) - (a.amount ?? a.price * a.volume))
    .map((quote) => ({ symbol: quote.symbol, name: quote.name }));
  const stockUniverse = [...preferredStocks, ...stockQuotes]
    .filter((stock, index, items) =>
      items.findIndex((candidate) => candidate.symbol === stock.symbol) === index,
    )
    .slice(0, stockLimit);
  const stockSymbols = stockUniverse.map((stock) => stock.symbol);
  const stockNames = new Map(stockUniverse.map((stock) => [stock.symbol, stock.name]));

  const sectorUrl = new URL(`${baseUrl}/api/market/sector-history`);
  sectorUrl.searchParams.set("sectors", sectorNames.join(","));
  sectorUrl.searchParams.set("days", String(input.days));
  const stockUrl = new URL(`${baseUrl}/api/market/stock-history`);
  stockUrl.searchParams.set("symbols", stockSymbols.join(","));
  stockUrl.searchParams.set("days", String(input.days));

  const [sectorHistoryResult, stockHistoryResult] = await Promise.allSettled([
    sectorNames.length > 0
      ? fetchBridgeJson<HistoricalBarsResponse>({
          url: sectorUrl.toString(),
          token: input.bridgeToken,
          timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
          fetchImpl,
        })
      : Promise.resolve(failedHistory("unavailable", "没有可查询的行业板块。")),
    stockSymbols.length > 0
      ? fetchBridgeJson<HistoricalBarsResponse>({
          url: stockUrl.toString(),
          token: input.bridgeToken,
          timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
          fetchImpl,
        })
      : Promise.resolve(failedHistory("unavailable", "当前快照没有可查询股票。")),
  ]);

  const sectorHistory =
    sectorHistoryResult.status === "fulfilled"
      ? sectorHistoryResult.value
      : failedHistory(
          "eastmoney-industry-history",
          `行业历史日线暂不可用: ${bridgeErrorMessage(sectorHistoryResult.reason)}`,
        );
  const stockHistory =
    stockHistoryResult.status === "fulfilled"
      ? stockHistoryResult.value
      : failedHistory(
          "eastmoney-stock-history",
          `股票历史日线暂不可用: ${bridgeErrorMessage(stockHistoryResult.reason)}`,
        );

  return analyzeMarketRegimeData({
    mode: input.mode,
    provider: input.marketDataProvider,
    days: input.days,
    sectorResponse,
    sectorHistory,
    stockHistory,
    stockNames,
  });
}
