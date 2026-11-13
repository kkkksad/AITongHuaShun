/** Runtime callers can bypass TypeScript; never reinterpret unknown values as a market sell. */
export function orderDiscriminatorError(order: { side: unknown; type: unknown }): {
  code: "INVALID_ORDER_SIDE" | "INVALID_ORDER_TYPE";
  message: string;
} | null {
  if (order.side !== "buy" && order.side !== "sell") {
    return { code: "INVALID_ORDER_SIDE", message: "订单方向必须是buy或sell" };
  }
  if (order.type !== "market" && order.type !== "limit") {
    return { code: "INVALID_ORDER_TYPE", message: "订单类型必须是market或limit" };
  }
  return null;
}
