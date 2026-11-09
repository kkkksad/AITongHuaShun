import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTradingApp } from "./app";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";

const apps: FastifyInstance[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const app of apps.splice(0)) await app.close(); });

async function fixture() {
  let time = new Date("2026-11-02T02:00:00.000Z");
  const now = () => time;
  const config = createTestConfig({ MARKET_MODE: "paper", TRADING_STARTING_CASH: 20_000,
    TRADING_SEED_PORTFOLIO: false, MAX_POSITION_WEIGHT: 1, MAX_DAILY_LOSS: 1,
    SLIPPAGE_BPS: 0, COMMISSION_RATE: 0, CIRCUIT_MAX_CONSECUTIVE_LOSSES: 3 });
  const system = createTradingSystem(config, now);
  const app = await buildTradingApp({ config, system, startMarket: false, clock: now }); apps.push(app);
  return { app, system, advance(tick = true) { time = new Date(time.getTime() + 86_400_000); if (tick) system.market.tick(); } };
}

describe("risk recovery HTTP contract", () => {
  it("resets risk through the broker and immediately saves the new consumption point without resetting funds", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) {
      const buy = f.system.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 });
      expect(buy.status, buy.rejectionReason).toBe("filled");
      f.advance();
      expect(f.system.broker.submitOrder({ symbol: "601318", side: "sell", type: "market", quantity: 100 }).status).toBe("filled");
    }
    expect(f.system.risk.getState().circuitState).toBe("tripped");
    const before = f.system.broker.getAccount(); const orders = f.system.broker.getOrders();
    const response = await f.app.inject({ method: "POST", url: "/api/risk/reset" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ circuitState: "normal" });
    expect(f.system.store.getPaperRiskCheckpoint()).toMatchObject({ lastConsumedCycle: 3,
      state: { tradeCount: 0, circuitState: "normal", ledgerStatus: "ready" } });
    expect(f.system.broker.getAccount()).toEqual(before);
    expect(f.system.broker.getOrders()).toEqual(orders);
  });

  it("returns a specific 503 when an explicit reset cannot save its checkpoint", async () => {
    const f = await fixture();
    vi.spyOn(f.system.store, "setPaperRiskCheckpoint").mockImplementation(() => { throw new Error("fixture failure"); });
    const response = await f.app.inject({ method: "POST", url: "/api/risk/reset" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "RISK_CHECKPOINT_UNAVAILABLE", message: expect.stringContaining("检查点") });
    expect(f.system.risk.getState().ledgerStatus).toBe("checkpoint-unavailable");
    expect(f.system.broker.getAccount().cash).toBe(20_000);
    expect(f.system.broker.getOrders()).toEqual([]);
  });

  it("returns risk evidence status without mutating the checkpoint on GET", async () => {
    const f = await fixture(); const checkpoint = f.system.store.getPaperRiskCheckpoint(); f.advance(false);
    const response = await f.app.inject({ method: "GET", url: "/api/risk/state" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ledgerStatus: "ready", unknownCycleCount: 0, tradingDate: "2026-11-02" });
    expect(f.system.store.getPaperRiskCheckpoint()).toEqual(checkpoint);
  });
});
