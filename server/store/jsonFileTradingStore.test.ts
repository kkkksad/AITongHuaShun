import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { JsonFileTradingStore } from "./jsonFileTradingStore";
import { MockMarket } from "../market/mockMarket";
import type { TradingStore } from "../contracts/TradingStore";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";

const demoLimits: RiskLimits = {
  maxOrderNotional: 100_000,
  maxPositionWeight: 0.25,
  maxDailyLoss: 0.05,
  lotSize: 100,
  realTradingEnabled: false,
};

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `quant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMarket(): MockMarket {
  return new MockMarket("paper", 500);
}

describe("JsonFileTradingStore", () => {
  let dataDir: string;
  let store: TradingStore;
  let snapshot: MarketSnapshot;

  beforeEach(() => {
    dataDir = makeTempDir();
    store = new JsonFileTradingStore(dataDir, 1_000_000);
    snapshot = makeMarket().getSnapshot();
  });

  afterEach(() => {
    makeMarket().stop();
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("初始账户包含种子持仓", () => {
    const positions = store.getPositions(snapshot);
    expect(positions.length).toBe(3);

    const moutai = positions.find((p) => p.symbol === "600519");
    expect(moutai!.quantity).toBe(100);
    expect(moutai!.averagePrice).toBe(1468.2);
  });

  it("getAccount 返回有效账户快照", () => {
    const account = store.getAccount("paper", snapshot, demoLimits);

    expect(account.equity).toBeGreaterThan(0);
    expect(account.cash).toBeGreaterThan(0);
    expect(account.riskUtilization).toBeGreaterThanOrEqual(0);
    expect(account.paused).toBe(false);
  });

  it("createOrder + fillOrder 后状态持久化到磁盘", () => {
    const order = store.createOrder(
      { symbol: "601318", side: "buy", type: "market", quantity: 100 },
      52.1,
    );
    store.fillOrder(order, "中国平安", 52.1, 15.63);

    // 重新加载同一个文件
    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    const orders = reloaded.listOrders();
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders[0].status).toBe("filled");

    const positions = reloaded.getPositions(snapshot);
    const pingan = positions.find((p) => p.symbol === "601318");
    expect(pingan).toBeDefined();
    expect(pingan!.quantity).toBe(100);
  });

  it("限价单挂单→撤销→重新加载", () => {
    const order = store.createOrder(
      { symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 50 },
      52.1,
    );
    expect(order.status).toBe("pending");

    store.cancelOrder(order);

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    const orders = reloaded.listOrders();
    const cancelled = orders.find((o) => o.id === order.id);
    expect(cancelled!.status).toBe("cancelled");
  });

  it("限价单被拒后重新加载状态一致", () => {
    const order = store.createOrder(
      { symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 50 },
      52.1,
    );
    store.rejectOrder(order, "风控拒绝", "TEST_REJECT");

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    const orders = reloaded.listOrders();
    const rejected = orders.find((o) => o.id === order.id);
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.rejectionReason).toBe("风控拒绝");
  });

  it("卖出限价单不冻结现金", () => {
    const cashBefore = store.getAvailableCash();
    store.createOrder(
      {
        symbol: "600519",
        side: "sell",
        type: "limit",
        quantity: 100,
        limitPrice: 2_000,
      },
      1_492.6,
    );

    expect(store.getAvailableCash()).toBe(cashBefore);
  });

  it("暂停状态持久化", () => {
    store.setPaused(true);
    expect(store.isPaused()).toBe(true);

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    expect(reloaded.isPaused()).toBe(true);
  });

  it("审计事件持久化", () => {
    store.createOrder(
      { symbol: "300750", side: "sell", type: "market", quantity: 100 },
      253.4,
    );

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    const audit = reloaded.listAudit();
    expect(audit.length).toBeGreaterThanOrEqual(2); // account.created + order.accepted
    expect(audit.some((e) => e.action === "account.created")).toBe(true);
  });

  it("现金变化持久化", () => {
    const cashBefore = store.getAvailableCash();

    const order = store.createOrder(
      { symbol: "601318", side: "buy", type: "market", quantity: 100 },
      52.1,
    );
    store.fillOrder(order, "中国平安", 52.1, 15.63);

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    expect(reloaded.getAvailableCash()).toBeLessThan(cashBefore);
    expect(reloaded.getAvailableCash()).toBe(store.getAvailableCash());
  });

  it("重置账户会删除旧订单持仓并持久化新的初始资金与策略档位", () => {
    const order = store.createOrder(
      { symbol: "601318", side: "buy", type: "market", quantity: 100 },
      52.1,
    );
    store.fillOrder(order, "中国平安", 52.1, 5);

    store.resetAccount({
      startingCash: 20_000,
      strategyProfile: "defensive",
    });

    expect(store.listOrders()).toEqual([]);
    expect(store.getPositions(snapshot)).toEqual([]);
    expect(store.getStrategyProfile()).toBe("defensive");
    expect(store.getAccount("paper", snapshot, demoLimits)).toMatchObject({
      cash: 20_000,
      equity: 20_000,
      startingEquity: 20_000,
      strategyProfile: "defensive",
    });
    expect(store.listAudit()).toHaveLength(1);
    expect(store.listAudit()[0]).toMatchObject({ action: "account.reset" });

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    expect(reloaded.listOrders()).toEqual([]);
    expect(reloaded.getPositions(snapshot)).toEqual([]);
    expect(reloaded.getStrategyProfile()).toBe("defensive");
    expect(reloaded.getAccount("paper", snapshot, demoLimits)).toMatchObject({
      equity: 20_000,
      strategyProfile: "defensive",
    });
  });

  it("旧版 JSON 没有策略档位时默认使用均衡档", () => {
    const filePath = path.join(dataDir, "paper-trading-state.json");
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    delete persisted.strategyProfile;
    fs.writeFileSync(filePath, JSON.stringify(persisted), "utf-8");

    const reloaded = new JsonFileTradingStore(dataDir, 1_000_000);
    expect(reloaded.getStrategyProfile()).toBe("balanced");
  });

  it("只保留留存期内的已结束订单和审计，同时保留过期挂单", () => {
    const retentionDir = path.join(dataDir, "retention");
    let now = new Date("2026-07-01T04:00:00.000Z");
    const retentionStore = new JsonFileTradingStore(
      retentionDir,
      1_000_000,
      false,
      {
        retentionDays: 7,
        now: () => now,
      },
    );

    const expiredFilledOrder = retentionStore.createOrder(
      { symbol: "601318", side: "buy", type: "market", quantity: 100 },
      52.1,
    );
    retentionStore.fillOrder(expiredFilledOrder, "中国平安", 52.1, 15.63);
    const expiredPendingOrder = retentionStore.createOrder(
      {
        symbol: "600519",
        side: "buy",
        type: "limit",
        quantity: 100,
        limitPrice: 1_000,
      },
      1_468.2,
    );

    now = new Date("2026-07-14T04:00:00.000Z");
    const recentFilledOrder = retentionStore.createOrder(
      { symbol: "000858", side: "buy", type: "market", quantity: 100 },
      128.4,
    );
    retentionStore.fillOrder(recentFilledOrder, "五粮液", 128.4, 5);

    const orders = retentionStore.listOrders();
    expect(orders.some((order) => order.id === expiredFilledOrder.id)).toBe(false);
    expect(orders.some((order) => order.id === expiredPendingOrder.id)).toBe(true);
    expect(orders.some((order) => order.id === recentFilledOrder.id)).toBe(true);
    expect(retentionStore.listAudit().every(
      (event) => Date.parse(event.timestamp) >= Date.parse("2026-07-07T04:00:00.000Z"),
    )).toBe(true);

    const reloaded = new JsonFileTradingStore(
      retentionDir,
      1_000_000,
      false,
      {
        retentionDays: 7,
        now: () => now,
      },
    );
    expect(reloaded.listOrders().map((order) => order.id)).toEqual(
      expect.arrayContaining([expiredPendingOrder.id, recentFilledOrder.id]),
    );

    const persisted = JSON.parse(
      fs.readFileSync(path.join(retentionDir, "paper-trading-state.json"), "utf-8"),
    );
    expect(persisted.orders.some(
      (order: { id: string }) => order.id === expiredFilledOrder.id,
    )).toBe(false);
    expect(persisted.auditEvents.every(
      (event: { timestamp: string }) => (
        Date.parse(event.timestamp) >= Date.parse("2026-07-07T04:00:00.000Z")
      ),
    )).toBe(true);
  });

  it("加载状态文件时立即清理过期历史", () => {
    const retentionDir = path.join(dataDir, "load-retention");
    let now = new Date("2026-07-01T04:00:00.000Z");
    const original = new JsonFileTradingStore(retentionDir, 1_000_000, false, {
      retentionDays: 7,
      now: () => now,
    });
    const expiredOrder = original.createOrder(
      { symbol: "601318", side: "buy", type: "market", quantity: 100 },
      52.1,
    );
    original.fillOrder(expiredOrder, "中国平安", 52.1, 15.63);

    now = new Date("2026-07-14T04:00:00.000Z");
    const reloaded = new JsonFileTradingStore(retentionDir, 1_000_000, false, {
      retentionDays: 7,
      now: () => now,
    });

    expect(reloaded.listOrders()).toHaveLength(0);
    expect(reloaded.listAudit()).toHaveLength(0);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(retentionDir, "paper-trading-state.json"), "utf-8"),
    );
    expect(persisted.orders).toHaveLength(0);
    expect(persisted.auditEvents).toHaveLength(0);
  });

  it("空目录首次初始化", () => {
    // 已经通过 beforeEach 验证
    const stateFile = path.join(dataDir, "paper-trading-state.json");
    expect(fs.existsSync(stateFile)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.positions.length).toBe(3);
  });
});
