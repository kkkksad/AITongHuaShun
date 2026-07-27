import type { TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";
import { historyBridgeTimeoutMs } from "./historyRequestPolicy";
import type {
  HistoricalBarsResponse,
  HistoricalSeries,
} from "./marketRegimeResearch";

export type ExternalSignalTone =
  | "positive"
  | "neutral"
  | "negative"
  | "unavailable";
export type ExternalImpactBias =
  | "supportive"
  | "neutral"
  | "restrictive"
  | "conflicted";
export type ExternalEvidenceGrade =
  | "snapshot-only"
  | "historically-observed"
  | "walk-forward-validated";

export interface ExternalMarketItem {
  symbol: string;
  name: string;
  region: string;
  price: number;
  changePercent: number;
  updatedAt: string;
  source: string;
  sessionDate: string | null;
  timezone: string;
  quoteKind: "snapshot" | "daily-close";
}

export interface ExternalCryptoItem {
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPercent: number;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  updatedAt: string;
  source: string;
}

export interface ExternalMarketGroup {
  key: "us-overnight" | "asia" | "crypto";
  tone: ExternalSignalTone;
  coverage: number;
  averageChangePercent: number | null;
  asOf: string | null;
  symbols: string[];
}

export interface ExternalImpactValidation {
  benchmark: "SH000300";
  samples: number;
  windows: number;
  directionalHitRate: number | null;
  averageNextDayReturn: number | null;
  unconditionalAverageReturn: number | null;
  incrementalReturn: number | null;
}

export interface AshareExternalImpact {
  bias: ExternalImpactBias;
  confidence: number;
  evidenceGrade: ExternalEvidenceGrade;
  allowPositionIncrease: false;
  rationale: string[];
}

export interface ExternalMarketImpactReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  influenceMode: "observation-only" | "shadow-validated";
  source: {
    globalSnapshotSources: string[];
    globalHistorySource: string;
    benchmarkHistorySource: string;
    cryptoSource: string;
    fetchedAt: string | null;
    requestedDays: number;
    globalSnapshotCount: number;
    globalHistoryCount: number;
    cryptoCount: number;
  };
  groups: ExternalMarketGroup[];
  markets: ExternalMarketItem[];
  crypto: ExternalCryptoItem[];
  aShareImpact: AshareExternalImpact;
  validation: ExternalImpactValidation;
  warnings: string[];
  guardrails: string[];
}

export interface BuildExternalMarketImpactInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  days: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface BridgeGlobalResponse {
  provider: string;
  fetchedAt: string;
  markets: ExternalMarketItem[];
  warning?: string | null;
}

interface BridgeCryptoResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  items: ExternalCryptoItem[];
  warning?: string | null;
}

interface ReturnPoint {
  date: string;
  value: number;
}

const US_SYMBOLS = new Set(["DJI", "SPX", "IXIC"]);
const ASIA_SYMBOLS = new Set(["HSI", "N225", "KOSPI"]);
const GLOBAL_HISTORY_SYMBOLS = ["DJI", "SPX", "IXIC", "HSI", "N225", "KOSPI"];
const GROUP_THRESHOLDS = {
  "us-overnight": 0.45,
  asia: 0.5,
  crypto: 1.5,
} as const;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toneForChange(
  value: number | null,
  thresholdPercent: number,
): ExternalSignalTone {
  if (value === null) return "unavailable";
  if (value > thresholdPercent) return "positive";
  if (value < -thresholdPercent) return "negative";
  return "neutral";
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const available = values.filter((value): value is string => Boolean(value));
  return available.sort().at(-1) ?? null;
}

function returnsFromSeries(series: HistoricalSeries): ReturnPoint[] {
  const bars = [...series.bars].sort((left, right) => left.date.localeCompare(right.date));
  const points: ReturnPoint[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1].close;
    const current = bars[index].close;
    if (previous <= 0 || current <= 0) continue;
    points.push({ date: bars[index].date, value: current / previous - 1 });
  }
  return points;
}

export function latestReturnBefore(
  points: ReturnPoint[],
  targetDate: string,
): number | null {
  let latest: ReturnPoint | null = null;
  for (const point of points) {
    if (point.date >= targetDate) break;
    latest = point;
  }
  return latest?.value ?? null;
}

function historicalTone(values: number[], threshold: number): ExternalSignalTone {
  const value = average(values);
  return toneForChange(value === null ? null : value * 100, threshold * 100);
}

function directionalSignal(
  usTone: ExternalSignalTone,
  asiaTone: ExternalSignalTone,
): -1 | 0 | 1 {
  if (usTone === "positive" && asiaTone !== "negative") return 1;
  if (usTone === "negative" && asiaTone !== "positive") return -1;
  return 0;
}

export function buildExternalValidation(
  globalSeries: HistoricalSeries[],
  benchmarkSeries: HistoricalSeries | null,
): ExternalImpactValidation {
  const empty: ExternalImpactValidation = {
    benchmark: "SH000300",
    samples: 0,
    windows: 0,
    directionalHitRate: null,
    averageNextDayReturn: null,
    unconditionalAverageReturn: null,
    incrementalReturn: null,
  };
  if (!benchmarkSeries || benchmarkSeries.bars.length < 2) return empty;

  const returnsBySymbol = new Map(
    globalSeries.map((series) => [series.symbol, returnsFromSeries(series)]),
  );
  const benchmarkBars = [...benchmarkSeries.bars]
    .sort((left, right) => left.date.localeCompare(right.date));
  const unconditionalReturns: number[] = [];
  const signedReturns: number[] = [];
  let hits = 0;

  for (let index = 1; index < benchmarkBars.length; index += 1) {
    const previous = benchmarkBars[index - 1].close;
    const current = benchmarkBars[index].close;
    if (previous <= 0 || current <= 0) continue;
    const targetReturn = current / previous - 1;
    unconditionalReturns.push(targetReturn);
    const targetDate = benchmarkBars[index].date;
    const usValues = GLOBAL_HISTORY_SYMBOLS
      .filter((symbol) => US_SYMBOLS.has(symbol))
      .map((symbol) => latestReturnBefore(returnsBySymbol.get(symbol) ?? [], targetDate))
      .filter((value): value is number => value !== null);
    const asiaValues = GLOBAL_HISTORY_SYMBOLS
      .filter((symbol) => ASIA_SYMBOLS.has(symbol))
      .map((symbol) => latestReturnBefore(returnsBySymbol.get(symbol) ?? [], targetDate))
      .filter((value): value is number => value !== null);
    if (usValues.length < 2 || asiaValues.length < 2) continue;

    const signal = directionalSignal(
      historicalTone(usValues, GROUP_THRESHOLDS["us-overnight"] / 100),
      historicalTone(asiaValues, GROUP_THRESHOLDS.asia / 100),
    );
    if (signal === 0) continue;
    const signedReturn = signal * targetReturn;
    signedReturns.push(signedReturn);
    if (signedReturn > 0) hits += 1;
  }

  const samples = signedReturns.length;
  const windows = samples >= 60 ? 3 : Math.floor(samples / 20);
  if (samples < 60) return { ...empty, samples, windows };
  const averageSignedReturn = average(signedReturns) ?? 0;
  const unconditionalAverage = average(unconditionalReturns) ?? 0;
  return {
    benchmark: "SH000300",
    samples,
    windows,
    directionalHitRate: round(hits / samples, 4),
    averageNextDayReturn: round(averageSignedReturn),
    unconditionalAverageReturn: round(unconditionalAverage),
    incrementalReturn: round(averageSignedReturn - Math.abs(unconditionalAverage)),
  };
}

export function deriveAshareImpact(input: {
  usTone: ExternalSignalTone;
  asiaTone: ExternalSignalTone;
  cryptoTone: ExternalSignalTone;
  validation: ExternalImpactValidation;
  coreCoverage: number;
}): AshareExternalImpact {
  let bias: ExternalImpactBias = "neutral";
  if (
    (input.usTone === "positive" && input.asiaTone === "negative") ||
    (input.usTone === "negative" && input.asiaTone === "positive")
  ) {
    bias = "conflicted";
  } else if (input.usTone === "positive" && input.asiaTone !== "negative") {
    bias = "supportive";
  } else if (input.usTone === "negative" && input.asiaTone !== "positive") {
    bias = "restrictive";
  }

  const evidenceGrade: ExternalEvidenceGrade = input.validation.samples >= 250 &&
      input.validation.windows >= 3 &&
      (input.validation.directionalHitRate ?? 0) >= 0.53
    ? "walk-forward-validated"
    : input.validation.samples >= 60
      ? "historically-observed"
      : "snapshot-only";
  const sampleScore = evidenceGrade === "walk-forward-validated"
    ? 30
    : evidenceGrade === "historically-observed"
      ? 18
      : 0;
  const confidence = Math.min(
    90,
    Math.max(0, Math.round(input.coreCoverage * 60 + sampleScore)),
  );
  const rationale = [
    `美股隔夜信号为 ${input.usTone}，亚洲市场信号为 ${input.asiaTone}。`,
    input.cryptoTone === "unavailable"
      ? "BTC/ETH 当前不可用，不用静态价格补位。"
      : `BTC/ETH 风险偏好为 ${input.cryptoTone}，只能补充证据，不能单独改变 A 股方向。`,
    input.validation.samples >= 60
      ? `严格时间对齐历史样本 ${input.validation.samples} 个，方向命中率 ${((input.validation.directionalHitRate ?? 0) * 100).toFixed(1)}%。`
      : `严格时间对齐历史样本仅 ${input.validation.samples} 个，暂不展示预测概率。`,
  ];
  return {
    bias,
    confidence,
    evidenceGrade,
    allowPositionIncrease: false,
    rationale,
  };
}

function summarizeMarketGroup(
  key: "us-overnight" | "asia",
  markets: ExternalMarketItem[],
  symbols: Set<string>,
): ExternalMarketGroup {
  const items = markets.filter((item) => symbols.has(item.symbol));
  const averageChange = average(items.map((item) => item.changePercent));
  return {
    key,
    tone: toneForChange(averageChange, GROUP_THRESHOLDS[key]),
    coverage: items.length,
    averageChangePercent: averageChange === null ? null : round(averageChange, 4),
    asOf: latestTimestamp(items.map((item) => item.updatedAt)),
    symbols: items.map((item) => item.symbol),
  };
}

function summarizeCryptoGroup(items: ExternalCryptoItem[]): ExternalMarketGroup {
  const averageChange = average(items.map((item) => item.change24hPercent));
  return {
    key: "crypto",
    tone: toneForChange(averageChange, GROUP_THRESHOLDS.crypto),
    coverage: items.length,
    averageChangePercent: averageChange === null ? null : round(averageChange, 4),
    asOf: latestTimestamp(items.map((item) => item.updatedAt)),
    symbols: items.map((item) => item.symbol),
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function emptyValidation(): ExternalImpactValidation {
  return {
    benchmark: "SH000300",
    samples: 0,
    windows: 0,
    directionalHitRate: null,
    averageNextDayReturn: null,
    unconditionalAverageReturn: null,
    incrementalReturn: null,
  };
}

function baseReport(input: BuildExternalMarketImpactInput): ExternalMarketImpactReport {
  const validation = emptyValidation();
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    provider: input.marketDataProvider,
    sourceStatus: "degraded",
    influenceMode: "observation-only",
    source: {
      globalSnapshotSources: [],
      globalHistorySource: "unavailable",
      benchmarkHistorySource: "unavailable",
      cryptoSource: "unavailable",
      fetchedAt: null,
      requestedDays: input.days,
      globalSnapshotCount: 0,
      globalHistoryCount: 0,
      cryptoCount: 0,
    },
    groups: [
      { key: "us-overnight", tone: "unavailable", coverage: 0, averageChangePercent: null, asOf: null, symbols: [] },
      { key: "asia", tone: "unavailable", coverage: 0, averageChangePercent: null, asOf: null, symbols: [] },
      { key: "crypto", tone: "unavailable", coverage: 0, averageChangePercent: null, asOf: null, symbols: [] },
    ],
    markets: [],
    crypto: [],
    aShareImpact: deriveAshareImpact({
      usTone: "unavailable",
      asiaTone: "unavailable",
      cryptoTone: "unavailable",
      validation,
      coreCoverage: 0,
    }),
    validation,
    warnings: [],
    guardrails: [
      "A 股仍是唯一自动 paper 研究与执行市场，外盘只提供只读上下文。",
      "外盘快照和历史条件频率不是校准后的 A 股涨跌概率。",
      "同日尚未完成的亚洲收盘数据不能回填盘前判断。",
      "第一版外盘信号不能提高 A 股仓位，也不会直接生成订单。",
    ],
  };
}

export async function buildExternalMarketImpact(
  input: BuildExternalMarketImpactInput,
): Promise<ExternalMarketImpactReport> {
  const days = Math.min(500, Math.max(60, Math.round(input.days)));
  const normalized = { ...input, days };
  const base = baseReport(normalized);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，不会使用静态外盘或数字资产价格替代真实来源。"],
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = trimTrailingSlash(input.bridgeUrl);
  const globalHistoryUrl = new URL(`${baseUrl}/api/market/global/history`);
  globalHistoryUrl.searchParams.set("symbols", GLOBAL_HISTORY_SYMBOLS.join(","));
  globalHistoryUrl.searchParams.set("days", String(days));
  const benchmarkUrl = new URL(`${baseUrl}/api/market/index-history`);
  benchmarkUrl.searchParams.set("symbols", "SH000300");
  benchmarkUrl.searchParams.set("days", String(days));
  const requests = await Promise.allSettled([
    fetchBridgeJson<BridgeGlobalResponse>({
      url: `${baseUrl}/api/market/global?limit=10`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs * 4,
      fetchImpl,
    }),
    fetchBridgeJson<HistoricalBarsResponse>({
      url: globalHistoryUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
      fetchImpl,
    }),
    fetchBridgeJson<HistoricalBarsResponse>({
      url: benchmarkUrl.toString(),
      token: input.bridgeToken,
      timeoutMs: historyBridgeTimeoutMs(input.timeoutMs),
      fetchImpl,
    }),
    fetchBridgeJson<BridgeCryptoResponse>({
      url: `${baseUrl}/api/market/crypto/quotes`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs * 4,
      fetchImpl,
    }),
  ]);
  const [globalResult, globalHistoryResult, benchmarkResult, cryptoResult] = requests;
  const warnings: string[] = [];
  const globalResponse = globalResult.status === "fulfilled" ? globalResult.value : null;
  const globalHistory = globalHistoryResult.status === "fulfilled"
    ? globalHistoryResult.value
    : null;
  const benchmarkHistory = benchmarkResult.status === "fulfilled"
    ? benchmarkResult.value
    : null;
  const cryptoResponse = cryptoResult.status === "fulfilled" ? cryptoResult.value : null;
  const labels = ["全球指数快照", "全球指数历史", "A 股指数历史", "BTC/ETH 快照"];
  requests.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${labels[index]}暂不可用: ${bridgeErrorMessage(result.reason)}`);
    }
  });
  if (globalResponse?.warning) warnings.push(globalResponse.warning);
  if (globalHistory?.warning) warnings.push(globalHistory.warning);
  if (benchmarkHistory?.warning) warnings.push(benchmarkHistory.warning);
  if (cryptoResponse?.warning) warnings.push(cryptoResponse.warning);

  const markets = globalResponse?.markets ?? [];
  const crypto = cryptoResponse?.items ?? [];
  const usGroup = summarizeMarketGroup("us-overnight", markets, US_SYMBOLS);
  const asiaGroup = summarizeMarketGroup("asia", markets, ASIA_SYMBOLS);
  const cryptoGroup = summarizeCryptoGroup(crypto);
  const benchmarkSeries = benchmarkHistory?.series
    .find((series) => series.symbol === "SH000300") ?? null;
  const validation = buildExternalValidation(
    globalHistory?.series ?? [],
    benchmarkSeries,
  );
  const historyCoverage = Math.min(1, (globalHistory?.series.length ?? 0) / 6);
  const coreCoverage = (
    Math.min(1, usGroup.coverage / 3) +
    Math.min(1, asiaGroup.coverage / 3) +
    historyCoverage +
    (benchmarkSeries ? 1 : 0)
  ) / 4;
  const aShareImpact = deriveAshareImpact({
    usTone: usGroup.tone,
    asiaTone: asiaGroup.tone,
    cryptoTone: cryptoGroup.tone,
    validation,
    coreCoverage,
  });
  const coreComplete = usGroup.coverage >= 2 &&
    asiaGroup.coverage >= 2 &&
    (globalHistory?.series.length ?? 0) >= 4 &&
    benchmarkSeries !== null;
  const snapshotSources = [...new Set(markets.map((item) => item.source))];

  return {
    ...base,
    sourceStatus: coreComplete ? "live-read-only" : "degraded",
    influenceMode: aShareImpact.evidenceGrade === "walk-forward-validated"
      ? "shadow-validated"
      : "observation-only",
    source: {
      globalSnapshotSources: snapshotSources,
      globalHistorySource: globalHistory?.source ?? "unavailable",
      benchmarkHistorySource: benchmarkHistory?.source ?? "unavailable",
      cryptoSource: cryptoResponse?.source ?? "unavailable",
      fetchedAt: latestTimestamp([
        globalResponse?.fetchedAt,
        globalHistory?.fetchedAt,
        benchmarkHistory?.fetchedAt,
        cryptoResponse?.fetchedAt,
      ]),
      requestedDays: days,
      globalSnapshotCount: markets.length,
      globalHistoryCount: globalHistory?.series.length ?? 0,
      cryptoCount: crypto.length,
    },
    groups: [usGroup, asiaGroup, cryptoGroup],
    markets,
    crypto,
    aShareImpact,
    validation,
    warnings,
  };
}
