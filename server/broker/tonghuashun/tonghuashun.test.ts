import { afterEach, describe, expect, it } from "vitest";
import type { BrokerAdapter } from "../../contracts/BrokerAdapter";
import type { MarketQuote, OrderRecord, OrderRequest } from "../../../shared/trading";
import { TongHuaShunPaperAdapter } from "./TongHuaShunPaperAdapter";

const quote: MarketQuote = {
  symbol: "600519",
  name: "贵州茅台",
  tradable: true,
  price: 1500,
  previousClose: 1490,
  changePercent: 0.67,
  volume: 10_000_000,
  updatedAt: new Date().toISOString(),
};

function createAdapter(initialCapital = 500_000): TongHuaShunPaperAdapter {
  return new TongHuaShunPaperAdapter({
    brokerId: "tonghuashun-sim",
    brokerName: "同花顺模拟盘",
    endpoint: "paper://tonghuashun-sim",
    initialCapital,
  });
}

describe("TongHuaShunPaperAdapter", () => {
  let adapter: TongHuaShunPaperAdapter | undefined;

  afterEach(async () => {
    if (adapter?.isConnected()) {
      await adapter.disconnect();
    }
  });

  it("implements BrokerAdapter contract", () => {
    adapter = createAdapter();
    const contract: BrokerAdapter = adapter;

    expect(typeof contract.connect).toBe("function");
    expect(typeof contract.disconnect).toBe("function");
    expect(typeof contract.submitOrder).toBe("function");
    expect(typeof contract.getAccount).toBe("function");
  });

  it("connect and disconnect lifecycle works", async () => {
    adapter = createAdapter();
    const statuses: { connected: boolean; message: string }[] = [];
    adapter.on("connection.status", (status) => statuses.push(status));

    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    expect(statuses[0]).toMatchObject({ connected: true });

    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it("rejects live and trading-enabled configuration", () => {
    expect(
      () =>
        new TongHuaShunPaperAdapter({
          brokerId: "tonghuashun-sim",
          brokerName: "同花顺模拟盘",
          endpoint: "paper://tonghuashun-sim",
          environment: "live",
        }),
    ).toThrow("只允许模拟盘");

    expect(
      () =>
        new TongHuaShunPaperAdapter({
          brokerId: "tonghuashun-sim",
          brokerName: "同花顺模拟盘",
          endpoint: "paper://tonghuashun-sim",
          tradingEnabled: true,
        }),
    ).toThrow("真实交易未实现");
  });

  it("fills paper market order through PaperBroker", async () => {
    adapter = createAdapter();
    await adapter.connect();
    adapter.updateQuotes([quote]);

    const request: OrderRequest = {
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "ths-paper-001",
    };

    const order = await adapter.submitOrder(request);

    expect(order.status).toBe("filled");
    expect(order.filledPrice).toBe(1500);
    expect(order.notional).toBe(150_000);

    const positions = await adapter.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ symbol: "600519", quantity: 100 });
  });

  it("emits order update only while connected", async () => {
    adapter = createAdapter();
    await adapter.connect();
    adapter.updateQuotes([quote]);

    let emitted: OrderRecord | null = null;
    adapter.on("order.updated", (order) => {
      emitted = order;
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

  it("uses account id from local paper config", async () => {
    adapter = new TongHuaShunPaperAdapter({
      brokerId: "tonghuashun-sim",
      brokerName: "同花顺模拟盘",
      endpoint: "paper://tonghuashun-sim",
      accountId: "THS-DEMO-001",
    });

    await adapter.connect();
    const account = await adapter.getAccount();

    expect(account.accountId).toBe("THS-DEMO-001");
    expect(account.mode).toBe("paper");
  });
});
