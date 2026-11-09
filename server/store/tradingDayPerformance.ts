import type {
  AuditEvent, MarketSnapshot, OrderRecord, PositionSnapshot, TradingDayPerformance,
} from "../../shared/trading";
import { getChinaDateKey } from "../trading/ashareTradingCalendar";

/** Rebuild the opening ledger from persisted fills, never from cumulative profit. */
export function calculateTradingDayPerformance(input: {
  now: Date;
  cash: number;
  equity: number;
  startingEquity: number;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  auditEvents: AuditEvent[];
  snapshot: MarketSnapshot;
}): TradingDayPerformance {
  const date = getChinaDateKey(input.now);
  const unavailable = (): TradingDayPerformance => ({
    date, openingEquity: null, pnl: null, pnlPercent: null, baselineSource: "unavailable",
  });
  const result = (openingEquity: number, baselineSource: TradingDayPerformance["baselineSource"]): TradingDayPerformance => {
    if (!Number.isFinite(openingEquity) || openingEquity <= 0 || !Number.isFinite(input.equity)) return unavailable();
    const pnl = input.equity - openingEquity;
    return { date, openingEquity, pnl, pnlPercent: pnl / openingEquity, baselineSource };
  };
  const started = input.auditEvents.find((event) =>
    event.action === "account.created" || event.action === "account.reset");
  if (started && Number.isFinite(Date.parse(started.timestamp)) &&
      getChinaDateKey(new Date(started.timestamp)) === date) {
    return result(input.startingEquity, "account-start");
  }

  let openingCash = input.cash;
  const openingQuantities = new Map(input.positions.map((position) => [position.symbol, position.quantity]));
  for (const order of input.orders) {
    if (order.status !== "filled") continue;
    const timestamp = Date.parse(order.filledAt ?? order.updatedAt);
    if (!Number.isFinite(timestamp)) return unavailable();
    if (getChinaDateKey(new Date(timestamp)) !== date) continue;
    if (!Number.isFinite(order.notional) || order.notional < 0 ||
        !Number.isFinite(order.commission) || order.commission < 0 ||
        !Number.isInteger(order.filledQuantity) || order.filledQuantity <= 0) return unavailable();
    const quantity = openingQuantities.get(order.symbol) ?? 0;
    if (order.side === "buy") {
      openingCash += order.notional + order.commission;
      openingQuantities.set(order.symbol, quantity - order.filledQuantity);
    } else {
      openingCash -= order.notional - order.commission;
      openingQuantities.set(order.symbol, quantity + order.filledQuantity);
    }
  }
  const quotes = new Map(input.snapshot.quotes.map((quote) => [quote.symbol, quote]));
  let openingEquity = openingCash;
  for (const [symbol, quantity] of openingQuantities) {
    if (!Number.isInteger(quantity) || quantity < 0) return unavailable();
    if (quantity === 0) continue;
    const quote = quotes.get(symbol);
    if (!quote || !Number.isFinite(quote.previousClose) || quote.previousClose <= 0 ||
        !Number.isFinite(Date.parse(quote.updatedAt)) ||
        getChinaDateKey(new Date(quote.updatedAt)) !== date) return unavailable();
    openingEquity += quantity * quote.previousClose;
  }
  return result(openingEquity, "previous-close");
}
