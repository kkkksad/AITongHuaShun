import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeHistoricalEntryStructure } from "../server/research/historicalEntryStructure";
import { validateStrategyHistory } from "../server/research/strategyHistoryEvidence";
import { observeAdaptivePrefix } from "./research-adaptive-coverage-history";
import type { HistoricalBarsResponse } from "../server/research/marketRegimeResearch";
import type { MarketSnapshot } from "../shared/trading";

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
    throw Error("Invalid actual provider, observation times, or requested identities");
  }
  const asOf = new Date(cutoff);
  const valid = validateStrategyHistory(input.history.series, { asOf, requestedSymbols: new Set(input.requestedSymbols), maxBars: 500 });
  const eligible = valid.series.filter(item => item.bars.length >= 300);
  if (eligible.length < 2 || valid.warnings.length) throw Error("Structure comparison requires at least two clean frozen histories");
  const common = eligible[0].bars.map(bar => bar.date).filter(date => eligible.every(item =>
    item.bars.findIndex(bar => bar.date === date) >= 120));
  const dates = new Set(common);
  const rows = eligible.flatMap(item => item.bars.flatMap((bar, index) => {
    if (!dates.has(bar.date)) return [];
    const { stock, quote } = observeAdaptivePrefix(item.symbol, item.name, item.bars, index);
    const structure = analyzeHistoricalEntryStructure({ ...item, bars: item.bars.slice(0, index) }, new Date(quote.updatedAt));
    if (!structure.observed || !structure.latestDate || structure.latestDate >= bar.date) throw Error("Prior completed structure boundary violated");
    return [{ symbol: item.symbol, date: bar.date, stockRegime: stock.regime, structure }];
  }));
  const latest = eligible.map(item => analyzeHistoricalEntryStructure(item, asOf));
  const summaries = [...new Set(rows.map(row => row.stockRegime))].sort().map(regime => {
    const group = rows.filter(row => row.stockRegime === regime);
    return { regime, observations: group.length,
      priorCompletedClosingBreakouts: group.filter(row => row.structure.breakout.closesAbovePriorHigh20).length,
      priorCompletedIntradayOnlyHighBreaks: group.filter(row => row.structure.breakout.latestDayHigh > row.structure.breakout.priorHigh20 &&
        !row.structure.breakout.closesAbovePriorHigh20).length,
      priorCompletedRecoveryAbovePreviousHigh: group.filter(row => row.structure.pullback.latestCloseAbovePreviousDayHigh).length,
      unknownVolumeRatios: group.filter(row => row.structure.breakout.latestCompletedVolumeRatio20 === null).length,
      unknownContractionRatios: group.filter(row => row.structure.contraction.ratio20to40 === null).length };
  });
  const sourcePaths = ["scripts/research-entry-structure-history.ts", "server/research/historicalEntryStructure.ts",
    "server/research/marketRegimeResearch.ts", "server/research/strategyHistoryEvidence.ts", "scripts/research-adaptive-coverage-history.ts"];
  const result = { codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    inputSha256: createHash("sha256").update(bytes).digest("hex"), asOf: asOf.toISOString(), observedAt: input.observedAt,
    source: input.history.source, fetchedAt: input.history.fetchedAt, sourceWarning: input.history.warning, validationWarnings: valid.warnings,
    methodology: { evaluationUnit: "completed-prior-day-structure-not-trade-or-win-rate", historyCutoff: "strictly-before-observation-day",
      thresholdsChanged: false, volumeMeaning: "completed-daily-volume-not-live-intraday-comparable",
      calendar: "observed-bars-without-complete-exchange-calendar", scope: "selected-current-survivor-qfq-not-PIT-universe" },
    latest, summaries, rows };
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ inputSha256: result.inputSha256, rows: rows.length, summaries }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
