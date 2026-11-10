import type { HistoricalSeries, SectorSnapshot } from "./marketRegimeResearch";
import { validateCompletedDailyBars } from "./strategyHistoryEvidence";

/** Resolve name/code aliases only within this request, rejecting ambiguous identities. */
export function validateSectorHistory(seriesList: HistoricalSeries[], options: {
  asOf: Date;
  requestedSectors: SectorSnapshot[];
  maxBars: number;
}) {
  const aliases = new Map<string, Set<number>>();
  options.requestedSectors.forEach((sector, index) => {
    for (const value of [sector.symbol, sector.name]) {
      if (typeof value !== "string" || !value.trim()) continue;
      const key = value.trim();
      const matches = aliases.get(key) ?? new Set<number>();
      matches.add(index); aliases.set(key, matches);
    }
  });
  const resolve = (item: HistoricalSeries): number | null => {
    if (!item || typeof item.symbol !== "string" || typeof item.name !== "string") return null;
    const symbol = aliases.get(item.symbol.trim()), name = aliases.get(item.name.trim());
    if (symbol?.size !== 1 || name?.size !== 1) return null;
    const index = [...symbol][0];
    return name.has(index) ? index : null;
  };
  const identities = seriesList.map(resolve);
  const counts = new Map<number, number>();
  for (const index of identities) if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1);
  const series: HistoricalSeries[] = [];
  let excludedSeries = 0, invalidBars = 0, futureBars = 0, duplicateBars = 0, trimmedBars = 0;
  seriesList.forEach((item, position) => {
    const index = identities[position];
    if (index === null || counts.get(index) !== 1 || item.adjustment !== "none" ||
      typeof item.source !== "string" || !item.source.trim() || !Array.isArray(item.bars)) {
      excludedSeries += 1; return;
    }
    const checked = validateCompletedDailyBars(item.bars, { asOf: options.asOf, maxBars: options.maxBars });
    invalidBars += checked.invalidBars; futureBars += checked.futureBars;
    duplicateBars += checked.duplicateBars; trimmedBars += checked.trimmedBars;
    const sector = options.requestedSectors[index];
    series.push({ ...item, symbol: sector.symbol, name: sector.name, source: item.source.trim(), bars: checked.bars });
  });
  return { series, warnings: excludedSeries + invalidBars + futureBars + duplicateBars + trimmedBars > 0 ? [
    `行业历史证据校验：排除 ${excludedSeries} 个请求外、冲突/重复行业或来源/复权不符序列；` +
    `${invalidBars} 根无效日线、${futureBars} 根尚未完成或未来日线、${duplicateBars} 根重复日期日线，` +
    `${trimmedBars} 根超出请求预算的旧日线。`,
  ] : [] };
}
