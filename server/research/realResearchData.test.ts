import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { clearBridgeRequestCache } from "./bridgeRequest";
import {
  buildRealResearchDataFeed,
  selectNewsSymbols,
} from "./realResearchData";

const snapshot: MarketSnapshot = {
  mode: "paper",
  sequence: 1,
  marketTime: "2026-07-19T01:30:00.000Z",
  quotes: [
    {
      symbol: "SH000300",
      name: "沪深300",
      tradable: false,
      price: 4000,
      previousClose: 3980,
      changePercent: 0.5,
      volume: 1,
      updatedAt: "2026-07-19T01:30:00.000Z",
    },
    {
      symbol: "600519",
      name: "贵州茅台",
      tradable: true,
      price: 1600,
      previousClose: 1580,
      changePercent: 1.2,
      volume: 10,
      amount: 1_000,
      updatedAt: "2026-07-19T01:30:00.000Z",
    },
    {
      symbol: "000001",
      name: "平安银行",
      tradable: true,
      price: 12,
      previousClose: 12.1,
      changePercent: -0.8,
      volume: 1_000,
      amount: 5_000,
      updatedAt: "2026-07-19T01:30:00.000Z",
    },
    {
      symbol: "300750",
      name: "宁德时代",
      tradable: true,
      price: 300,
      previousClose: 295,
      changePercent: 1.7,
      volume: 500,
      amount: 3_000,
      updatedAt: "2026-07-19T01:30:00.000Z",
    },
  ],
};

describe("bounded multi-source real research news", () => {
  beforeEach(() => clearBridgeRequestCache());

  it("prioritizes current holdings before liquid snapshot symbols", () => {
    expect(selectNewsSymbols(snapshot, ["600519", "999999"], 3)).toEqual([
      "600519",
      "999999",
      "000001",
    ]);
  });

  it("requests 80 bounded news items and deduplicates old bridge payloads", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const requested = String(url);
      if (requested.includes("/api/research/news")) {
        return new Response(JSON.stringify({
          provider: "akshare",
          source: "multi-source-financial-news",
          fetchedAt: "2026-07-19T01:30:00.000Z",
          requestedSymbols: ["600519", "000001", "300750"],
          rawCount: 6,
          availableCount: 5,
          deduplicatedCount: 1,
          sources: [
            { source: "证券时报", category: "company", itemCount: 1 },
            { source: "财新数据通", category: "market", itemCount: 1 },
            { source: "央视新闻联播", category: "macro", itemCount: 2 },
          ],
          items: [
            {
              id: "company-1",
              source: "证券时报",
              title: "贵州茅台上调产品价格",
              publishedAt: "2026-07-19T09:30:00+08:00",
              fetchedAt: "2026-07-19T01:30:00.000Z",
              url: "https://example.com/1?from=a",
              symbols: ["600519"],
              sentiment: "positive",
              summary: "价格调整公告",
              category: "company",
            },
            {
              id: "company-duplicate",
              source: "财联社",
              title: "贵州茅台上调产品价格",
              publishedAt: "2026-07-19T09:29:00+08:00",
              fetchedAt: "2026-07-19T01:30:00.000Z",
              url: "https://example.com/1?from=b",
              symbols: ["600519"],
              sentiment: "positive",
              summary: null,
              category: "company",
            },
            {
              id: "market-1",
              source: "财新数据通",
              title: "全球能源市场变化",
              publishedAt: "2026-07-19T00:00:00+08:00",
              fetchedAt: "2026-07-19T01:30:00.000Z",
              url: "https://example.com/2",
              symbols: [],
              sentiment: "neutral",
              summary: null,
              category: "market",
            },
            {
              id: "macro-1",
              source: "央视新闻联播",
              title: "宏观新闻一",
              publishedAt: "2026-07-18T00:00:00+08:00",
              fetchedAt: "2026-07-19T01:30:00.000Z",
              url: "https://tv.cctv.com/lm/xwlb/day/20260718.shtml",
              symbols: [],
              sentiment: "neutral",
              summary: null,
              category: "macro",
            },
            {
              id: "macro-2",
              source: "央视新闻联播",
              title: "宏观新闻二",
              publishedAt: "2026-07-18T00:00:00+08:00",
              fetchedAt: "2026-07-19T01:30:00.000Z",
              url: "https://tv.cctv.com/lm/xwlb/day/20260718.shtml",
              symbols: [],
              sentiment: "neutral",
              summary: null,
              category: "macro",
            },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        provider: "akshare",
        fetchedAt: "2026-07-19T01:30:00.000Z",
        markets: [],
        warning: "全球市场测试中不可用",
      }), { status: 200 });
    });

    const report = await buildRealResearchDataFeed({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "akshare",
      mode: "paper",
      snapshot,
      preferredSymbols: ["600519"],
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const newsCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("/api/research/news"),
    );
    expect(newsCall).toBeDefined();
    const newsUrl = new URL(String(newsCall![0]));
    expect(newsUrl.pathname).toBe("/api/research/news");
    expect(newsUrl.searchParams.get("limit")).toBe("80");
    expect(newsUrl.searchParams.get("symbols")).toBe("600519,000001,300750");
    expect(report.news.items).toHaveLength(4);
    expect(report.news.items[0].symbols).toContain("600519");
    expect(report.news.requestedSymbols).toEqual(["600519", "000001", "300750"]);
    expect(report.news.rawCount).toBe(6);
    expect(report.news.availableCount).toBe(4);
    expect(report.news.deduplicatedCount).toBe(2);
    expect(report.news.sources).toHaveLength(3);
  });

  it("uses a bounded news-only request without waiting for global markets", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const requested = new URL(String(url));
      expect(requested.pathname).toBe("/api/research/news");
      expect(requested.searchParams.get("limit")).toBe("20");
      expect(requested.searchParams.get("symbols")).toBe("000001,300750");
      return new Response(JSON.stringify({
        provider: "akshare",
        source: "multi-source-financial-news",
        fetchedAt: "2026-08-08T02:00:00.000Z",
        requestedSymbols: ["000001", "300750"],
        rawCount: 1,
        availableCount: 1,
        deduplicatedCount: 0,
        sources: [{ source: "财联社", category: "market", itemCount: 1 }],
        items: [{
          id: "market-1",
          source: "财联社",
          title: "A股市场新闻",
          publishedAt: "2026-08-08T09:50:00+08:00",
          fetchedAt: "2026-08-08T02:00:00.000Z",
          url: "https://example.com/news-1",
          symbols: [],
          sentiment: "neutral",
          summary: null,
          category: "market",
        }],
        warning: null,
      }), { status: 200 });
    });

    const report = await buildRealResearchDataFeed({
      bridgeUrl: "http://127.0.0.1:8800",
      marketDataProvider: "akshare",
      mode: "paper",
      snapshot,
      timeoutMs: 1_000,
      newsItemLimit: 20,
      newsSymbolLimit: 2,
      includeGlobalMarkets: false,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(report.sourceStatus).toBe("live-read-only");
    expect(report.news.items).toHaveLength(1);
    expect(report.globalMarkets.markets).toEqual([]);
    expect(report.impact.summary).toContain("轻量新闻快照");
  });
});
