import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockMarket } from "../market/mockMarket";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { PaperBroker } from "../broker/paperBroker";
import { RiskEngine } from "../risk/riskEngine";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { TradingStore } from "../contracts/TradingStore";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";

const demoLimits: RiskLimits = {
  maxOrderNotional: 100_000,
  maxPositionWeight: 0.25,
  maxDailyLoss: 0.05,
  lotSize: 100,
  realTradingEnabled: false,
};

function makeMarket(): MockMarket {
  return new MockMarket("paper", 500);
}

function makeStore(): InMemoryTradingStore {
  return new InMemoryTradingStore(1_000_000);
}

describe("MarketDataProvider \u5951\u7ea6\u4e00\u81f4\u6027", () => {
  let market: MarketDataProvider;

  beforeEach(() => {
    market = makeMarket();
  });

  afterEach(() => {
    market.stop();
  });

  it("getSnapshot \u8fd4\u56de\u6709\u6548\u7684\u884c\u60c5\u5feb\u7167", () => {
    const snapshot = market.getSnapshot();

    expect(snapshot.mode).toBe("paper");
    expect(snapshot.sequence).toBeGreaterThan(0);
    expect(snapshot.quotes.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.marketTime).toBeTruthy();

    const quote = snapshot.quotes[0];
    expect(quote.symbol).toBeTruthy();
    expect(quote.name).toBeTruthy();
    expect(quote.price).toBeGreaterThan(0);
    expect(quote.previousClose).toBeGreaterThan(0);
    expect(typeof quote.tradable).toBe("boolean");
  });

  it("getQuote \u53ef\u4ee5\u6309\u4ee3\u7801\u67e5\u8be2\u5355\u53ea\u6807\u7684", () => {
    const quote = market.getQuote("600519");
    expect(quote).toBeDefined();
    expect(quote!.symbol).toBe("600519");
    expect(quote!.name).toBe("\u8d35\u5dde\u8305\u53f0");
  });

  it("getQuote \u5bf9\u4e0d\u5b58\u5728\u7684\u4ee3\u7801\u8fd4\u56de undefined", () => {
    expect(market.getQuote("999999")).toBeUndefined();
  });

  it("start \u540e\u6bcf tick \u66f4\u65b0 sequence", async () => {
    const before = market.getSnapshot().sequence;
    market.start();

    // \u7b49\u5f85\u81f3\u5c11 2 \u4e2a tick
    await new Promise<void>((resolve) => {
      const check = () => {
        const seq = market.getSnapshot().sequence;
        if (seq > before + 1) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    expect(market.getSnapshot().sequence).toBeGreaterThan(before + 1);
  });

  it("start \u5e42\u7b49\u8c03\u7528\u4e0d\u4f1a\u521b\u5efa\u591a\u4e2a\u5b9a\u65f6\u5668", () => {
    market.start();
    const seq = market.getSnapshot().sequence;
    market.start(); // \u7b2c\u4e8c\u6b21\u8c03\u7528
    // \u5e94\u8be5\u6ca1\u6709\u5f02\u5e38\uff0csequence \u4e0d\u5e94\u8df3\u53d8
    expect(market.getSnapshot().sequence).toBeGreaterThanOrEqual(seq);
  });

  it("stop \u540e\u4e0d\u518d\u89e6\u53d1 snapshot \u4e8b\u4ef6", async () => {
    let count = 0;
    market.on("snapshot", () => {
      count += 1;
    });
    market.start();

    // \u7b49\u5f85\u81f3\u5c11 1 tick
    await new Promise((resolve) => setTimeout(resolve, 600));
    market.stop();
    const afterStop = count;

    // \u7b49\u5f85\u8db3\u591f\u957f\u786e\u4fdd\u4e0d\u518d\u89e6\u53d1
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(count).toBe(afterStop);
  });
});

describe("TradingStore \u5951\u7ea6\u4e00\u81f4\u6027", () => {
  let store: TradingStore;
  let snapshot: MarketSnapshot;

  beforeEach(() => {
    store = makeStore();
    snapshot = makeMarket().getSnapshot();
  });

  it("\u521d\u59cb\u8d26\u6237\u53ef\u7528\u73b0\u91d1\u5927\u4e8e 0", () => {
    expect(store.getAvailableCash()).toBeGreaterThan(0);
    expect(store.getCash()).toBeGreaterThan(0);
    // \u521d\u59cb\u65e0\u51bb\u7ed3\u8d44\u91d1\u65f6\uff0c\u603b\u73b0\u91d1 == \u53ef\u7528\u73b0\u91d1
    // \u521b\u5efa\u9650\u4ef7\u5355\u540e\u53ef\u7528\u8d44\u91d1\u4f1a\u56e0\u51bb\u7ed3\u800c\u51cf\u5c11
  });

  it("getPositions \u8fd4\u56de\u9884\u8bbe\u6301\u4ed3", () => {
    const positions = store.getPositions(snapshot);
    expect(positions.length).toBeGreaterThanOrEqual(2);

    const moutai = positions.find((p) => p.symbol === "600519");
    expect(moutai).toBeDefined();
    expect(moutai!.quantity).toBe(100);
    expect(moutai!.averagePrice).toBe(1468.2);
  });

  it("getAccount \u8fd4\u56de\u5b8c\u6574\u7684\u8d26\u6237\u5feb\u7167", () => {
    const account = store.getAccount("paper", snapshot, demoLimits);

    expect(account.accountId).toBeTruthy();
    expect(account.mode).toBe("paper");
    expect(account.equity).toBeGreaterThan(0);
    expect(account.cash).toBeGreaterThan(0);
    expect(account.marketValue).toBeGreaterThan(0);
    expect(account.riskUtilization).toBeGreaterThanOrEqual(0);
    expect(account.riskUtilization).toBeLessThanOrEqual(1);
    expect(account.paused).toBe(false);
  });

  it("\u6682\u505c\u540e getAccount \u53cd\u6620\u6682\u505c\u72b6\u6001", () => {
    store.setPaused(true);
    const account = store.getAccount("paper", snapshot, demoLimits);
    expect(account.paused).toBe(true);
    expect(store.isPaused()).toBe(true);
  });

  it("createOrder \u2192 fillOrder \u540e\u6301\u4ed3\u548c\u73b0\u91d1\u66f4\u65b0", () => {
    const orderRequest = {
      symbol: "601318",
      side: "buy" as const,
      type: "market" as const,
      quantity: 100,
    };
    const cashBefore = store.getAvailableCash();

    const order = store.createOrder(orderRequest, 52.1);
    expect(order.status).toBe("accepted");
    expect(order.id).toBeTruthy();

    const filled = store.fillOrder(order, "\u4e2d\u56fd\u5e73\u5b89", 52.1, 15.63);
    expect(filled.status).toBe("filled");
    expect(filled.filledPrice).toBe(52.1);
    expect(filled.commission).toBe(15.63);

    // \u73b0\u91d1\u5e94\u51cf\u5c11
    expect(store.getAvailableCash()).toBeLessThan(cashBefore);

    // \u5e94\u65b0\u589e\u6301\u4ed3
    const positions = store.getPositions(snapshot);
    const pingan = positions.find((p) => p.symbol === "601318");
    expect(pingan).toBeDefined();
    expect(pingan!.quantity).toBe(100);
  });

  it("createOrder \u2192 cancelOrder \u64a4\u9500\u6302\u5355", () => {
    const orderRequest = {
      symbol: "600519",
      side: "buy" as const,
      type: "limit" as const,
      quantity: 100,
      limitPrice: 1480,
    };
    const cashBefore = store.getAvailableCash();

    const order = store.createOrder(orderRequest, 1492.6);
    expect(order.status).toBe("pending");

    // \u9650\u4ef7\u5355\u5e94\u51bb\u7ed3\u8d44\u91d1
    expect(store.getAvailableCash()).toBeLessThan(cashBefore);

    const cancelled = store.cancelOrder(order);
    expect(cancelled.status).toBe("cancelled");

    // \u64a4\u9500\u540e\u51bb\u7ed3\u8d44\u91d1\u91ca\u653e
    expect(store.getAvailableCash()).toBe(cashBefore);
  });

  it("rejectOrder \u6807\u8bb0\u62d2\u7edd\u5e76\u91ca\u653e\u51bb\u7ed3\u8d44\u91d1", () => {
    const orderRequest = {
      symbol: "300750",
      side: "sell" as const,
      type: "limit" as const,
      quantity: 100,
      limitPrice: 260,
    };
    const cashBefore = store.getAvailableCash();

    const order = store.createOrder(orderRequest, 253.4);
    expect(order.status).toBe("pending");

    const rejected = store.rejectOrder(order, "\u8d85\u51fa\u98ce\u63a7\u9650\u5236", "RISK_LIMIT");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("\u8d85\u51fa\u98ce\u63a7\u9650\u5236");
    expect(store.getAvailableCash()).toBe(cashBefore);
  });

  it("checkLimitOrderFill \u6b63\u786e\u5224\u65ad\u6210\u4ea4\u6761\u4ef6", () => {
    const buyLimit = store.createOrder(
      { symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1500 },
      1492.6,
    );

    // \u5e02\u4ef7\u4f4e\u4e8e\u9650\u4ef7\uff1a\u4e70\u5165\u9650\u4ef7\u5355\u5e94\u6210\u4ea4
    expect(store.checkLimitOrderFill(buyLimit, { symbol: "600519", name: "\u8d35\u5dde\u8305\u53f0", price: 1490 })).toBe(true);
    // \u5e02\u4ef7\u9ad8\u4e8e\u9650\u4ef7\uff1a\u4e70\u5165\u9650\u4ef7\u5355\u4e0d\u5e94\u6210\u4ea4
    expect(store.checkLimitOrderFill(buyLimit, { symbol: "600519", name: "\u8d35\u5dde\u8305\u53f0", price: 1510 })).toBe(false);

    const sellLimit = store.createOrder(
      { symbol: "600519", side: "sell", type: "limit", quantity: 100, limitPrice: 1500 },
      1492.6,
    );

    // \u5e02\u4ef7\u9ad8\u4e8e\u9650\u4ef7\uff1a\u5356\u51fa\u9650\u4ef7\u5355\u5e94\u6210\u4ea4
    expect(store.checkLimitOrderFill(sellLimit, { symbol: "600519", name: "\u8d35\u5dde\u8305\u53f0", price: 1510 })).toBe(true);
    // \u5e02\u4ef7\u4f4e\u4e8e\u9650\u4ef7\uff1a\u5356\u51fa\u9650\u4ef7\u5355\u4e0d\u5e94\u6210\u4ea4
    expect(store.checkLimitOrderFill(sellLimit, { symbol: "600519", name: "\u8d35\u5dde\u8305\u53f0", price: 1490 })).toBe(false);
  });

  it("findByClientOrderId \u5e42\u7b49\u68c0\u6d4b", () => {
    store.createOrder(
      { symbol: "600519", side: "buy", type: "market", quantity: 100, clientOrderId: "dup-001" },
      1492.6,
    );
    const dup = store.findByClientOrderId("dup-001");
    expect(dup).toBeDefined();
    expect(dup!.clientOrderId).toBe("dup-001");

    expect(store.findByClientOrderId("nonexistent")).toBeUndefined();
    expect(store.findByClientOrderId(undefined)).toBeUndefined();
  });

  it("listOrders / listAudit \u6309\u65f6\u95f4\u5012\u5e8f\u8fd4\u56de", () => {
    store.createOrder(
      { symbol: "600519", side: "buy", type: "market", quantity: 100 },
      1492.6,
    );
    store.createOrder(
      { symbol: "300750", side: "sell", type: "market", quantity: 100 },
      253.4,
    );

    const orders = store.listOrders();
    expect(orders.length).toBeGreaterThanOrEqual(2);
    // \u6700\u65b0\u7684\u5728\u524d
    expect(orders[0].symbol).toBe("300750");

    const audit = store.listAudit(10);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].id).toBeTruthy();
    expect(audit[0].category).toBeTruthy();
    expect(audit[0].timestamp).toBeTruthy();
  });
});

describe("PaperBroker \u4e0e\u5951\u7ea6\u7ec4\u5408", () => {
  it("\u4f7f\u7528 MarketDataProvider + TradingStore \u63a5\u53e3\u6b63\u5e38\u4e0b\u5355", () => {
    const market: MarketDataProvider = makeMarket();
    const store: TradingStore = makeStore();
    const risk = new RiskEngine(demoLimits);
    const broker = new PaperBroker(market, store, risk, {
      mode: "paper",
      commissionRate: 0.0003,
      minimumCommission: 5,
      slippageBps: 5,
      limits: demoLimits,
    });

    const order = broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
    });

    expect(order.status).toBe("filled");
    expect(order.filledPrice).toBeGreaterThan(0);

    market.stop();
  });

  it("\u9650\u4ef7\u5355\u901a\u8fc7\u63a5\u53e3\u6302\u5355\u548c\u64a4\u9500", () => {
    const market: MarketDataProvider = makeMarket();
    const store: TradingStore = makeStore();
    const risk = new RiskEngine(demoLimits);
    const broker = new PaperBroker(market, store, risk, {
      mode: "paper",
      commissionRate: 0.0003,
      minimumCommission: 5,
      slippageBps: 5,
      limits: demoLimits,
    });

    // 601318 \u4e2d\u56fd\u5e73\u5b89\uff0c\u65e0\u6301\u4ed3\uff0cquantity=100, limitPrice=900 \u2192 notional=90,000 \u901a\u8fc7\u98ce\u63a7
    const order = broker.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: 900,
    });

    expect(order.status).toBe("pending");

    const cancelled = broker.cancelOrder(order.id);
    expect(cancelled.status).toBe("cancelled");

    market.stop();
  });
});
