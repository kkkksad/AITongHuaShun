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

  it("空目录首次初始化", () => {
    // 已经通过 beforeEach 验证
    const stateFile = path.join(dataDir, "paper-trading-state.json");
    expect(fs.existsSync(stateFile)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.positions.length).toBe(3);
  });
});
