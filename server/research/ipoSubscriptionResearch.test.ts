import { describe, expect, it, vi } from "vitest";
import {
  buildIpoSubscriptionResearch,
  type BridgeIpoSubscriptionItem,
} from "./ipoSubscriptionResearch";

const now = new Date("2026-07-16T12:00:00+08:00");

function bridgeItem(
  overrides: Partial<BridgeIpoSubscriptionItem> = {},
): BridgeIpoSubscriptionItem {
  return {
    symbol: "688001",
    name: "低估值样本",
    subscriptionCode: "787001",
    exchange: "上海证券交易所",
    board: "科创板",
    issueTotalWanShares: 5_000,
    onlineIssueShares: 12_000_000,
    marketValueRequirementWan: 10,
    maxSubscriptionShares: 10_000,
    issuePrice: 20,
    latestPrice: null,
    subscriptionDate: "2026-07-16",
    ballotDate: "2026-07-20",
    paymentDate: "2026-07-20",
    listingDate: null,
    issuePe: 20,
    industryPe: 30,
    winningRate: null,
    firstDayChangePercent: null,
    ...overrides,
  };
}

function response(items: BridgeIpoSubscriptionItem[]): Response {
  return new Response(JSON.stringify({
    provider: "akshare",
    source: "eastmoney-ipo-subscription",
    fetchedAt: "2026-07-16T04:00:00Z",
    items,
    warning: null,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function build(items: BridgeIpoSubscriptionItem[]) {
  return buildIpoSubscriptionResearch({
    bridgeUrl: "http://127.0.0.1:8800",
    bridgeToken: "bridge-token",
    marketDataProvider: "akshare",
    mode: "paper",
    timeoutMs: 5_000,
    limit: 40,
    now: () => now,
    fetchImpl: vi.fn().mockResolvedValue(response(items)),
  });
}

describe("buildIpoSubscriptionResearch", () => {
  it("classifies open, upcoming, awaiting-listing, and recently-listed records", async () => {
    const report = await build([
      bridgeItem(),
      bridgeItem({
        symbol: "603002",
        subscriptionCode: "732002",
        name: "即将申购",
        board: "非科创板",
        subscriptionDate: "2026-07-20",
      }),
      bridgeItem({
        symbol: "603003",
        subscriptionCode: "732003",
        name: "等待上市",
        board: "非科创板",
        subscriptionDate: "2026-07-10",
      }),
      bridgeItem({
        symbol: "603004",
        subscriptionCode: "732004",
        name: "近期上市",
        board: "非科创板",
        subscriptionDate: "2026-07-01",
        listingDate: "2026-07-15",
        latestPrice: 25,
        firstDayChangePercent: 25,
      }),
    ]);

    expect(report.items.map((item) => [item.symbol, item.status])).toEqual([
      ["688001", "open-today"],
      ["603002", "upcoming"],
      ["603003", "awaiting-listing"],
      ["603004", "listed-recently"],
    ]);
    expect(report.counts).toEqual({
      openToday: 1,
      upcoming: 1,
      awaitingListing: 1,
      listedRecently: 1,
    });
  });

  it("uses issue-time valuation fields for transparent recommendations", async () => {
    const report = await build([
      bridgeItem(),
      bridgeItem({
        symbol: "688002",
        subscriptionCode: "787002",
        name: "高估值样本",
        issuePrice: 80,
        issuePe: 80,
        industryPe: 30,
      }),
      bridgeItem({
        symbol: "603005",
        subscriptionCode: "732005",
        name: "等待定价",
        board: "非科创板",
        subscriptionDate: "2026-07-20",
        issuePrice: null,
        issuePe: null,
      }),
      bridgeItem({
        symbol: "603006",
        subscriptionCode: "732006",
        name: "已经结束",
        board: "非科创板",
        subscriptionDate: "2026-07-10",
      }),
    ]);

    expect(report.items.find((item) => item.symbol === "688001")).toMatchObject({
      status: "open-today",
      recommendation: "consider",
      score: 75,
    });
    expect(report.items.find((item) => item.symbol === "688002")).toMatchObject({
      recommendation: "avoid",
      score: 7,
    });
    expect(report.items.find((item) => item.symbol === "603005")).toMatchObject({
      recommendation: "wait-for-pricing",
      score: null,
    });
    expect(
      report.items.find((item) => item.symbol === "603005")?.risks.join(" "),
    ).not.toContain("科创板申购需要");
    expect(report.items.find((item) => item.symbol === "603006")).toMatchObject({
      recommendation: "closed",
      score: null,
    });
    expect(report.guardrails.join(" ")).toContain("不使用上市后涨幅反推申购建议");
  });

  it("returns an explicit degraded report when the bridge is unavailable", async () => {
    const report = await buildIpoSubscriptionResearch({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "akshare",
      mode: "paper",
      timeoutMs: 5_000,
      now: () => now,
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
    });

    expect(report.sourceStatus).toBe("degraded");
    expect(report.items).toEqual([]);
    expect(report.warning).toContain("暂不可用");
  });

  it("does not substitute static IPO data when AkShare is disabled", async () => {
    const fetchImpl = vi.fn();
    const report = await buildIpoSubscriptionResearch({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "mock",
      mode: "paper",
      timeoutMs: 5_000,
      now: () => now,
      fetchImpl,
    });

    expect(report.sourceStatus).toBe("mock-disabled");
    expect(report.items).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
