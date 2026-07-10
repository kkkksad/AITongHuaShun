import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RiskLimits } from "../../shared/trading";
import type {
  BrokerAdapter,
  BrokerAdapterConfig,
} from "../contracts/BrokerAdapter";
import { MockMarket } from "../market/mockMarket";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { MockBrokerAdapter } from "./MockBrokerAdapter";
import { PaperBroker } from "./paperBroker";

const config: BrokerAdapterConfig = {
  brokerId: "mock-broker",
  brokerName: "模拟券商网关",
  endpoint: "http://mock-broker.local",
  environment: "paper",
  heartbeatMs: 500,
};

const limits: RiskLimits = {
  maxOrderNotional: 2_000_000,
  maxPositionWeight: 0.25,
  maxDailyLoss: 0.05,
  lotSize: 100,
  realTradingEnabled: false,
};

function createStack() {
  const market = new MockMarket("paper", 500);
  const store = new InMemoryTradingStore(1_000_000);
  const risk = new RiskEngine(limits);
  const paperBroker = new PaperBroker(market, store, risk, {
    mode: "paper",
    commissionRate: 0.0003,
    minimumCommission: 5,
    slippageBps: 5,
    limits,
  });
  const adapter = new MockBrokerAdapter(config, paperBroker);

  return { adapter, market, paperBroker };
}

describe("MockBrokerAdapter", () => {
  let adapter: MockBrokerAdapter;
  let market: MockMarket;

  beforeEach(() => {
    ({ adapter, market } = createStack());
  });

  afterEach(async () => {
    market.stop();
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  it("管理连接生命周期并发送状态事件", async () => {
    const states: boolean[] = [];
    adapter.on("connection.status", (status) => states.push(status.connected));

    expect(adapter.isConnected()).toBe(false);
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();

    expect(states).toEqual([true, false]);
  });

  it("重复连接保持幂等", async () => {
    await adapter.connect();
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it("未连接时拒绝订单操作", async () => {
    await expect(
      adapter.submitOrder({
        symbol: "300750",
        side: "buy",
        type: "market",
        quantity: 100,
      }),
    ).rejects.toThrow("not connected");
    await expect(adapter.cancelOrder("missing")).rejects.toThrow("not connected");
  });

  it("委托 PaperBroker 完成市价单并转发事件", async () => {
    await adapter.connect();
    const statuses: string[] = [];
    let accountUpdated = false;
    adapter.on("order.updated", (order) => statuses.push(order.status));
    adapter.on("account.updated", () => {
      accountUpdated = true;
    });

    const order = await adapter.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 100,
    });

    expect(order.status).toBe("filled");
    expect(statuses).toContain("filled");
    expect(accountUpdated).toBe(true);
  });

  it("委托 PaperBroker 保留不可成交限价单", async () => {
    await adapter.connect();
    const quote = market.getQuote("601318");
    const order = await adapter.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: (quote?.price ?? 100) - 20,
    });

    expect(order.status).toBe("pending");
  });

  it("撤销挂单并更新订单状态", async () => {
    await adapter.connect();
    const quote = market.getQuote("601318");
    const order = await adapter.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice: (quote?.price ?? 100) - 20,
    });

    const cancelled = await adapter.cancelOrder(order.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("保留 clientOrderId 幂等语义", async () => {
    await adapter.connect();
    const request = {
      symbol: "300750",
      side: "buy" as const,
      type: "market" as const,
      quantity: 100,
      clientOrderId: "adapter-idempotency-1",
    };

    const first = await adapter.submitOrder(request);
    const second = await adapter.submitOrder(request);
    expect(second.id).toBe(first.id);
  });

  it("不会绕过 RiskEngine 的单笔金额限制", async () => {
    await adapter.connect();
    const order = await adapter.submitOrder({
      symbol: "300750",
      side: "buy",
      type: "market",
      quantity: 10_000,
    });

    expect(order.status).toBe("rejected");
    expect(order.rejectionReason).toMatch(/单笔|金额|上限/);
  });

  it("行情触价时通过 PaperBroker 撮合挂单", async () => {
    await adapter.connect();
    const quote = market.getQuote("601318");
    const limitPrice = (quote?.price ?? 100) - 20;
    const order = await adapter.submitOrder({
      symbol: "601318",
      side: "buy",
      type: "limit",
      quantity: 100,
      limitPrice,
    });
    const snapshot = market.getSnapshot();
    const triggeredSnapshot = {
      ...snapshot,
      quotes: snapshot.quotes.map((candidate) =>
        candidate.symbol === "601318"
          ? { ...candidate, price: limitPrice - 1 }
          : candidate,
      ),
    };

    await adapter.checkPendingOrders(triggeredSnapshot);
    const updated = (await adapter.getOrders()).find(
      (candidate) => candidate.id === order.id,
    );

    expect(updated?.status).toBe("filled");
  });

  it("查询账户、持仓和订单使用 PaperBroker 状态", async () => {
    await adapter.connect();
    const account = await adapter.getAccount();
    const positions = await adapter.getPositions();
    const orders = await adapter.getOrders();

    expect(account.mode).toBe("paper");
    expect(account.equity).toBeGreaterThan(0);
    expect(positions.length).toBeGreaterThan(0);
    expect(orders).toEqual([]);
  });

  it("模拟适配器在构造阶段拒绝实盘环境", () => {
    const { paperBroker } = createStack();

    expect(
      () =>
        new MockBrokerAdapter(
          { ...config, environment: "live" },
          paperBroker,
        ),
    ).toThrow("禁止实盘");
  });

  it("满足 BrokerAdapter 契约", () => {
    const contract: BrokerAdapter = adapter;

    expect(typeof contract.connect).toBe("function");
    expect(typeof contract.disconnect).toBe("function");
    expect(typeof contract.submitOrder).toBe("function");
    expect(typeof contract.cancelOrder).toBe("function");
    expect(typeof contract.getOrders).toBe("function");
    expect(typeof contract.getPositions).toBe("function");
    expect(typeof contract.getAccount).toBe("function");
  });
});
