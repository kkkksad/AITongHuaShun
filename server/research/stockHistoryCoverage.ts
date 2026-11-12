/** Response identities are not proof of a fresh upstream request or a buy signal. */
export interface StockHistoryCoverage {
  scope: "regime-stock-history";
  asOf: string;
  selectedSymbols: string[];
  returnedSymbols: string[];
  acceptedSymbols: string[];
  usableSymbols: string[];
}

const fields = ["selectedSymbols", "returnedSymbols", "acceptedSymbols", "usableSymbols"] as const;
function symbols(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 &&
    value.every(symbol => typeof symbol === "string" && /^\d{6}$/.test(symbol)) &&
    new Set(value).size === value.length;
}

/** Strict bounded whitelist for audit projection; missing/invalid evidence stays unknown. */
export function copyStockHistoryCoverage(value: unknown): StockHistoryCoverage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (data.scope !== "regime-stock-history" || typeof data.asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.asOf) ||
    !Number.isFinite(Date.parse(data.asOf)) || new Date(data.asOf).toISOString() !== data.asOf) return undefined;
  const lists = fields.map(field => data[field]);
  if (!lists.every(symbols)) return undefined;
  const [selectedSymbols, returnedSymbols, acceptedSymbols, usableSymbols] = lists;
  for (let i = 1; i < lists.length; i++) {
    const child = new Set(lists[i]);
    const expected = lists[i - 1].filter(symbol => child.has(symbol));
    if (expected.length !== lists[i].length || expected.some((symbol, index) => symbol !== lists[i][index])) return undefined;
  }
  return { scope: "regime-stock-history", asOf: data.asOf,
    selectedSymbols: [...selectedSymbols], returnedSymbols: [...returnedSymbols],
    acceptedSymbols: [...acceptedSymbols], usableSymbols: [...usableSymbols] };
}

export function buildStockHistoryCoverage(input: {
  asOf: Date;
  selectedSymbols: readonly string[];
  stockHistory: unknown;
  acceptedSymbols: readonly string[];
  usableSymbols: readonly string[];
}): StockHistoryCoverage | undefined {
  if (!Number.isFinite(input.asOf.getTime()) || !symbols(input.selectedSymbols)) return undefined;
  const response = input.stockHistory as { provider?: unknown; series?: unknown } | null;
  const returned = new Set<string>();
  if (response?.provider === "akshare" && Array.isArray(response.series)) {
    for (const row of response.series) {
      if (row && typeof row.symbol === "string" && input.selectedSymbols.includes(row.symbol)) returned.add(row.symbol);
    }
  }
  const accepted = new Set(input.acceptedSymbols), usable = new Set(input.usableSymbols);
  return copyStockHistoryCoverage({ scope: "regime-stock-history", asOf: input.asOf.toISOString(),
    selectedSymbols: input.selectedSymbols,
    returnedSymbols: input.selectedSymbols.filter(symbol => returned.has(symbol)),
    acceptedSymbols: input.selectedSymbols.filter(symbol => accepted.has(symbol)),
    usableSymbols: input.selectedSymbols.filter(symbol => usable.has(symbol)),
  });
}
