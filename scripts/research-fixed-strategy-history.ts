import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { BacktestEngine } from "../server/backtest/backtestEngine";
import {
  buildAlignedHistoricalSnapshots, splitChronologicalWindows, STRATEGY_ROBUSTNESS_PROFILES,
} from "../server/research/strategyRobustness";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";
import type { HistoricalBarsResponse } from "../server/research/marketRegimeResearch";
import type { MarketSnapshot } from "../shared/trading";
import { resolve } from "node:path";

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) throw Error("Expected private frozen input and output paths");
  if (resolve(inputPath) === resolve(outputPath)) throw Error("Output must not overwrite frozen evidence");
  const bytes = readFileSync(inputPath);
  if (bytes.length > 5 * 1024 * 1024) throw Error("Frozen input exceeds 5 MiB");
  const input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as {
    observedAt: string; requestedSymbols: string[]; snapshot: MarketSnapshot; history: HistoricalBarsResponse;
  };
  if (input.history.provider !== "akshare") throw Error("Expected actual read-only history provider");
  if (!Array.isArray(input.requestedSymbols) || input.requestedSymbols.length < 2 || input.requestedSymbols.length > 12 ||
      new Set(input.requestedSymbols).size !== input.requestedSymbols.length || input.requestedSymbols.some(s => !/^\d{6}$/.test(s))) {
    throw Error("Expected 2 to 12 unique requested A-share symbols");
  }
  if (!Number.isFinite(Date.parse(input.observedAt)) || !Number.isFinite(Date.parse(input.snapshot.marketTime)) ||
      Math.max(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)) > Date.now() + 5000) {
    throw Error("Frozen evidence must have valid observed and snapshot times no later than now");
  }
  const asOf = new Date(Math.min(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)));
  const valid = validateStrategyHistory(input.history.series, {
    asOf, requestedSymbols: new Set<string>(input.requestedSymbols), maxBars: 500,
  });
  const eligible = valid.series.filter(s => s.bars.length >= 300);
  const snapshots = buildAlignedHistoricalSnapshots(eligible, "paper", asOf);
  const windows = snapshots.length >= 300 ? splitChronologicalWindows(snapshots, 3) : [];
  const costs = [
    { label: "base", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 },
    { label: "stress", commissionRate: 0.0006, minimumCommission: 10, slippageBps: 15 },
  ];
  const results = [];
  // Default is an independent account for every symbol/window. The legacy
  // mode exists only to reproduce the report's first-tradable-symbol bias.
  const perSymbol = !process.argv.includes("--legacy-multi-quote");
  for (const profile of STRATEGY_ROBUSTNESS_PROFILES) {
    const scenarios = [];
    for (const cost of costs) {
      const reports = [];
      for (const symbol of perSymbol ? eligible.map(s => s.symbol).sort() : [null]) {
      for (const [windowIndex, alignedWindow] of windows.entries()) {
        const window = symbol ? alignedWindow.map(s => ({ ...s, quotes: s.quotes.filter(q => q.symbol === symbol) })) : alignedWindow;
        const strategy = await profile.factory.create(profile.fixedParams);
        let signalsGenerated = 0;
        const signalledSymbols = new Set<string>();
        const onBar = strategy.onBar.bind(strategy);
        strategy.onBar = context => { const signals = onBar(context); signalsGenerated += signals.length; signals.forEach(s => signalledSymbols.add(s.symbol)); return signals; };
        const engine = new BacktestEngine(window, strategy, {
          initialCapital: 1_000_000, maxOrderNotional: 200_000, maxPositionWeight: 0.2, ...cost,
        });
        const report = engine.run();
        reports.push({
          symbol, window: windowIndex + 1, metrics: report.metrics, signalsGenerated, signalledSymbols: [...signalledSymbols],
          orderStatusCounts: Object.fromEntries(["filled", "rejected", "pending", "accepted", "cancelled"].map(
            status => [status, report.orders.filter(o => o.status === status).length],
          )),
          rejectionReasons: [...new Set(report.orders.filter(o => o.status === "rejected").map(o => o.rejectionReason))],
          openPositions: report.finalPositions.map(p => ({ symbol: p.symbol, quantity: p.quantity, unrealizedPnl: p.unrealizedPnl })),
        });
      }
      }
      scenarios.push({ cost, reports });
    }
    results.push({ strategyKey: profile.strategyKey, family: profile.strategyFamily, fixedParams: profile.fixedParams, scenarios });
  }
  const output = {
    codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    evaluationUnit: perSymbol ? "independent-symbol-window-not-portfolio" : "legacy-multi-quote-input",
    observedAt: input.observedAt, asOf: asOf.toISOString(),
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    requestedSymbols: input.requestedSymbols, provider: input.history.provider,
    source: input.history.source, fetchedAt: input.history.fetchedAt,
    historyWarning: input.history.warning, validationWarnings: valid.warnings,
    series: valid.series.map(s => ({ symbol: s.symbol, source: s.source, bars: s.bars.length, first: s.bars[0]?.date, last: s.bars.at(-1)?.date })),
    alignedTradingDays: snapshots.length,
    windows: windows.map(w => ({ bars: w.length, first: w[0].marketTime, last: w.at(-1)?.marketTime })),
    results,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ codeCommit: output.codeCommit, inputSha256: output.inputSha256, historySymbols: valid.series.length, alignedTradingDays: output.alignedTradingDays, windows: output.windows, validationWarnings: output.validationWarnings, profiles: results.length }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
