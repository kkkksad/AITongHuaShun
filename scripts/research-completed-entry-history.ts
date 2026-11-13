import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeMarketRegimeData, type HistoricalBarsResponse, type HistoricalSeries } from "../server/research/marketRegimeResearch";
import { routeAdaptiveStrategies } from "../server/research/adaptiveStrategyRouter";
import { rankAdaptiveCandidateStrategies } from "../server/research/adaptiveCandidateStrategy";
import { evaluateCompletedEntryHypothesis, COMPLETED_ENTRY_KEYS, createCompletedEntryResearchStrategy,
  completedDailyQuoteVolumeShares, type CompletedEntryKey, type CompletedEntryObservation } from "../server/research/completedEntryHypothesis";
import { observeAdaptivePrefix } from "./research-adaptive-coverage-history";
import { parseFrozenEntryVolumeContract, type FrozenDailyVolumeUnit } from "../server/research/frozenEntryVolumeContract";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";
import { buildAlignedHistoricalSnapshots, splitChronologicalWindows } from "../server/research/strategyRobustness";
import { runNextOpenPortfolioResearch, SHARED_CAPITAL_RESEARCH_LIMITS } from "../server/research/nextOpenPortfolioResearch";
import type { MarketSnapshot } from "../shared/trading";

const COSTS = [{ label: "base", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 },
  { label: "stress", commissionRate: 0.0006, minimumCommission: 10, slippageBps: 15 }] as const;

/** No historical sector inference. Manual single-key eligibility does not use the unknown market permission. */
function unknownRouting(asOf: Date) {
  const empty = { provider: "akshare", source: "offline-no-sector-observation", fetchedAt: asOf.toISOString(), warning: null, series: [] };
  return routeAdaptiveStrategies(analyzeMarketRegimeData({ asOf, mode: "paper", provider: "offline-controlled",
    days: 500, sectorResponse: { ...empty, sectors: [] }, sectorHistory: empty, stockHistory: empty, stockNames: new Map() }));
}

export function researchCompletedEntries(inputSeries: HistoricalSeries[], asOf: Date, volumeUnit: FrozenDailyVolumeUnit) {
  const valid = validateStrategyHistory(inputSeries, { asOf, maxBars: 500 });
  if (valid.warnings.length || valid.series.length < 2 || valid.series.length > 12) throw Error("入场研究要求2至12份干净冻结历史");
  const snapshots = buildAlignedHistoricalSnapshots(valid.series, "paper", asOf);
  if (snapshots.length < 300) throw Error("入场研究需要至少300个共同日");
  const windows = splitChronologicalWindows(snapshots, 3), routing = unknownRouting(asOf);
  const symbols = snapshots[0].quotes.map(quote => quote.symbol).sort();
  const dates = new Set(snapshots.map(snapshot => snapshot.marketTime.slice(0, 10)));
  const observations: Record<CompletedEntryKey, Record<string, CompletedEntryObservation[]>> = {
    kairosVolumePriceBreakout: {}, kairosVolatilityContractionBreakout: {}, aSharePullback: {},
  };
  const evidenceRows = [];
  for (const item of valid.series) {
    for (const key of COMPLETED_ENTRY_KEYS) observations[key][item.symbol] = [];
    for (let index = 0; index < item.bars.length; index++) {
      if (!dates.has(item.bars[index].date)) continue;
      const closeTime = `${item.bars[index].date}T15:00:00+08:00`, decisionTime = new Date(closeTime);
      const observed = index >= 120 ? observeAdaptivePrefix(item.symbol, item.name, item.bars, index) : null;
      for (const key of COMPLETED_ENTRY_KEYS) {
        const hypothesis = evaluateCompletedEntryHypothesis({ ...item, bars: item.bars.slice(0, index + 1) }, key, decisionTime);
        const quoteVolume = completedDailyQuoteVolumeShares(item.source, item.bars[index].volume, volumeUnit);
        const proxyEligible = observed !== null && rankAdaptiveCandidateStrategies({ quote: { ...observed.quote, volume: quoteVolume },
          stockRegime: observed.stock, routing, executionStrategy: key, candidateScore: 80 }).some(signal => signal.strategyKey === key);
        const row: CompletedEntryObservation = { symbol: item.symbol, closeTime, proxyEligible, structure: hypothesis.state };
        observations[key][item.symbol].push(row);
        evidenceRows.push({ ...row, strategyKey: key, priorHistoryDate: observed?.stock.latestDate ?? null,
          stockRegime: observed?.stock.regime ?? "insufficient-data", priorBarCount: index,
          structureLatestDate: hypothesis.structure.latestDate });
      }
    }
  }
  const results = [];
  for (const key of COMPLETED_ENTRY_KEYS) for (const mode of ["proxy", "structure"] as const) {
    for (const cost of COSTS) for (const [windowIndex, window] of windows.entries()) {
      for (const order of ["ascending", "descending"] as const) {
        const orderedSymbols = order === "ascending" ? symbols : [...symbols].reverse();
        const children = orderedSymbols.map(symbol => ({ symbol,
          ...createCompletedEntryResearchStrategy(symbol, key, mode, observations[key][symbol], asOf) }));
        const { report, diagnostics, methodology } = runNextOpenPortfolioResearch(window,
          new Map(children.map(child => [child.symbol, child.strategy])), cost, asOf);
        if (diagnostics.minimumObservedCash < -0.005) throw Error("入场研究出现负现金");
        const closedMatches = report.metrics.winningTrades + report.metrics.losingTrades;
        const rejected = report.orders.filter(item => item.status === "rejected");
        results.push({ strategyKey: key, entryMode: mode, cost, window: windowIndex + 1, order,
          first: window[0].marketTime, last: window.at(-1)!.marketTime, tradingDayObservations: window.length,
          methodology, diagnostics, entryDiagnostics: Object.fromEntries(children.map(child => [child.symbol, child.getDiagnostics()])),
          metrics: { initialCapital: report.metrics.initialCapital, finalEquity: report.finalAccount.equity,
            netEquityReturn: report.metrics.totalReturn, observedMaxDrawdownRatio: report.metrics.maxDrawdownPercent,
            filledOrders: report.trades.length, commission: report.metrics.totalCommission, closedMatches,
            winningMatches: report.metrics.winningTrades, closedMatchWinRate: closedMatches ? report.metrics.winningTrades / closedMatches : null,
            cash: report.finalAccount.cash, marketValue: report.finalAccount.marketValue, unrealizedPnl: report.finalAccount.unrealizedPnl },
          orderStatusCounts: Object.fromEntries(["filled", "rejected", "pending", "accepted", "cancelled"].map(status =>
            [status, report.orders.filter(item => item.status === status).length])),
          rejectionReasons: rejected.reduce<Record<string, number>>((counts, item) => {
            const reason = item.rejectionReason ?? "unknown"; counts[reason] = (counts[reason] ?? 0) + 1; return counts;
          }, {}),
          rejectedOrders: rejected.map(item => ({ symbol: item.symbol, side: item.side, quantity: item.quantity,
            createdAt: item.createdAt, reason: item.rejectionReason })),
          finalPositions: report.finalPositions.map(item => ({ symbol: item.symbol, quantity: item.quantity,
            averagePrice: item.averagePrice, marketValue: item.marketValue, unrealizedPnl: item.unrealizedPnl })),
          trades: report.trades });
      }
    }
  }
  return { methodology: { parametersOptimizedOnReportData: false, limits: SHARED_CAPITAL_RESEARCH_LIMITS,
    evaluationUnit: "one-shared-20000-account-per-entry-key-mode-window-cost-order", fixedCashReserve: 0,
    decisionAndExecution: "completed-close-confirmation-next-observed-open", stockClassificationBoundary: "strictly-before-decision-day",
    structureBoundary: "through-decision-completed-close", candidateScore: 80, targetWeight: 0.20,
    quoteVolume: volumeUnit === "lots" ? "explicit-daily-lots-times-100-for-quote-absolute-thresholds" : "explicit-daily-shares-no-second-conversion",
    unchangedHistoryVolume: "declared-input-unit-preserved-for-relative-ratios-and-original-backtest-input",
    thresholds: { volumePrice: { volumeRatio: 1.5, closingAbovePrior20High: true },
      contraction: { volumeRatio: 1.4, meanRange20To40: 0.62, closingAbovePrior20High: true },
      pullback: { maxPriorLowDrawdown: 0.07, minimumRecoveryFromLow: 0.008, quietLowVolumeRatio: 1,
        minimumLatestVolumeRatio: 1.15, closingAbovePreviousHigh: true } },
    commonExit: { stopPriceRatio: 0.03, profitPriceRatio: 0.05, observedHoldingCloses: 10 },
    forwardOutcomeUnknown: "missing-nontradable-next-open-no-retry-tail-unexecuted", terminalLiquidation: false,
    symbols, scope: "manual-single-key-proxy-vs-predeclared-completed-structure-offline-not-production-plan-or-routing-replay",
    limitations: ["previously-observed-sample-not-new-out-of-sample", "current-survivor-qfq-not-PIT-universe",
      "no-historical-scanner-score-candidate-score-fixed-80", "no-sector-or-online-daily-budget-reconstruction",
      "completed-daily-not-live-intraday-volume", "only-eastmoney-source-units-verified-tencent-version-dependent-rejected",
      "same-exits-are-research-control-not-production-exit-replay",
      "daily-positive-volume-not-opening-liquidity", "no-complete-exchange-calendar-or-full-tax-model",
      "finite-order-sensitivity-not-independent-confidence", "overlapping-same-history-hypotheses-not-independent-samples"] },
    alignedTradingDays: snapshots.length, windows: windows.map(window => ({first:window[0].marketTime,last:window.at(-1)!.marketTime,bars:window.length})),
    evidenceRows, results };
}

function main() {
  const [inputPath, outputPath, contractPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || !contractPath || new Set([inputPath, outputPath, contractPath].map(p => resolve(p))).size !== 3) {
    throw Error("Expected distinct frozen input, output and volume declaration paths");
  }
  const bytes = readFileSync(inputPath);
  if (bytes.length > 5 * 1024 * 1024) throw Error("Frozen input exceeds 5 MiB");
  if (statSync(contractPath).size > 4096) throw Error("Volume declaration exceeds 4096 bytes");
  const volumeContract = parseFrozenEntryVolumeContract(bytes, readFileSync(contractPath));
  const input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as {
    observedAt: string; requestedSymbols: string[]; snapshot: MarketSnapshot; history: HistoricalBarsResponse };
  const cutoff = Math.min(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime));
  if (!Number.isFinite(cutoff) || Math.max(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)) > Date.now() ||
    input.history.provider !== "akshare" || !Array.isArray(input.requestedSymbols) || input.requestedSymbols.length < 2 ||
    input.requestedSymbols.length > 12 || new Set(input.requestedSymbols).size !== input.requestedSymbols.length ||
    input.requestedSymbols.some(symbol => !/^\d{6}$/.test(symbol))) throw Error("Invalid frozen provider, time, or identities");
  const asOf = new Date(cutoff);
  const valid = validateStrategyHistory(input.history.series, { asOf, requestedSymbols: new Set(input.requestedSymbols), maxBars: 500 });
  if (valid.warnings.length) throw Error("Entry comparison requires clean frozen histories");
  const result = researchCompletedEntries(valid.series, asOf, volumeContract.volumeUnit);
  const sourcePaths = [...new Set(["scripts/research-completed-entry-history.ts", "scripts/verify-completed-entry-history.cjs",
    "shared/orderDiscriminators.ts",
    "server/research/frozenEntryVolumeContract.ts",
    "scripts/research-adaptive-coverage-history.ts", "server/research/completedEntryHypothesis.ts",
    "server/research/historicalEntryStructure.ts", "server/research/marketRegimeResearch.ts", "server/research/adaptiveCandidateStrategy.ts",
    "server/research/adaptiveStrategyRouter.ts", "server/research/nextOpenPortfolioResearch.ts",
    "server/research/strategyHistoryEvidence.ts", "server/research/strategyRobustness.ts",
    ...execFileSync("git", ["ls-files", "server/backtest", "server/broker", "server/risk", "server/store", "server/trading/ashareTradingCalendar.ts",
      "shared/backtest.ts", "shared/trading.ts"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(p => p.endsWith(".ts") && !p.endsWith(".test.ts"))])].sort();
  const output = { codeCommit: execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], {encoding:"utf8"}).trim().length > 0,
    sourceSha256: Object.fromEntries(sourcePaths.map(p => [p,createHash("sha256").update(readFileSync(p)).digest("hex")])),
    inputSha256: createHash("sha256").update(bytes).digest("hex"), asOf: asOf.toISOString(), observedAt: input.observedAt,
    source: input.history.source, fetchedAt: input.history.fetchedAt, sourceWarning: input.history.warning, volumeContract,
    validationWarnings: valid.warnings, ...result };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({groups:result.results.length,observations:result.evidenceRows.length,inputSha256:output.inputSha256,windows:result.windows}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
