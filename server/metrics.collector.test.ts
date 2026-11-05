import { describe, expect, it } from "vitest";
import { createMetricsCollector, resolveHttpMetricRoute } from "./metrics";

describe("独立指标收集器", () => {
  it("独立保存所有指标，保留原名称和计数/仪表语义", () => {
    const first = createMetricsCollector();
    const second = createMetricsCollector();
    const empty = second.getMetricsText();
    first.recordHttpRequest("GET", "/api/account", 200, 0.01);
    first.recordWebSocketConnection(1);
    first.recordOrder("buy", "filled");
    first.recordOrderCancellation();
    first.recordAccountEquity(10_000);
    first.recordAccountCash(9_000);
    first.recordAccountPositions(1);
    first.recordCircuitBreaker(true);

    expect(second.getMetricsText()).toBe(empty);
    const text = first.getMetricsText();
    expect(text).toContain('http_requests_total{method="GET",route="/api/account",status="200"} 1');
    expect(text).toContain("ws_connections 1\n");
    expect(text).toContain('orders_total{side="buy",status="filled"} 1');
    expect(text).toContain("order_cancellations_total 1\n");
    expect(text).toContain("account_equity 10000\n");
    expect(text).toContain("account_cash 9000\n");
    expect(text).toContain("account_positions_count 1\n");
    expect(text).toContain("risk_circuit_breaker 1\n");
    first.recordWebSocketConnection(-2);
    expect(first.getMetricsText()).toContain("ws_connections 0\n");
  });

  it("规范化HTTP方法，未知方法共用OTHER标签，耗时仍按秒累计", () => {
    const metrics = createMetricsCollector();
    const route = resolveHttpMetricRoute();
    for (let index = 0; index < 70; index++) {
      metrics.recordHttpRequest(`FAKE_METHOD_${index}`, route, 404, 0.001);
    }
    metrics.recordHttpRequest("get", "/api/account?fake_query_marker=hidden", 200, 0.012);
    metrics.recordHttpRequest("GET", "/api/account", 200, 0.008);
    const text = metrics.getMetricsText();

    expect(text).not.toMatch(/FAKE_METHOD_|fake_query_marker/);
    expect(text).toContain('http_requests_total{method="OTHER",route="/__unmatched__",status="404"} 70');
    expect(text).toContain('http_requests_total{method="GET",route="/api/account",status="200"} 2');
    expect(text).toContain('http_request_duration_seconds_total{method="GET",route="/api/account",status="200"} 0.02');
    expect(text.split("\n").filter((line) => line.startsWith("http_requests_total{"))).toHaveLength(2);
  });

  it("缺少模板时仅返回固定桶，并按Prometheus格式转义标签", () => {
    expect(resolveHttpMetricRoute(undefined)).toBe("/__unmatched__");
    expect(resolveHttpMetricRoute("")).toBe("/__unmatched__");
    expect(resolveHttpMetricRoute("/api/orders/:orderId")).toBe("/api/orders/:orderId");
    const metrics = createMetricsCollector();
    metrics.recordHttpRequest("GET", '/api/quote"slash\\line\nnext', 200, 0.01);

    expect(metrics.getMetricsText()).toContain(String.raw`route="/api/quote\"slash\\line\nnext"`);
  });
});
