import type {
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";

export function buildOrderSymbolNames(
  market: MarketSnapshot | undefined,
  positions: readonly PositionSnapshot[],
): ReadonlyMap<string, string> {
  return new Map([
    ...(market?.quotes ?? []).map((quote) => [quote.symbol, quote.name] as const),
    ...positions.map((position) => [position.symbol, position.name] as const),
  ]);
}

export function resolveOrderName(
  order: OrderRecord,
  symbolNames: ReadonlyMap<string, string>,
): string | undefined {
  return order.name?.trim() || symbolNames.get(order.symbol)?.trim() || undefined;
}
