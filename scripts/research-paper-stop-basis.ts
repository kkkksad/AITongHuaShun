import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { executionCosts, hasSufficientCash } from "../server/broker/executionCosts";
import type { HistoricalBarsResponse } from "../server/research/marketRegimeResearch";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";

// A fixed stop-only cohort comparison, without strategy selection or parameter fitting.
const COSTS = [
  { label: "base", commissionRate: 0.0003, minimumCommission: 5, slippageBps: 5 },
  { label: "stress", commissionRate: 0.0006, minimumCommission: 10, slippageBps: 15 },
] as const;
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) {
  throw Error("Expected distinct frozen input and output paths");
}
const bytes = readFileSync(inputPath);
if (bytes.length > 5 * 1024 * 1024) throw Error("Input exceeds 5 MiB");
const input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as {
  observedAt: string; requestedSymbols: string[]; snapshot: { marketTime: string };
  history: HistoricalBarsResponse;
};
const cutoff = Math.min(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime));
if (!Number.isFinite(cutoff) ||
  Math.max(Date.parse(input.observedAt), Date.parse(input.snapshot.marketTime)) > Date.now() ||
  input.history.provider !== "akshare" || !Array.isArray(input.requestedSymbols) ||
  input.requestedSymbols.length < 2 || input.requestedSymbols.length > 12 ||
  new Set(input.requestedSymbols).size !== input.requestedSymbols.length ||
  input.requestedSymbols.some(symbol => !/^\d{6}$/.test(symbol))) throw Error("Invalid frozen evidence");
const valid = validateStrategyHistory(input.history.series, {
  asOf: new Date(cutoff), requestedSymbols: new Set(input.requestedSymbols), maxBars: 500,
});
if (valid.warnings.length || valid.series.length !== input.requestedSymbols.length ||
  valid.series.some(item => item.bars.length !== 500)) throw Error("Expected complete validated 500-bar series");
const dates = valid.series[0].bars.map(bar => bar.date);
if (valid.series.some(item => item.bars.some((bar, index) => bar.date !== dates[index]))) {
  throw Error("Expected aligned observation dates");
}
const rows = [];
for (const item of [...valid.series].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
  for (const [window, start, end] of [["early", 120, 310], ["late", 310, 500]] as const) {
    // Ten-session spacing prevents any holdings in this same-symbol cohort from overlapping.
    for (let index = start; index + 5 < end; index += 10) {
      for (const cost of COSTS) {
        const bars = item.bars;
        const buy = executionCosts({ symbol: item.symbol, side: "buy", type: "market", quantity: 100 }, bars[index].open, cost);
        const unknown = buy.cashDebit > 5000 ? "lot-over-5000" :
          bars.slice(index, index + 6).some(bar => bar.volume <= 0) ? "zero-volume" : null;
        if (unknown) {
          rows.push({ symbol: item.symbol, window, cost: cost.label, entryDate: bars[index].date, unknown });
          continue;
        }
        const outcomes = (["old-market-value", "actual-fill-cost"] as const).map(basis => {
          let exitIndex = index + 5;
          let signalDate: string | null = null;
          // Observe completed close, then exit next open: no same-close fill or entry-day sale.
          for (let observation = index + 1; observation < index + 5; observation++) {
            const mark = bars[observation].close;
            const hit = basis === "old-market-value"
              ? Number(((mark - buy.fillPrice) * 100).toFixed(2)) / Number((mark * 100).toFixed(2)) <= -0.03
              : hasSufficientCash(buy.fillPrice * 0.97, mark);
            if (hit) { exitIndex = observation + 1; signalDate = bars[observation].date; break; }
          }
          const sell = executionCosts({ symbol: item.symbol, side: "sell", type: "market", quantity: 100 }, bars[exitIndex].open, cost);
          const netPnl = Number((sell.notional - sell.commission - buy.cashDebit).toFixed(2));
          if (bars[exitIndex].date <= bars[index].date ||
            signalDate && bars[exitIndex].date <= signalDate) throw Error("Invalid execution time boundary");
          return { basis, signalDate, exitDate: bars[exitIndex].date, sellPrice: sell.fillPrice,
            fees: buy.commission + sell.commission, netPnl, netReturn: netPnl / buy.cashDebit };
        });
        rows.push({ symbol: item.symbol, window, cost: cost.label, entryDate: bars[index].date,
          buyPrice: buy.fillPrice, cashRequired: buy.cashDebit, unknown: null, outcomes,
          changedExit: outcomes[0].exitDate !== outcomes[1].exitDate,
          changedSignal: outcomes[0].signalDate !== outcomes[1].signalDate });
      }
    }
  }
}
const summaries = ["early", "late"].flatMap(window => COSTS.map(cost => {
  const selected = rows.filter(row => row.window === window && row.cost === cost.label);
  const observed = selected.filter(row => row.outcomes);
  const changed = observed.filter(row => row.changedExit);
  return { window, cost: cost.label, cohorts: selected.length, observed: observed.length,
    unknown: selected.length - observed.length, changedSignal: observed.filter(row => row.changedSignal).length,
    changedExit: changed.length,
    higherNetPnl: changed.filter(row => row.outcomes![1].netPnl > row.outcomes![0].netPnl).length,
    lowerNetPnl: changed.filter(row => row.outcomes![1].netPnl < row.outcomes![0].netPnl).length,
    equalNetPnl: changed.filter(row => row.outcomes![1].netPnl === row.outcomes![0].netPnl).length,
    meanNetReturn: [0, 1].map(index => observed.length
      ? observed.reduce((sum, row) => sum + row.outcomes![index].netReturn, 0) / observed.length : null) };
}));
const sourcePaths = ["scripts/research-paper-stop-basis.ts", "server/research/paperTradingPlan.ts",
  "server/research/strategyHistoryEvidence.ts", "server/broker/executionCosts.ts"];
const output = {
  codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  inputSha256: createHash("sha256").update(bytes).digest("hex"), asOf: new Date(cutoff).toISOString(),
  source: input.history.source, fetchedAt: input.history.fetchedAt, sourceWarning: input.history.warning,
  validationWarnings: valid.warnings,
  methodology: { unit: "fixed-stop-only-one-lot-cohort-not-production-trade-or-portfolio",
    selection: "entry-at-open-every-ten-sessions-after-first-120-bars-within-two-fixed-windows",
    quantity: 100, maxCashRequired: 5000, maxHoldingSessions: 5,
    stop: "completed-close-signal-from-T+1-exit-next-open", costs: COSTS,
    limitations: "current-survivor-qfq-universe; no-entry-alpha; no-limit-lock-or-full-tax-model; gaps-may-exceed-3-percent" },
  windows: [{ window: "early", first: dates[120], last: dates[309] }, { window: "late", first: dates[310], last: dates[499] }],
  summaries, rows,
};
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ inputSha256: output.inputSha256, windows: output.windows, summaries }));
