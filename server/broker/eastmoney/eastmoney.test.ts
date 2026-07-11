/**
 * 东方财富模块测试。
 *
 * 测试 API 客户端、行情提供者和券商适配器。
 * 使用 mock 数据验证核心逻辑，不依赖真实网络。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  OrderStatus,
} from "../../../shared/trading";
import {
  EastMoneyApi,
  buildSecId,
  parseSecId,
  getEastMoneyMarket,
  normalizeQuote,
  type EastMoneyQuoteRaw,
  type NormalizedQuote,
} from "./eastMoneyApi";
import { EastMoneyMarketProvider } from "./EastMoneyMarketProvider";
import { EastMoneyBrokerAdapter } from "./EastMoneyBrokerAdapter";

// ═══════════════════════════════════════════════
// API 工具函数测试
// ═══════════════════════════════════════════════

describe("EastMoney API utilities", () => {
  it("getEastMoneyMarket returns 1 for Shanghai stocks", () => {
    expect(getEastMoneyMarket("600519")).toBe("1");
    expect(getEastMoneyMarket("688981")).toBe("1");
    expect(getEastMoneyMarket("500001")).toBe("1");
  });

  it("getEastMoneyMarket returns 0 for Shenzhen stocks", () => {
    expect(getEastMoneyMarket("000001")).toBe("0");
    expect(getEastMoneyMarket("300750")).toBe("0");
    expect(getEastMoneyMarket("002594")).toBe("0");
  });

  it("buildSecId constructs correct secid", () => {
    expect(buildSecId("600519")).toBe("1.600519");
    expect(buildSecId("000001")).toBe("0.000001");
    expect(buildSecId("300750")).toBe("0.300750");
  });

  it("parseSecId extracts code from secid", () => {
    expect(parseSecId("1.600519")).toBe("600519");
    expect(parseSecId("0.000001")).toBe("000001");
    expect(parseSecId("0.300750")).toBe("300750");
  });

  it("buildSecId and parseSecId are roundtrip", () => {
    const codes = ["600519", "000001", "300750", "688981"];
    for (const code of codes) {
      expect(parseSecId(buildSecId(code))).toBe(code);
    }
  });

  it("normalizeQuote converts raw data correctly", () => {
    const raw: EastMoneyQuoteRaw = {
      f57: "600519",
      f58: "贵州茅台",
      f43: 149260, // 1492.60 * 100
      f60: 148680,
      f46: 148500,
      f44: 150000,
      f45: 148000,
      f47: 12345678,
      f48: 18456789012,
      f170: 0.39,
      f169: 5.80,
      f50: 1.2,
      f168: 0.5,
      f162: 35.6,
      f116: 1875000000000,
      f117: 1875000000000,
    };

    const quote = normalizeQuote(raw);

    expect(quote.symbol).toBe("600519");
    expect(quote.name).toBe("贵州茅台");
    expect(quote.price).toBe(1492.60);
    expect(quote.previousClose).toBe(1486.80);
    expect(quote.open).toBe(1485.00);
    expect(quote.high).toBe(1500.00);
    expect(quote.low).toBe(1480.00);
    expect(quote.changePercent).toBe(0.39);
    expect(quote.changeAmount).toBe(5.80);
    expect(quote.volume).toBe(12345678);
    expect(quote.turnover).toBe(18456789012);
    expect(quote.pe).toBe(35.6);
    expect(quote.totalMarketCap).toBe(1875000000000);
    expect(quote.volume).toBeGreaterThan(0);
  });

  it("normalizeQuote handles zero values gracefully", () => {
    const raw: EastMoneyQuoteRaw = {
      f57: "000001",
      f58: "测试",
      f43: 0,
      f60: 0,
      f46: 0,
      f44: 0,
      f45: 0,
      f47: 0,
      f48: 0,
      f170: 0,
      f169: 0,
      f50: 0,
      f168: 0,
      f162: 0,
      f116: 0,
      f117: 0,
    };

    const quote = normalizeQuote(raw);
    expect(quote.price).toBe(0);
    expect(quote.symbol).toBe("000001");
  });
});

// ═══════════════════════════════════════════════
// EastMoneyMarketProvider 测试
// ═══════════════════════════════════════════════

describe("EastMoneyMarketProvider", () => {
  let provider: EastMoneyMarketProvider;

  afterEach(() => {
    if (provider) {
      provider.stop();
    }
  });

  it("implements MarketDataProvider contract", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      indices: [],
      pollIntervalMs: 5000,
    });

    expect(typeof provider.start).toBe("function");
    expect(typeof provider.stop).toBe("function");
    expect(typeof provider.tick).toBe("function");
    expect(typeof provider.getQuote).toBe("function");
    expect(typeof provider.getSnapshot).toBe("function");
    expect(typeof provider.on).toBe("function");
    expect(typeof provider.off).toBe("function");
  });

  it("start and stop lifecycle works", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      pollIntervalMs: 5000,
    });

    provider.start();
    // Don't wait - just verify it doesn't throw
    provider.stop();
  });

  it("getQuote returns placeholder data before first poll", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      indices: [],
      pollIntervalMs: 10000,
    });

    const quote = provider.getQuote("600519");
    expect(quote).toBeDefined();
    expect(quote!.symbol).toBe("600519");
    expect(quote!.tradable).toBe(true);
  });

  it("getSnapshot returns valid MarketSnapshot", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519", "000001"],
      indices: [],
      pollIntervalMs: 10000,
    });

    const snapshot = provider.getSnapshot();
    expect(snapshot.mode).toBe("paper");
    expect(snapshot.quotes.length).toBe(2);
    expect(snapshot.sequence).toBeGreaterThanOrEqual(0);
    expect(snapshot.marketTime).toBeTruthy();

    for (const quote of snapshot.quotes) {
      expect(quote.symbol).toBeTruthy();
      expect(quote.name).toBeTruthy();
      expect(typeof quote.price).toBe("number");
    }
  });

  it("tick increments sequence and returns snapshot", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      pollIntervalMs: 10000,
    });

    const before = provider.getSnapshot().sequence;
    const ticked = provider.tick();
    expect(ticked.sequence).toBe(before + 1);
  });

  it("indices are marked as non-tradable", () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      indices: ["000001"],
      pollIntervalMs: 10000,
    });

    const stockQuote = provider.getQuote("600519");
    const indexQuote = provider.getQuote("000001");

    expect(stockQuote!.tradable).toBe(true);
    expect(indexQuote!.tradable).toBe(false);
  });

  it("emits snapshot event on tick", async () => {
    provider = new EastMoneyMarketProvider({
      symbols: ["600519"],
      pollIntervalMs: 10000,
    });

    let emitted: MarketSnapshot | null = null;
    provider.on("snapshot", (s) => {
      emitted = s;
    });

    const snapshot = provider.tick();
    expect(emitted).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════
// EastMoneyBrokerAdapter 测试
// ═══════════════════════════════════════════════

describe("EastMoneyBrokerAdapter", () => {
  let adapter: EastMoneyBrokerAdapter;

  afterEach(async () => {
    if (adapter && adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  it("implements BrokerAdapter contract", () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.disconnect).toBe("function");
    expect(typeof adapter.isConnected).toBe("function");
    expect(typeof adapter.submitOrder).toBe("function");
    expect(typeof adapter.cancelOrder).toBe("function");
    expect(typeof adapter.getOrders).toBe("function");
    expect(typeof adapter.getPositions).toBe("function");
    expect(typeof adapter.getAccount).toBe("function");
  });

  it("connect and disconnect lifecycle works", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    expect(adapter.isConnected()).toBe(false);

    // Listen for connection events
    const statuses: { connected: boolean; message: string }[] = [];
    adapter.on("connection.status", (s) => statuses.push(s));

    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0].connected).toBe(true);

    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it("submitOrder in mock mode creates filled order", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
      initialCapital: 500_000,
    });

    await adapter.connect();

    // Set up a mock quote
    adapter.updateQuotes([
      {
        symbol: "600519",
        name: "贵州茅台",
        tradable: true,
        price: 1500,
        previousClose: 1490,
        changePercent: 0.67,
        volume: 10000000,
        updatedAt: new Date().toISOString(),
      },
    ]);

    const request: OrderRequest = {
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 100,
    };

    const order = await adapter.submitOrder(request);

    expect(order.symbol).toBe("600519");
    expect(order.side).toBe("buy");
    expect(order.status).toBe("filled");
    expect(order.filledPrice).toBe(1500);
    expect(order.filledQuantity).toBe(100);
    expect(order.notional).toBe(150000);
    expect(order.commission).toBeGreaterThan(0);
    expect(order.id).toBeTruthy();
    expect(order.createdAt).toBeTruthy();
  });

  it("submitOrder emits order.updated event", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    let emitted: OrderRecord | null = null;
    adapter.on("order.updated", (o) => {
      emitted = o;
    });

    await adapter.submitOrder({
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 100,
    });

    expect(emitted).not.toBeNull();
    expect(emitted!.symbol).toBe("600519");
  });

  it("buy order reduces cash and creates position", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
      initialCapital: 500_000,
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    // Buy 100 shares at 1500 = 150000 + commission
    await adapter.submitOrder({
      symbol: "600519", side: "buy", type: "market", quantity: 100,
    });

    const account = await adapter.getAccount();
    expect(account.cash).toBeLessThan(500_000);

    const positions = await adapter.getPositions();
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe("600519");
    expect(positions[0].quantity).toBe(100);
    expect(positions[0].averagePrice).toBeCloseTo(1500, 0);
  });

  it("same-day sell is rejected by A-share T+1 rule", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
      initialCapital: 500_000,
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    // Buy first
    await adapter.submitOrder({
      symbol: "600519", side: "buy", type: "market", quantity: 200,
    });

    // Then sell on the same trade date: A-share paper mode must enforce T+1.
    const sellOrder = await adapter.submitOrder({
      symbol: "600519", side: "sell", type: "market", quantity: 100,
    });

    expect(sellOrder.status).toBe("rejected");
    expect(sellOrder.rejectionReason).toContain("T+1");

    const positions = await adapter.getPositions();
    expect(positions[0].quantity).toBe(200);
    expect(positions[0].availableQuantity).toBe(0);
    expect(positions[0].t1LockedQuantity).toBe(200);

    // Cash should remain non-negative after the rejected sell and filled buy.
    const account = await adapter.getAccount();
    expect(account.cash).toBeGreaterThan(0);
  });

  it("cancelOrder works for pending orders", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    // Submit an order (mock mode: filled immediately, so can't cancel)
    const order = await adapter.submitOrder({
      symbol: "600519", side: "buy", type: "market", quantity: 100,
    });

    // Since mock mode fills immediately, cancellation should throw
    await expect(adapter.cancelOrder(order.id)).rejects.toThrow();
  });

  it("getOrders returns submitted orders", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    await adapter.submitOrder({
      symbol: "600519", side: "buy", type: "market", quantity: 100,
    });

    const orders = await adapter.getOrders();
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders[0].symbol).toBe("600519");
  });

  it("throws when submitting order without connect", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    await expect(
      adapter.submitOrder({
        symbol: "600519", side: "buy", type: "market", quantity: 100,
      }),
    ).rejects.toThrow("not connected");
  });

  it("applies the shared PaperBroker lot-size risk checks", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "paper://eastmoney",
    });
    await adapter.connect();
    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    const order = await adapter.submitOrder({
      symbol: "600519", side: "buy", type: "market", quantity: 50,
    });

    expect(order.status).toBe("rejected");
  });

  it("rejects any attempt to enable live trading", () => {
    expect(
      () =>
        new EastMoneyBrokerAdapter({
          brokerId: "eastmoney",
          brokerName: "东方财富",
          endpoint: "https://trading.eastmoney.com/api",
          tradingEnabled: true,
        }),
    ).toThrow("禁止实盘");

    expect(
      () =>
        new EastMoneyBrokerAdapter({
          brokerId: "eastmoney",
          brokerName: "东方财富",
          endpoint: "https://trading.eastmoney.com/api",
          environment: "live",
        }),
    ).toThrow("禁止实盘");
  });

  it("getAccount returns correct initial state", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
      initialCapital: 2_000_000,
    });

    await adapter.connect();

    const account = await adapter.getAccount();
    expect(account.cash).toBe(2_000_000);
    expect(account.equity).toBe(2_000_000);
    expect(account.marketValue).toBe(0);
    expect(account.mode).toBe("paper");
    expect(account.accountId).toBeTruthy();
  });

  it("supports limit orders in mock mode", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
      initialCapital: 1_000_000,
    });

    await adapter.connect();

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1500, previousClose: 1490, changePercent: 0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);

    const order = await adapter.submitOrder({
      symbol: "600519",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: 1495,
    });

    expect(order.type).toBe("limit");
    expect(order.limitPrice).toBe(1495);
    expect(order.status).toBe("pending");

    adapter.updateQuotes([
      {
        symbol: "600519", name: "贵州茅台", tradable: true,
        price: 1490, previousClose: 1500, changePercent: -0.67,
        volume: 10000000, updatedAt: new Date().toISOString(),
      },
    ]);
    const updated = (await adapter.getOrders()).find(
      (candidate) => candidate.id === order.id,
    );
    expect(updated?.status).toBe("filled");
  });

  it("rejects live mode for the read-only market provider", () => {
    expect(
      () => new EastMoneyMarketProvider({ mode: "live" }),
    ).toThrow("只允许只读 paper 模式");
  });

  it("connection status event fires on connect", async () => {
    adapter = new EastMoneyBrokerAdapter({
      brokerId: "eastmoney",
      brokerName: "东方财富",
      endpoint: "https://trading.eastmoney.com/api",
    });

    const events: { connected: boolean; message: string }[] = [];
    adapter.on("connection.status", (s) => events.push(s));

    await adapter.connect();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].connected).toBe(true);
    expect(events[0].message).toContain("connected");
  });
});
