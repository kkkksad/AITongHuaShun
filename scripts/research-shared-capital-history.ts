import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HistoricalBarsResponse, HistoricalSeries } from "../server/research/marketRegimeResearch";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";
import { buildAlignedHistoricalSnapshots, splitChronologicalWindows, STRATEGY_ROBUSTNESS_PROFILES } from "../server/research/strategyRobustness";
import { runNextOpenPortfolioResearch, SHARED_CAPITAL_RESEARCH_LIMITS } from "../server/research/nextOpenPortfolioResearch";
import type { MarketSnapshot } from "../shared/trading";

const COSTS = [
  { label: "base", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 },
  { label: "stress", commissionRate: 0.0006, minimumCommission: 10, slippageBps: 15 },
] as const;

export async function researchSharedCapitalHistory(series: HistoricalSeries[], asOf: Date) {
  const snapshots = buildAlignedHistoricalSnapshots(series, "paper", asOf);
  if (snapshots.length < 300) throw Error("共享资金研究至少需要300个有效共同日");
  const windows = splitChronologicalWindows(snapshots, 3);
  const symbols = snapshots[0].quotes.map(quote => quote.symbol).sort();
  const results = [];
  for (const profile of STRATEGY_ROBUSTNESS_PROFILES) {
    for (const cost of COSTS) {
      for (const [windowIndex, window] of windows.entries()) {
        for (const order of ["ascending", "descending"] as const) {
          const orderedSymbols = order === "ascending" ? symbols : [...symbols].reverse();
          const children = new Map(await Promise.all(orderedSymbols.map(async symbol =>
            [symbol, await profile.factory.create(profile.fixedParams)] as const)));
          const { report, diagnostics, methodology } = runNextOpenPortfolioResearch(window, children, cost, asOf);
          if (diagnostics.minimumObservedCash < -0.005) throw Error("共享研究出现负现金，不能发布结果");
          const closedMatches = report.metrics.winningTrades + report.metrics.losingTrades;
          const rejected = report.orders.filter(item => item.status === "rejected");
          results.push({ strategyKey: profile.strategyKey, family: profile.strategyFamily, fixedParams: profile.fixedParams,
            cost, window: windowIndex + 1, order, first: window[0].marketTime, last: window.at(-1)!.marketTime,
            tradingDayObservations: window.length, methodology, diagnostics,
            metrics: { initialCapital: report.metrics.initialCapital, finalEquity: report.finalAccount.equity,
              netEquityReturn: report.metrics.totalReturn, observedMaxDrawdownRatio: report.metrics.maxDrawdownPercent,
              filledOrders: report.trades.length, commission: report.metrics.totalCommission,
              closedMatches, winningMatches: report.metrics.winningTrades,
              closedMatchWinRate: closedMatches ? report.metrics.winningTrades / closedMatches : null,
              cash: report.finalAccount.cash, marketValue: report.finalAccount.marketValue,
              unrealizedPnl: report.finalAccount.unrealizedPnl },
            orderStatusCounts: Object.fromEntries(["filled", "rejected", "pending", "accepted", "cancelled"].map(status =>
              [status, report.orders.filter(item => item.status === status).length])),
            rejectionReasons: rejected.reduce<Record<string, number>>((counts, item) => {
              const reason = item.rejectionReason ?? "unknown"; counts[reason] = (counts[reason] ?? 0) + 1; return counts;
            }, {}),
            rejectedOrders: rejected.map(item => ({ symbol: item.symbol, side: item.side, quantity: item.quantity,
              createdAt: item.createdAt, reason: item.rejectionReason })),
            finalPositions: report.finalPositions.map(item => ({ symbol: item.symbol, quantity: item.quantity,
              averagePrice: item.averagePrice, marketValue: item.marketValue, unrealizedPnl: item.unrealizedPnl })),
            trades: report.trades,
          });
        }
      }
    }
  }
  return { methodology: { parametersOptimizedOnReportData: false, evaluationUnit: "one-shared-20000-account-per-fixed-strategy-window-cost-order",
    limits: SHARED_CAPITAL_RESEARCH_LIMITS, fixedCashReserve: 0, symbols,
    decisionAndExecution: "completed-close-decision-next-observed-common-day-open-market-fill",
    forwardOutcomeUnknown: "missing-or-nontradable-next-open-no-retry-and-tail-signals-unexecuted",
    orderSensitivity: "both-predeclared-code-orders-no-best-order-selection", equityReturnAndDrawdownUnit: "ratio-not-currency-or-percent-points",
    quantitySemantics: "fixed-quantity-intents-retained-weight-intents-sized-at-next-open-account-and-price",
    excludedMetrics: "no-annualization-sharpe-or-daily-volatility-from-two-observations-per-day",
    scope: "current-survivor-qfq-fixed-strategies-not-online-routing-pit-universe-or-full-production-risk-tracking",
    limitations: ["no-complete-exchange-calendar", "daily-positive-volume-not-open-liquidity",
      "no-limit-lock-or-complete-tax-model", "finite-order-sensitivity-not-independent-confidence", "no-forced-terminal-liquidation"] },
    alignedTradingDays: snapshots.length,
    windows: windows.map(window => ({ first: window[0].marketTime, last: window.at(-1)!.marketTime, bars: window.length })), results };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) throw Error("Expected distinct frozen input/output paths");
  const bytes = readFileSync(inputPath);
  if (bytes.length > 5 * 1024 * 1024) throw Error("Frozen input exceeds 5 MiB");
  const input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as {
    observedAt: string; requestedSymbols: string[]; snapshot: MarketSnapshot; history: HistoricalBarsResponse;
  };
  const cutoff = Math.min(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime));
  if (!Number.isFinite(cutoff) || Math.max(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)) > Date.now() ||
    input.history.provider !== "akshare" || !Array.isArray(input.requestedSymbols) ||
    input.requestedSymbols.length < 2 || input.requestedSymbols.length > 12 ||
    new Set(input.requestedSymbols).size !== input.requestedSymbols.length || input.requestedSymbols.some(symbol => !/^\d{6}$/.test(symbol))) {
    throw Error("Invalid provider, observation times, or requested A-share identities");
  }
  const asOf = new Date(cutoff);
  const valid = validateStrategyHistory(input.history.series, { asOf, requestedSymbols: new Set(input.requestedSymbols), maxBars: 500 });
  const eligible = valid.series.filter(item => item.bars.length >= 300);
  if (eligible.length < 2) throw Error("At least two eligible histories required");
  const result = await researchSharedCapitalHistory(eligible, asOf);
  const sourcePaths = [...new Set([
    "scripts/research-shared-capital-history.ts", "server/research/nextOpenPortfolioResearch.ts",
    "server/research/strategyHistoryEvidence.ts", "server/research/strategyRobustness.ts",
    ...execFileSync("git", ["ls-files", "server/backtest", "server/broker", "server/risk", "server/store",
      "server/optimizer", "server/trading/ashareTradingCalendar.ts", "shared/backtest.ts", "shared/trading.ts"],
    { encoding: "utf8" }).trim().split(/\r?\n/).filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts")),
  ])].sort();
  const output = { codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    inputSha256: createHash("sha256").update(bytes).digest("hex"), observedAt: input.observedAt, asOf: asOf.toISOString(),
    source: input.history.source, fetchedAt: input.history.fetchedAt, sourceWarning: input.history.warning,
    validationWarnings: valid.warnings,
    series: eligible.map(item => ({ symbol: item.symbol, source: item.source, adjustment: item.adjustment,
      bars: item.bars.length, first: item.bars[0].date, last: item.bars.at(-1)!.date })), ...result };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ inputSha256: output.inputSha256, groups: result.results.length,
    alignedTradingDays: result.alignedTradingDays, windows: result.windows, validationWarnings: valid.warnings }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
