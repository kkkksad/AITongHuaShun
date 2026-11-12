import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { executionCosts, type ExecutionCostOptions } from "../server/broker/executionCosts";
import { classifyStockRegime, type HistoricalBar, type HistoricalBarsResponse, type HistoricalSeries,
  type MarketRegimeResearchReport, type StockRegimeResult } from "../server/research/marketRegimeResearch";
import { routeAdaptiveStrategies, type AdaptiveMarketRegime } from "../server/research/adaptiveStrategyRouter";
import { rankAdaptiveCandidateStrategies } from "../server/research/adaptiveCandidateStrategy";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";
import { buildHistoricalCorrelations } from "../server/research/historicalCorrelation";
import { PAPER_EXECUTION_STRATEGY_OPTIONS, type MarketQuote, type MarketSnapshot } from "../shared/trading";

const COSTS = [
  { label: "base", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 },
  { label: "stress", commissionRate: 0.0006, minimumCommission: 10, slippageBps: 15 },
] as const;

/** Observe t after its close, but classify stock setup using only completed bars before t. */
export function observeAdaptivePrefix(symbol: string, name: string, bars: HistoricalBar[], index: number) {
  if (!Number.isInteger(index) || index < 1 || index >= bars.length) throw Error("Invalid observation index");
  const bar = bars[index], previous = bars[index - 1];
  const stock: StockRegimeResult = { rank: 1, ...classifyStockRegime(symbol, name, bars.slice(0, index)) };
  const quote: MarketQuote = {
    symbol, name, price: bar.close, previousClose: previous.close,
    tradable: bar.volume > 0, volume: bar.volume, amount: bar.amount ?? undefined,
    turnover: bar.turnover ?? undefined, open: bar.open, high: bar.high, low: bar.low,
    amplitude: (bar.high - bar.low) / previous.close * 100,
    changePercent: (bar.close / previous.close - 1) * 100,
    updatedAt: `${bar.date}T15:00:00+08:00`,
  };
  return { stock, quote };
}

type Observation = { state: "unknown"; reason: "tail" | "zero-volume" | "lot-over-5000" } | {
  state: "observed"; entryDate: string; exitDate: string; buyPrice: number; sellPrice: number;
  cashRequired: number; fees: number; netPnl: number; netReturn: number;
};

/** Fixed one-lot forward observation, not a portfolio simulator or an independent trade. */
export function evaluateFiveDayObservation(bars: HistoricalBar[], index: number, cost: ExecutionCostOptions): Observation {
  const entry = bars[index + 1], exit = bars[index + 5];
  if (!entry || !exit) return { state: "unknown", reason: "tail" };
  if (entry.volume <= 0 || exit.volume <= 0) return { state: "unknown", reason: "zero-volume" };
  const buy = executionCosts({ symbol: "offline", side: "buy", type: "market", quantity: 100 }, entry.open, cost);
  const sell = executionCosts({ symbol: "offline", side: "sell", type: "market", quantity: 100 }, exit.close, cost);
  if (buy.cashDebit > 5_000) return { state: "unknown", reason: "lot-over-5000" };
  const netPnl = Number((sell.notional - sell.commission - buy.cashDebit).toFixed(2));
  return { state: "observed", entryDate: entry.date, exitDate: exit.date, buyPrice: buy.fillPrice,
    sellPrice: sell.fillPrice, cashRequired: buy.cashDebit,
    fees: buy.commission + sell.commission, netPnl, netReturn: netPnl / buy.cashDebit };
}

/** Hypothetical routing inputs exercise actual production routing; no claim about historical sectors. */
function scenarioRouting(regime: AdaptiveMarketRegime, stock: StockRegimeResult) {
  const up = regime.startsWith("trend-up"), risk = regime.startsWith("risk-off");
  const recovery = regime === "risk-off-recovery";
  const report: MarketRegimeResearchReport = {
    generatedAt: "2000-01-01T00:00:00Z", mode: "paper", provider: "offline-controlled-scenario",
    sourceStatus: regime === "unclear" ? "degraded" : "live-read-only",
    source: { sectorSource: "controlled-scenario", sectorHistorySource: "controlled-scenario",
      stockHistorySource: "controlled-scenario", fetchedAt: null, days: 500, sectorAdjustment: "none",
      stockAdjustment: "qfq", sectorCount: 2, stockCount: 1 },
    methodology: { version: "1.0.0", horizons: [3, 5], minimumBars: 60, walkForward: true,
      probabilityMeaning: "Hypothetical routing eligibility only" },
    stockRegimes: [{ ...stock, regime: "healthy-trend" }], warnings: [], guardrails: [],
    sectorOutlooks: [1, 2].map(rank => ({ rank, symbol: `scenario-${rank}`, name: "controlled scenario",
      latestDate: "2000-01-01", barCount: 500, direction: up ? "constructive" : risk ? "cautious" : "neutral",
      score: 50, confidence: 0.5, growthProbability3d: 50, growthProbability5d: 50,
      current: { changePercent: recovery ? 1.5 : 0, mainNetInflow: null, advancers: null,
        decliners: null, leaderName: null },
      factors: { return5d: 0, return20d: up ? 0.05 : risk ? -0.06 : 0,
        return60d: up ? 0.1 : risk ? -0.1 : 0, ma20Slope5d: up ? 0.01 : risk ? -0.02 : 0,
        annualizedVolatility20d: regime.endsWith("high-volatility") ? 0.5 : 0.2,
        volumeRatio5d: 1, breadthRatio: recovery ? 0.65 : 0.5 },
      validation: { horizon3: { horizon: 3, samples: 0, directionalHitRate: null, averageForwardReturn: null,
        lastSignalDate: null, lastOutcomeDate: null },
        horizon5: { horizon: 5, samples: 0, directionalHitRate: null, averageForwardReturn: null,
          lastSignalDate: null, lastOutcomeDate: null } }, evidence: [], riskFlags: [],
    })),
  };
  const routing = routeAdaptiveStrategies(report);
  if (routing.regime !== regime) throw Error(`Controlled routing mismatch for ${regime}`);
  return routing;
}

interface Aggregate {
  window: string; scenario: string; strategy: string; stockRegime: string; events: number;
  costs: Record<string, { observed: number; positive: number; netReturnSum: number; unknown: Record<string, number> }>;
}

/** Both coverage and correlation respect the same explicit completed-history boundary. */
export function researchAdaptiveCoverage(input: HistoricalSeries[], asOf: Date) {
  const series = validateStrategyHistory(input, { asOf, maxBars: 500 }).series;
  const { pairs, ...correlationEvidence } = buildHistoricalCorrelations(input, asOf);
  const regimes: AdaptiveMarketRegime[] = ["trend-up-low-volatility", "trend-up-high-volatility",
    "range-low-volatility", "range-high-volatility", "risk-off-recovery", "risk-off", "unclear"];
  const rows: Array<{ symbol: string; date: string; historyDate: string | null; window: string;
    stockRegime: string; confidence: number; scenarioSignals: Record<string, string[]>;
    manualSignals: string[]; outcomes: Record<string, Observation> }> = [];
  const commonDates = series.length ? series[0].bars.map(b => b.date)
    .filter(date => series.every(item => item.bars.some(b => b.date === date))) : [];
  const observationDates = commonDates.filter(date => series.every(item => item.bars.findIndex(b => b.date === date) >= 120));
  const boundary = observationDates[Math.floor(observationDates.length / 2)];
  const dateSet = new Set(observationDates), aggregates = new Map<string, Aggregate>();
  const opportunities: Record<string, number> = {}, states: Record<string, number> = {};
  const transitions: Array<{ symbol: string; observations: number; changes: number; reversionsWithin3: number }> = [];
  for (const item of [...series].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    let changes = 0, reversionsWithin3 = 0;
    const sequence: string[] = [];
    for (let index = 120; index < item.bars.length; index++) {
      if (!dateSet.has(item.bars[index].date)) continue;
      const { stock, quote } = observeAdaptivePrefix(item.symbol, item.name, item.bars, index);
      const window = item.bars[index].date < boundary ? "early" : "late";
      states[stock.regime] = (states[stock.regime] ?? 0) + 1;
      const prior = sequence.at(-1);
      if (prior && prior !== stock.regime) {
        changes++;
        if (sequence.slice(-3).includes(stock.regime)) reversionsWithin3++;
      }
      sequence.push(stock.regime);
      const scenarioSignals: Record<string, string[]> = {};
      const outcomes = Object.fromEntries(COSTS.map(cost => [cost.label, evaluateFiveDayObservation(item.bars, index, cost)]));
      const capture = (scenario: string, signals: string[]) => {
        const domain = `${window}|${scenario}|${stock.regime}`;
        opportunities[domain] = (opportunities[domain] ?? 0) + 1;
        for (const strategy of signals) {
          const key = `${domain}|${strategy}`;
          const aggregate: Aggregate = aggregates.get(key) ?? { window, scenario, stockRegime: stock.regime, strategy,
            events: 0, costs: Object.fromEntries(COSTS.map(c => [c.label, { observed: 0, positive: 0, netReturnSum: 0, unknown: {} }])) };
          aggregate.events++;
          for (const [label, outcome] of Object.entries(outcomes)) {
            const summary = aggregate.costs[label];
            if (outcome.state === "unknown") summary.unknown[outcome.reason] = (summary.unknown[outcome.reason] ?? 0) + 1;
            else { summary.observed++; summary.positive += Number(outcome.netPnl > 0); summary.netReturnSum += outcome.netReturn; }
          }
          aggregates.set(key, aggregate);
        }
      };
      for (const regime of regimes) {
        const routing = scenarioRouting(regime, stock);
        for (const validationProbeActive of [false, true]) {
          const scenario = validationProbeActive ? `${regime}/validation-probe` : regime;
          const signals = rankAdaptiveCandidateStrategies({ quote, stockRegime: stock, routing,
            candidateScore: 70, executionStrategy: "auto", activityTargetActive: true, validationProbeActive });
          scenarioSignals[scenario] = signals.map(s => s.strategyKey);
          capture(scenario, scenarioSignals[scenario]);
        }
      }
      const manualRouting = scenarioRouting("range-low-volatility", stock);
      const manualSignals = PAPER_EXECUTION_STRATEGY_OPTIONS.flatMap(option =>
        rankAdaptiveCandidateStrategies({ quote, stockRegime: stock, routing: manualRouting,
          candidateScore: 70, executionStrategy: option.key, activityTargetActive: true,
          validationProbeActive: false }).map(signal => signal.strategyKey));
      capture("manual-eligibility", manualSignals);
      rows.push({ symbol: item.symbol, date: quote.updatedAt.slice(0, 10), historyDate: stock.latestDate,
        window, stockRegime: stock.regime, confidence: stock.confidence, scenarioSignals, manualSignals, outcomes });
    }
    transitions.push({ symbol: item.symbol, observations: sequence.length, changes, reversionsWithin3 });
  }
  return { methodology: { evaluationUnit: "overlapping-conditional-observation-not-trade-win-rate",
    historyCutoff: "strictly-before-observation-day", candidateScore: 70,
    marketRouting: "seven-controlled-scenarios-times-normal-and-validation-probe-not-reconstructed",
    horizon: "next-open-to-fifth-close", quantity: 100, maxCashRequired: 5000, costs: COSTS,
    scope: "selected-current-survivors-no-historical-universe-or-intraday-data" },
    commonDays: commonDates.length, observationDays: observationDates.length,
    windows: { early: { first: observationDates[0], last: observationDates[Math.floor(observationDates.length / 2) - 1] },
      late: { first: boundary, last: observationDates.at(-1) } },
    states, opportunities, aggregates: [...aggregates.values()].sort((a, b) =>
      JSON.stringify([a.window, a.scenario, a.stockRegime, a.strategy]).localeCompare(JSON.stringify([b.window, b.scenario, b.stockRegime, b.strategy]))),
    transitions, correlationEvidence, pairs, rows };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) throw Error("Expected distinct frozen input and output paths");
  const bytes = readFileSync(inputPath);
  if (bytes.length > 5 * 1024 * 1024) throw Error("Input exceeds 5 MiB");
  const input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as {
    observedAt: string; requestedSymbols: string[]; snapshot: MarketSnapshot; history: HistoricalBarsResponse;
  };
  const cutoff = Math.min(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime));
  if (!Number.isFinite(cutoff) || Math.max(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)) > Date.now() || input.history.provider !== "akshare" ||
    !Array.isArray(input.requestedSymbols) || input.requestedSymbols.length < 2 || input.requestedSymbols.length > 12 ||
    new Set(input.requestedSymbols).size !== input.requestedSymbols.length || input.requestedSymbols.some(s => !/^\d{6}$/.test(s))) {
    throw Error("Invalid actual provider, observation time, or requested symbols");
  }
  const valid = validateStrategyHistory(input.history.series, { asOf: new Date(cutoff),
    requestedSymbols: new Set(input.requestedSymbols), maxBars: 500 });
  const eligible = valid.series.filter(item => item.bars.length >= 300);
  if (eligible.length < 2) throw Error("At least two eligible series required");
  // Keep original rejected dates for interval evidence while limiting the coverage universe.
  const eligibleSymbols = new Set(eligible.map(item => item.symbol));
  const result = researchAdaptiveCoverage(input.history.series.filter(item => item && eligibleSymbols.has(item.symbol)), new Date(cutoff));
  const sourcePaths = ["scripts/research-adaptive-coverage-history.ts", "server/research/adaptiveCandidateStrategy.ts",
    "server/research/adaptiveStrategyRouter.ts", "server/research/marketRegimeResearch.ts",
    "server/research/strategyHistoryEvidence.ts", "server/research/historicalCorrelation.ts", "server/broker/executionCosts.ts"];
  const output = { codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    sourceSha256: Object.fromEntries(sourcePaths.map(path => [path,
      createHash("sha256").update(readFileSync(path)).digest("hex")])),
    inputSha256: createHash("sha256").update(bytes).digest("hex"), observedAt: input.observedAt,
    asOf: new Date(cutoff).toISOString(), source: input.history.source, fetchedAt: input.history.fetchedAt,
    sourceWarning: input.history.warning, validationWarnings: valid.warnings,
    series: eligible.map(item => ({ symbol: item.symbol, source: item.source, adjustment: item.adjustment,
      bars: item.bars.length, first: item.bars[0].date, last: item.bars.at(-1)?.date })), ...result };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ inputSha256: output.inputSha256, rows: result.rows.length,
    commonDays: result.commonDays, observationDays: result.observationDays, windows: result.windows,
    states: result.states, validationWarnings: valid.warnings }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
