import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { buildDailyMarketReview } from "../../server/research/dailyMarketReview";
import type { AuditEvent } from "../../shared/trading";
import LearningPipeline from "./LearningPipeline";

function render(state: "full" | "empty" | "legacy" | "unknown") {
  const now = new Date("2026-11-11T08:00:00Z");
  const funnel = { scope: "ranked-top-12", scannerCandidateCount: 59, consideredCandidateCount: 12,
    existingPositionCount: 3, newSymbolCount: 9, eligibleNewSymbolCount: 1,
    individuallySizedNewSymbolCount: 0, plannedBuyCount: 0, allowNewPositions: true };
  const events: AuditEvent[] = state === "empty" ? [] : Array.from({ length: state === "full" ? 225 : 1 }, (_, i) => ({
    id: `fixture-${i}`, category: "system", action: "paper-auto-execution.run", message: "fixture",
    timestamp: new Date(Date.parse("2026-11-11T01:31:00Z") + i * 1000).toISOString(),
    data: { session: "open", tradingDate: "2026-11-11", regime: "range-high-volatility",
      sourceStatus: "live-read-only", planQuality: "blocked",
      strategyCoverage: state === "unknown" || i === 224 ? null : { newPositionFunnel: { ...funnel,
        ...(i < 45 ? { allowNewPositions: false } : i < 193 ? { eligibleNewSymbolCount: 0 } :
          i === 223 ? { individuallySizedNewSymbolCount: 1 } : {}) } } },
  }));
  const report = buildDailyMarketReview({
    now, provider: "mock", positions: [], orders: [], auditEvents: events,
    snapshot: { mode: "paper", sequence: 0, marketTime: now.toISOString(), quotes: [] },
    account: { accountId: "fixture", mode: "paper", cash: 13992, equity: 13992, marketValue: 0,
      unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
      riskUtilization: 0, paused: false, updatedAt: now.toISOString() },
  });
  if (state === "legacy") delete report.entryReview.coverage;
  const client = new QueryClient();
  client.setQueryData(["daily-market-review"], report);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LearningPipeline)));
  client.clear(); return html;
}

describe("daily retained entry coverage presentation", () => {
  it("shows recorded daily stage counts with the retained-run limitation", () => {
    const html = render("full");
    expect(html).toContain("当日保留盘中运行分布");
    expect(html).toContain("盘中记录 225 条");
    expect(html).toContain("有效漏斗 224 条");
    expect(html).toContain("漏斗未知 1 条");
    expect(html).toContain("全局新增许可关闭：45");
    expect(html).toContain("新标的无策略资格：148");
    expect(html).toContain("资格通过但无独立整手：30");
    expect(html).toContain("整手覆盖后无拟买：1");
    expect(html).toContain("已形成拟买计划：0");
    expect(html).toContain("不代表完整定时覆盖、独立信号数或成交数");
    expect(html).toContain("最早/最晚保留盘中记录");
  });
  it("does not convert missing old coverage into zeros", () => {
    const html = render("legacy");
    expect(html).not.toContain("当日保留盘中运行分布");
    expect(html).not.toContain("盘中记录 0 条");
  });
  it("explains zero retained coverage without claiming no intraday opportunities", () => {
    const html = render("empty");
    expect(html).toContain("盘中记录 0 条");
    expect(html).toContain("没有保留盘中运行，原因分布未知");
    expect(html).not.toContain("最早/最晚保留盘中记录");
  });
  it("keeps a bad funnel unknown and avoids implying zero strategy opportunities", () => {
    const html = render("unknown");
    expect(html).toContain("有效漏斗 0 条");
    expect(html).toContain("漏斗未知 1 条");
    expect(html).toContain("盘中记录均缺少有效漏斗，原因分布未知");
    expect(html).not.toContain("新标的无策略资格：0");
  });
});
