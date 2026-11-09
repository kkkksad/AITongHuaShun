import type { OrderRecord } from "../../shared/trading";

/** Legacy filled orders use their terminal update time, never submission time. */
export function getOrderFillTime(order: OrderRecord): string | null {
  if (order.status !== "filled") return null;
  const raw = order.filledAt ?? order.updatedAt;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
