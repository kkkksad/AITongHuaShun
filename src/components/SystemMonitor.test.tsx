import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApiPerformanceSnapshot } from "../../shared/systemMonitoring";
import { SystemMonitorContent } from "./SystemMonitor";

function makeSnapshot(
  overrides: Partial<ApiPerformanceSnapshot> = {},
): ApiPerformanceSnapshot {
  return {
    generatedAt: "2026-07-19T09:00:00.000Z",
    state: "degraded",
    window: {
      maxRoutes: 64,
      samplesPerRoute: 128,
      slowThresholdMs: 1_500,
      criticalThresholdMs: 5_000,
    },
    totals: {
      requests: 24,
      failures: 1,
      slowRequests: 3,
      inFlight: 2,
      failureRate: 1 / 24,
      averageMs: 420,
      p50Ms: 210,
      p95Ms: 1_850,
      maxMs: 2_400,
    },
    routes: [
      {
        method: "GET",
        route: "/api/research/strategy-leaderboard",
        requestCount: 8,
        failureCount: 1,
        failureRate: 1 / 8,
        slowCount: 3,
        averageMs: 980,
        p50Ms: 850,
        p95Ms: 1_850,
        maxMs: 2_400,
        lastStatus: 200,
        lastSeenAt: "2026-07-19T08:59:55.000Z",
      },
    ],
    recommendations: [
      "慢接口 GET /api/research/strategy-leaderboard 的 P95 为 1850ms。",
    ],
    runtime: {
      mode: "paper",
      marketDataProvider: "akshare",
      realTradingEnabled: false,
      websocketConnections: 1,
      marketQuality: {
        state: "healthy",
        overall: 96,
        freshness: 100,
        validSymbols: 8,
        requestedSymbols: 8,
        issueCount: 0,
      },
    },
    ...overrides,
  };
}

describe("SystemMonitor", () => {
  it("renders API health, market quality, and the slowest route", () => {
    const html = renderToStaticMarkup(
      <SystemMonitorContent
        isFetching={false}
        onRefresh={() => undefined}
        report={makeSnapshot()}
      />,
    );

    expect(html).toContain("API 需要关注");
    expect(html).toContain("1,850");
    expect(html).toContain("4.2%");
    expect(html).toContain("AkShare 真实只读");
    expect(html).toContain("8 / 8");
    expect(html).toContain("/api/research/strategy-leaderboard");
    expect(html).toContain("真实交易关闭");
    expect(html).toContain('aria-label="刷新系统性能诊断"');
  });

  it("renders an explicit idle state before business routes have samples", () => {
    const html = renderToStaticMarkup(
      <SystemMonitorContent
        isFetching={false}
        onRefresh={() => undefined}
        report={makeSnapshot({
          state: "idle",
          routes: [],
          totals: {
            requests: 0,
            failures: 0,
            slowRequests: 0,
            inFlight: 0,
            failureRate: 0,
            averageMs: 0,
            p50Ms: 0,
            p95Ms: 0,
            maxMs: 0,
          },
        })}
      />,
    );

    expect(html).toContain("等待业务样本");
    expect(html).toContain("浏览市场、策略或账户页面后显示接口耗时");
  });

  it("uses TanStack Query with bounded polling and cached error presentation", () => {
    const source = readFileSync("src/components/SystemMonitor.tsx", "utf8");

    expect(source).toContain('queryKey: ["api-performance"]');
    expect(source).toContain("fetchApiPerformance(signal)");
    expect(source).toContain("refetchInterval: 15_000");
    expect(source).toContain("staleTime: 10_000");
    expect(source).toContain("<ResearchQueryState");
  });
});
