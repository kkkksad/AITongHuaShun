import { describe, expect, it } from "vitest";
import {
  getMetricsText,
  recordAccountCash,
  recordAccountEquity,
  recordAccountPositions,
  recordCircuitBreaker,
  recordHttpRequest,
  recordOrder,
  recordOrderCancellation,
  recordWebSocketConnection,
} from "./metrics";

describe("metrics collector", () => {
  it("exports Prometheus text format", () => {
    const text = getMetricsText();
    expect(text).toContain("# HELP");
    expect(text).toContain("# TYPE");
    expect(text).toContain("http_requests_total");
    expect(text).toContain("ws_connections");
    expect(text).toContain("orders_total");
    expect(text).toContain("account_equity");
    expect(text).toContain("risk_circuit_breaker");
  });

  it("tracks HTTP requests", () => {
    recordHttpRequest("GET", "/api/health", 200, 0.012);
    recordHttpRequest("POST", "/api/orders", 201, 0.045);
    recordHttpRequest("GET", "/api/health", 200, 0.008);

    const text = getMetricsText();
    expect(text).toContain('method="GET"');
    expect(text).toContain('method="POST"');
    expect(text).toContain('route="/api/health"');
    expect(text).toContain('route="/api/orders"');
    expect(text).toContain('status="200"');
    expect(text).toContain('status="201"');
  });

  it("tracks WebSocket connections", () => {
    recordWebSocketConnection(1);
    recordWebSocketConnection(1);
    recordWebSocketConnection(-1);

    const text = getMetricsText();
    expect(text).toContain("ws_connections 1");
  });

  it("tracks orders by side and status", () => {
    recordOrder("buy", "filled");
    recordOrder("buy", "filled");
    recordOrder("sell", "pending");

    const text = getMetricsText();
    expect(text).toContain('side="buy"');
    expect(text).toContain('side="sell"');
    expect(text).toContain('status="filled"');
    expect(text).toContain('status="pending"');
  });

  it("tracks cancellations", () => {
    recordOrderCancellation();
    recordOrderCancellation();

    const text = getMetricsText();
    expect(text).toContain("order_cancellations_total");
  });

  it("tracks account metrics", () => {
    recordAccountEquity(1000000);
    recordAccountCash(500000);
    recordAccountPositions(5);

    const text = getMetricsText();
    expect(text).toContain("account_equity 1000000");
    expect(text).toContain("account_cash 500000");
    expect(text).toContain("account_positions_count 5");
  });

  it("tracks circuit breaker state", () => {
    recordCircuitBreaker(true);
    let text = getMetricsText();
    expect(text).toContain("risk_circuit_breaker 1");

    recordCircuitBreaker(false);
    text = getMetricsText();
    expect(text).toContain("risk_circuit_breaker 0");
  });

  it("websocket connections cannot go negative", () => {
    // Reset by going to 0 first
    const before = getMetricsText();
    // Set to a baseline by going positive then back
    recordWebSocketConnection(10);
    recordWebSocketConnection(-15);

    const text = getMetricsText();
    expect(text).toContain("ws_connections 0");
  });
});
