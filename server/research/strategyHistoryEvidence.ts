import type { HistoricalBar, HistoricalSeries } from "./marketRegimeResearch";

interface StrategyHistoryOptions {
  asOf: Date;
  requestedSymbols?: ReadonlySet<string>;
  maxBars?: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function civilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validCandle(bar: HistoricalBar): boolean {
  return [bar.open, bar.high, bar.low, bar.close].every((value) => finite(value) && value > 0) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) &&
    finite(bar.volume) && bar.volume >= 0 &&
    (bar.amount === null || finite(bar.amount) && bar.amount >= 0);
}

/** Shared complete A-share daily observations; no symbol or strategy permission. */
export function validateCompletedDailyBars(input: HistoricalBar[], options: Pick<StrategyHistoryOptions, "asOf" | "maxBars">) {
  const cutoff = options.asOf.getTime();
  if (!Number.isFinite(cutoff)) throw new Error("历史证据校验缺少有效时间上限");
  if (!Array.isArray(input)) throw new Error("历史证据校验缺少日线列表");
  const maxBars = Math.min(500, Math.max(1, Math.floor(options.maxBars ?? 500)));
  const dateCounts = new Map<string, number>();
  for (const bar of input) {
    if (bar && civilDate(bar.date)) dateCounts.set(bar.date, (dateCounts.get(bar.date) ?? 0) + 1);
  }
  const bars: HistoricalBar[] = [];
  let invalidBars = 0, futureBars = 0, duplicateBars = 0;
  for (const bar of input) {
    if (!bar || !civilDate(bar.date)) { invalidBars += 1; continue; }
    if (dateCounts.get(bar.date) !== 1) { duplicateBars += 1; continue; }
    if (!validCandle(bar)) { invalidBars += 1; continue; }
    if (Date.parse(`${bar.date}T15:00:00+08:00`) > cutoff) { futureBars += 1; continue; }
    bars.push({ ...bar });
  }
  bars.sort((left, right) => left.date.localeCompare(right.date));
  return { bars: bars.slice(-maxBars), invalidBars, futureBars, duplicateBars,
    trimmedBars: Math.max(0, bars.length - maxBars) };
}

export function validateStrategyHistory(seriesList: HistoricalSeries[], options: StrategyHistoryOptions) {
  const cutoff = options.asOf.getTime();
  if (!Number.isFinite(cutoff)) throw new Error("历史证据校验缺少有效时间上限");
  if (!Array.isArray(seriesList)) throw new Error("历史证据校验缺少序列列表");
  const maxBars = Math.min(500, Math.max(1, Math.floor(options.maxBars ?? 500)));
  const symbolCounts = new Map<string, number>();
  for (const item of seriesList) {
    if (item && typeof item.symbol === "string") {
      symbolCounts.set(item.symbol, (symbolCounts.get(item.symbol) ?? 0) + 1);
    }
  }
  const series: HistoricalSeries[] = [];
  let excludedSeries = 0;
  let invalidBars = 0;
  let futureBars = 0;
  let duplicateBars = 0;
  let trimmedBars = 0;
  for (const item of seriesList) {
    if (!item || typeof item.symbol !== "string" || !/^\d{6}$/.test(item.symbol) ||
      options.requestedSymbols && !options.requestedSymbols.has(item.symbol) ||
      symbolCounts.get(item.symbol) !== 1 || item.adjustment !== "qfq" ||
      typeof item.source !== "string" || !item.source.trim() || !Array.isArray(item.bars)) {
      excludedSeries += 1;
      continue;
    }
    const checked = validateCompletedDailyBars(item.bars, { asOf: options.asOf, maxBars });
    invalidBars += checked.invalidBars;
    futureBars += checked.futureBars;
    duplicateBars += checked.duplicateBars;
    trimmedBars += checked.trimmedBars;
    series.push({ ...item, source: item.source.trim(), bars: checked.bars });
  }
  const removed = excludedSeries + invalidBars + futureBars + duplicateBars + trimmedBars;
  return {
    series,
    warnings: removed > 0 ? [
      `历史证据校验：排除 ${excludedSeries} 个请求外、重复股票或来源/复权不符序列；` +
      `${invalidBars} 根无效日线、${futureBars} 根尚未完成或未来日线、${duplicateBars} 根重复日期日线，` +
      `${trimmedBars} 根超出请求预算的旧日线。`,
    ] : [],
  };
}
