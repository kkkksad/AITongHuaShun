/**
 * 系统端到端集成测试
 *
 * 覆盖完整交易流程：
 *   1. 启动 server → 验证账户初始状态
 *   2. 获取行情 → 验证行情数据完整性
 *   3. 提交市价买单 → 验证成交与持仓更新
 *   4. 提交限价卖单 → 验证挂单状态
 *   5. 撤销挂单 → 验证取消状态
 *   6. 综合查询账户 / 持仓 / 订单
 *   7. 风控限制测试（超额订单被拒）
 *
 * 使用 Fastify inject 进行 HTTP 层测试，不启动真实端口。
 */

import type { FastifyInstance } from "fastify";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTradingApp } from "../app";
import { createTestConfig } from "./testConfig";

// ── helpers ──────────────────────────────────────────────────────────

async function get(app: FastifyInstance, url: string) {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
}

async function post(
  app: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
) {
  const res = await app.inject({ method: "POST", url, payload });
  return { status: res.statusCode, body: res.json() };
}

async function del(app: FastifyInstance, url: string) {
  const res = await app.inject({ method: "DELETE", url });
  return { status: res.statusCode, body: res.json() };
}

// ── test suite ───────────────────────────────────────────────────────

describe("E2E 交易流程集成测试", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTradingApp({
      config: createTestConfig(),
      startMarket: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Step 1: 启动 server → 验证账户初始状态 ──────────────────────
  it("Step 1: 启动服务并验证账户初始状态", async () => {
    const { status: healthStatus, body: health } = await get(app, "/api/health");
    expect(healthStatus).toBe(200);
    expect(health).toMatchObject({
      ok: true,
      service: "kairos-trading-api",
      mode: "mock",
      realTradingEnabled: false,
    });

    const { body: account } = await get(app, "/api/account");
    const acct = account as AccountSnapshot;
    expect(acct.accountId).toBe("PAPER-CN-01");
    expect(acct.mode).toBe("mock");
    expect(acct.paused).toBe(false);
    expect(acct.cash).toBeGreaterThan(0);
    expect(acct.equity).toBeGreaterThan(acct.cash); // 含持仓市值
    expect(acct.marketValue).toBeGreaterThan(0);
    expect(acct.dailyPnlPercent).toBeGreaterThanOrEqual(0);

    const { body: positions } = await get(app, "/api/positions");
    const posList = positions as PositionSnapshot[];
    expect(posList.length).toBeGreaterThanOrEqual(3);

    const symbols = posList.map((p) => p.symbol);
    expect(symbols).toContain("600519");
    expect(symbols).toContain("300750");
    expect(symbols).toContain("688981");

    for (const pos of posList) {
      expect(pos.quantity).toBeGreaterThan(0);
      expect(pos.averagePrice).toBeGreaterThan(0);
      expect(pos.currentPrice).toBeGreaterThan(0);
      expect(pos.marketValue).toBeGreaterThan(0);
      expect(pos.weight).toBeGreaterThan(0);
      expect(pos.weight).toBeLessThanOrEqual(1);
    }

    const { body: orders } = await get(app, "/api/orders?limit=10");
    expect(Array.isArray(orders)).toBe(true);
    expect((orders as OrderRecord[]).length).toBe(0);
  });

  // ── Step 2: 获取行情 → 验证行情数据 ────────────────────────────
  it("Step 2: 获取行情快照并验证数据完整性与可交易标的", async () => {
    const { status, body: snapshot } = await get(app, "/api/market/snapshot");
    expect(status).toBe(200);

    const market = snapshot as MarketSnapshot;
    expect(market.mode).toBe("mock");
    expect(market.marketTime).toBeTruthy();
    expect(market.sequence).toBeGreaterThanOrEqual(0);
    expect(market.quotes.length).toBeGreaterThanOrEqual(4);

    const tradable = market.quotes.filter((q) => q.tradable);
    expect(tradable.length).toBeGreaterThanOrEqual(4);

    for (const q of tradable) {
      expect(q.symbol).toMatch(/^\d{6}$/);
      expect(q.name.length).toBeGreaterThan(0);
      expect(q.price).toBeGreaterThan(0);
      expect(q.previousClose).toBeGreaterThan(0);
      expect(typeof q.changePercent).toBe("number");
      expect(q.volume).toBeGreaterThan(0);
      expect(q.updatedAt).toBeTruthy();
    }

    const indices = market.quotes.filter((q) => !q.tradable);
    expect(indices.length).toBeGreaterThanOrEqual(4);
    for (const idx of indices) {
      expect(["000001", "399001", "399006", "000300"]).toContain(idx.symbol);
    }

    const ntd = market.quotes.find((q) => q.symbol === "300750");
    expect(ntd).toBeDefined();
    expect(ntd!.name).toBe("宁德时代");
    expect(ntd!.tradable).toBe(true);
    expect(ntd!.price).toBeCloseTo(253.4, -1);
  });

  // ── Step 3: 提交市价买单 → 验证成交和持仓 ──────────────────────
  it("Step 3: 提交市价买单并验证即时成交与持仓更新", async () => {
    const ORDER_ID = "e2e-mkt-buy";

    const { status, body } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: ORDER_ID,
    });

    expect(status).toBe(201);

    const order = body.order as OrderRecord;
    expect(order.status).toBe("filled");
    expect(order.side).toBe("buy");
    expect(order.type).toBe("market");
    expect(order.symbol).toBe("601318");
    expect(order.quantity).toBe(100);
    expect(order.filledQuantity).toBe(100);
    expect(order.filledPrice).toBeGreaterThan(0);
    expect(order.commission).toBeGreaterThan(0);
    expect(order.clientOrderId).toBe(ORDER_ID);

    const account = body.account as AccountSnapshot;
    expect(account.cash).toBeLessThan(1_000_000);

    const positions = body.positions as PositionSnapshot[];
    const newPos = positions.find((p) => p.symbol === "601318");
    expect(newPos).toBeDefined();
    expect(newPos!.quantity).toBe(100);

    // 幂等性：重复提交相同 clientOrderId 返回原订单
    const { body: dupBody } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: ORDER_ID,
    });
    expect(dupBody.order.id).toBe(order.id);
    expect(dupBody.order.status).toBe("filled");

    const { body: orders } = await get(app, "/api/orders?limit=5");
    const found = (orders as OrderRecord[]).find((o) => o.clientOrderId === ORDER_ID);
    expect(found).toBeDefined();
    expect(found!.status).toBe("filled");
  });

  // ── Step 4: 提交限价卖单 → 验证挂单状态 ────────────────────────
  it("Step 4: 提交限价卖单并验证挂单状态", async () => {
    const { body: market } = await get(app, "/api/market/snapshot");
    const quote = (market as MarketSnapshot).quotes.find((q) => q.symbol === "300750")!;
    const currentPrice = quote.price;

    // 远高于当前价的限价卖单 → 不会立即成交
    const limitPrice = Math.ceil(currentPrice * 1.5);

    const { status, body } = await post(app, "/api/orders", {
      symbol: "300750",
      side: "sell",
      type: "limit",
      quantity: 100,
      limitPrice,
      clientOrderId: "e2e-limit-sell",
    });

    expect(status).toBe(201);

    const order = body.order as OrderRecord;
    expect(order.status).toBe("pending");
    expect(order.symbol).toBe("300750");
    expect(order.side).toBe("sell");
    expect(order.type).toBe("limit");
    expect(order.limitPrice).toBe(limitPrice);
    expect(order.quantity).toBe(100);
    expect(order.filledQuantity).toBe(0);

    const { body: orders } = await get(app, "/api/orders");
    const pending = (orders as OrderRecord[]).find(
      (o) => o.clientOrderId === "e2e-limit-sell",
    );
    expect(pending).toBeDefined();
    expect(pending!.status).toBe("pending");

    // 限价买单（远低于市价）也应挂单
    const { body: buyBody } = await post(app, "/api/orders", {
      symbol: "688981",
      side: "buy",
      type: "limit",
      quantity: 200,
      limitPrice: 80,
      clientOrderId: "e2e-limit-buy",
    });
    expect(buyBody.order.status).toBe("pending");
    expect(buyBody.order.side).toBe("buy");
    expect(buyBody.order.limitPrice).toBe(80);
  });

  // ── Step 5: 撤销挂单 → 验证撤销 ────────────────────────────────
  it("Step 5: 撤销挂单并验证状态变更与资金解冻", async () => {
    const { body: createBody } = await post(app, "/api/orders", {
      symbol: "300750",
      side: "sell",
      type: "limit",
      quantity: 100,
      limitPrice: 500,
      clientOrderId: "e2e-cancel-test",
    });

    const orderId = (createBody.order as OrderRecord).id;
    expect(createBody.order.status).toBe("pending");

    const { status: cancelStatus, body: cancelBody } = await del(
      app,
      `/api/orders/${orderId}`,
    );

    expect(cancelStatus).toBe(200);
    expect(cancelBody.order.status).toBe("cancelled");
    expect(cancelBody.order.id).toBe(orderId);
    expect(cancelBody.order.symbol).toBe("300750");

    const account = cancelBody.account as AccountSnapshot;
    expect(account.paused).toBe(false);

    const { body: orders } = await get(app, "/api/orders?limit=10");
    const cancelled = (orders as OrderRecord[]).find((o) => o.id === orderId);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe("cancelled");

    const { status: missingStatus } = await del(app, "/api/orders/FAKE-ID");
    expect(missingStatus).toBe(400);
  });

  // ── Step 6: 综合查询账户 / 持仓 / 订单 ──────────────────────────
  it("Step 6: 综合查询账户、持仓和订单的数据一致性", async () => {
    await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-query-buy",
    });

    const [accountRes, positionsRes, ordersRes] = await Promise.all([
      get(app, "/api/account"),
      get(app, "/api/positions"),
      get(app, "/api/orders?limit=50"),
    ]);

    expect(accountRes.status).toBe(200);
    expect(positionsRes.status).toBe(200);
    expect(ordersRes.status).toBe(200);

    const account = accountRes.body as AccountSnapshot;
    const positions = positionsRes.body as PositionSnapshot[];
    const orders = ordersRes.body as OrderRecord[];

    // ── 账户校验 ──
    expect(account.accountId).toBe("PAPER-CN-01");
    expect(typeof account.cash).toBe("number");
    expect(typeof account.equity).toBe("number");
    expect(typeof account.marketValue).toBe("number");
    expect(typeof account.unrealizedPnl).toBe("number");
    expect(typeof account.realizedPnl).toBe("number");
    expect(typeof account.dailyPnl).toBe("number");
    expect(typeof account.dailyPnlPercent).toBe("number");
    expect(typeof account.riskUtilization).toBe("number");
    expect(account.riskUtilization).toBeGreaterThanOrEqual(0);
    expect(account.riskUtilization).toBeLessThanOrEqual(1);

    // equity ≈ cash + marketValue
    const calculatedEquity = account.cash + account.marketValue;
    expect(Math.abs(account.equity - calculatedEquity)).toBeLessThan(1);

    // ── 持仓校验 ──
    expect(Array.isArray(positions)).toBe(true);
    for (const pos of positions) {
      expect(pos.symbol).toMatch(/^\d{6}$/);
      expect(pos.quantity).toBeGreaterThan(0);
      expect(pos.averagePrice).toBeGreaterThan(0);
      expect(pos.currentPrice).toBeGreaterThan(0);
      expect(pos.marketValue).toBeGreaterThan(0);
      expect(pos.weight).toBeGreaterThan(0);
      expect(pos.weight).toBeLessThanOrEqual(1);
      expect(pos.marketValue).toBeCloseTo(pos.currentPrice * pos.quantity, -1);
    }

    // 权重 = 个股市值 / 总权益，现金权重为 (1 - sum)
    const totalWeight = positions.reduce((sum, p) => sum + p.weight, 0);
    expect(totalWeight).toBeGreaterThan(0);
    expect(totalWeight).toBeLessThan(1);

    // ── 订单校验 ──
    expect(Array.isArray(orders)).toBe(true);
    expect(orders.length).toBeGreaterThanOrEqual(1);

    const ourOrder = orders.find((o) => o.clientOrderId === "e2e-query-buy");
    expect(ourOrder).toBeDefined();
    expect(ourOrder!.status).toBe("filled");
    expect(ourOrder!.symbol).toBe("601318");
    expect(ourOrder!.filledPrice).toBeGreaterThan(0);
    expect(ourOrder!.commission).toBeGreaterThan(0);
    expect(ourOrder!.notional).toBeGreaterThan(0);

    // 审计日志可查询
    const { status: auditStatus, body: audit } = await get(app, "/api/audit?limit=20");
    expect(auditStatus).toBe(200);
    expect(Array.isArray(audit)).toBe(true);
    expect(audit.length).toBeGreaterThan(0);
  });

  // ── Step 7: 风控限制测试 ────────────────────────────────────────
  it("Step 7: 风控限制 — 超限订单被拒绝", async () => {
    // 600519 贵州茅台 ~1492 / 股，100 股 ≈ 149,260 > 单笔限额 100,000
    const { body: bigOrder } = await post(app, "/api/orders", {
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-risk-overlimit",
    });

    const order = bigOrder.order as OrderRecord;
    expect(order.status).toBe("rejected");
    expect(order.rejectionReason).toContain("限额");

    // 不可交易标的被拒
    const { body: indexOrder } = await post(app, "/api/orders", {
      symbol: "000001",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-risk-index",
    });
    expect(indexOrder.order.status).toBe("rejected");
    expect(indexOrder.order.rejectionReason).toContain("行情");

    // 非整数手被拒（lotSize = 100，提交 50 股）
    const { body: lotOrder } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 50,
      clientOrderId: "e2e-risk-lot",
    });
    expect(lotOrder.order.status).toBe("rejected");
    expect(lotOrder.order.rejectionReason).toContain("100");

    // 交易暂停后下单被拒
    await post(app, "/api/trading/pause", {});
    const { body: pausedOrder } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-risk-paused",
    });
    expect(pausedOrder.order.status).toBe("rejected");
    expect(pausedOrder.order.rejectionReason).toContain("暂停");

    // 恢复交易后再下单应成功
    await post(app, "/api/trading/resume", {});
    const { body: resumedOrder } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-risk-resumed",
    });
    expect(resumedOrder.order.status).toBe("filled");

    // 验证被拒绝的订单都在订单列表中
    const { body: orders } = await get(app, "/api/orders?limit=20");
    const rejectedOrders = (orders as OrderRecord[]).filter(
      (o) => o.status === "rejected",
    );
    expect(rejectedOrders.length).toBeGreaterThanOrEqual(3);
  });

  // ── 全流程串联测试：Step 1 → 7 一次性跑通 ──────────────────────
  it("全流程串联：从启动到风控拒绝的完整交易链路", async () => {
    // Step 1 & 2
    const { body: health } = await get(app, "/api/health");
    expect(health.ok).toBe(true);

    const { body: market } = await get(app, "/api/market/snapshot");
    const tradableSymbols = (market as MarketSnapshot).quotes
      .filter((q) => q.tradable)
      .map((q) => q.symbol);
    expect(tradableSymbols).toContain("601318");
    expect(tradableSymbols).toContain("300750");

    // Step 3: 市价买单
    const { body: buy } = await post(app, "/api/orders", {
      symbol: "601318",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-fullflow-buy",
    });
    expect(buy.order.status).toBe("filled");
    expect(
      buy.positions.find((p: PositionSnapshot) => p.symbol === "601318"),
    ).toBeDefined();

    // Step 4: 限价卖单（挂单）
    const { body: limit } = await post(app, "/api/orders", {
      symbol: "300750",
      side: "sell",
      type: "limit",
      quantity: 100,
      limitPrice: 999,
      clientOrderId: "e2e-fullflow-limit",
    });
    expect(limit.order.status).toBe("pending");

    // Step 5: 撤销挂单
    const { body: cancelled } = await del(app, `/api/orders/${limit.order.id}`);
    expect(cancelled.order.status).toBe("cancelled");

    // Step 6: 综合查询
    const [account, positions, orders] = await Promise.all([
      get(app, "/api/account"),
      get(app, "/api/positions"),
      get(app, "/api/orders?limit=50"),
    ]);
    expect(account.status).toBe(200);
    expect(positions.status).toBe(200);
    expect(orders.status).toBe(200);

    // Step 7: 风控拒绝
    const { body: risky } = await post(app, "/api/orders", {
      symbol: "600519",
      side: "buy",
      type: "market",
      quantity: 100,
      clientOrderId: "e2e-fullflow-risk",
    });
    expect(risky.order.status).toBe("rejected");

    // 最终确认
    const { body: finalAccount } = await get(app, "/api/account");
    const final = finalAccount as AccountSnapshot;
    expect(final.paused).toBe(false);
    expect(final.cash).toBeGreaterThan(0);
  });
});
