import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DataQualityReport } from "../../shared/trading";
import {
  MarketDataQualityContent,
  buildMarketQualityView,
} from "./MarketDataQualityStrip";

function makeReport(
  overrides: Partial<DataQualityReport> = {},
): DataQualityReport {
  return {
    timestamp: "2026-07-19T08:00:00.000Z",
    provider: "akshare",
    totalSymbols: 10,
    requestedSymbols: 8,
    validSymbols: 8,
    qualityState: "healthy",
    score: {
      freshness: 98,
      completeness: 100,
      suspensionRate: 0,
      limitUpCount: 1,
      limitDownCount: 0,
      adjustmentWarningCount: 0,
      anomalyPriceCount: 0,
      staleCount: 0,
      overall: 97,
    },
    flags: [],
    missingSymbols: [],
    cacheAgeSec: 2.4,
    ...overrides,
  };
}

describe("MarketDataQualityStrip", () => {
  it("maps a healthy report into a concise read-only diagnosis", () => {
    const view = buildMarketQualityView(makeReport());

    expect(view.stateLabel).toBe("数据可用");
    expect(view.coverage).toBe("8 / 8");
    expect(view.issueCount).toBe(0);
  });

  it("surfaces stale, anomaly, adjustment, and missing counts", () => {
    const view = buildMarketQualityView(makeReport({
      requestedSymbols: 8,
      validSymbols: 6,
      qualityState: "degraded",
      missingSymbols: ["000001", "600519"],
      score: {
        ...makeReport().score,
        staleCount: 2,
        anomalyPriceCount: 1,
        adjustmentWarningCount: 1,
        completeness: 75,
        overall: 68,
      },
    }));

    expect(view.stateLabel).toBe("谨慎使用");
    expect(view.coverage).toBe("6 / 8");
    expect(view.issueCount).toBe(6);
    expect(view.issueText).toContain("缺失 2");
    expect(view.issueText).toContain("陈旧 2");
  });

  it("counts present but invalid quotes as coverage issues", () => {
    const view = buildMarketQualityView(makeReport({
      requestedSymbols: 8,
      validSymbols: 6,
      qualityState: "degraded",
      missingSymbols: ["000001"],
    }));

    expect(view.issueCount).toBe(2);
    expect(view.issueText).toContain("缺失 1");
    expect(view.issueText).toContain("无效 1");
  });

  it("renders stable metrics and a refresh icon command", () => {
    const html = renderToStaticMarkup(
      <MarketDataQualityContent
        isFetching={false}
        onRefresh={() => undefined}
        report={makeReport()}
      />,
    );

    expect(html).toContain("A 股数据质量");
    expect(html).toContain("97");
    expect(html).toContain("8 / 8");
    expect(html).toContain('aria-label="刷新行情数据质量"');
    expect(html).toContain("只读诊断");
  });

  it("stops polling while offline and retains cached-data refresh semantics", () => {
    const source = readFileSync("src/components/MarketDataQualityStrip.tsx", "utf8");

    expect(source).toContain("enabled: connected");
    expect(source).toContain("refetchInterval: connected ? 30_000 : false");
    expect(source).toContain("<ResearchQueryState");
    expect(source).toContain("hasData={Boolean(qualityQuery.data)}");
    expect(source).toContain("后端恢复连接后自动检查行情覆盖与新鲜度");
  });
});
