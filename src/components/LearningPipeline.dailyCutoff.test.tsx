import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { buildDailyMarketReview } from "../../server/research/dailyMarketReview";
import LearningPipeline from "./LearningPipeline";

function render(fillIncludedInReview: boolean | undefined) {
  const now = new Date("2026-07-14T02:00:00Z");
  const report = buildDailyMarketReview({
    snapshot: { mode: "paper", sequence: 1, marketTime: now.toISOString(), quotes: [] },
    account: { accountId: "cutoff", mode: "paper", cash: 20000, equity: 20000, marketValue: 0,
      unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0, riskUtilization: 0,
      paused: false, updatedAt: now.toISOString() },
    positions: [], auditEvents: [], now, provider: "akshare",
    orders: [{ id: "row", symbol: "600010", side: "buy", type: "limit", quantity: 100,
      status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
      notional: 1000, commission: 5, createdAt: "2026-07-14T01:30:00Z",
      updatedAt: now.toISOString(), filledAt: now.toISOString() }],
  });
  if (fillIncludedInReview === undefined) {
    delete (report.trades.items[0] as { fillIncludedInReview?: boolean }).fillIncludedInReview;
  } else report.trades.items[0].fillIncludedInReview = fillIncludedInReview;
  const client = new QueryClient();
  client.setQueryData(["daily-market-review"], report);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LearningPipeline)));
  client.clear();
  return html;
}

describe("daily review cutoff presentation", () => {
  it("explains a retained fill outside the statistics and the report cutoff", () => {
    const html = render(false);
    expect(html).toContain("该成交记录未计入本日统计");
    expect(html).toContain("均截至报告生成时刻");
    expect(html).toContain("600010");
  });
  it.each([true, undefined])("does not invent an exclusion for included or legacy rows: %s", (included) => {
    expect(render(included)).not.toContain("该成交记录未计入本日统计");
  });
});
