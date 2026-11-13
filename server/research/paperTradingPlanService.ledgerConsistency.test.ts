import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { PaperAutoExecutor } from "../trading/paperAutoExecutor";
import { PaperExecutionContextChangedError } from "../trading/paperExecutionContext";
import { buildUnavailableExternalMarketImpact } from "./externalMarketImpact";
import { buildUnavailableMarketRegimeResearch, type MarketRegimeResearchReport } from "./marketRegimeResearch";
import { buildCurrentPaperTradingPlan } from "./paperTradingPlanService";
import { buildUnavailableRealResearchDataFeed } from "./realResearchData";

const builders = vi.hoisted(() => ({ core: vi.fn(), news: vi.fn(), external: vi.fn() }));
vi.mock("./marketRegimeResearch", async original => ({
  ...await original<typeof import("./marketRegimeResearch")>(), buildMarketRegimeResearch: builders.core,
}));
vi.mock("./realResearchData", async original => ({
  ...await original<typeof import("./realResearchData")>(), buildRealResearchDataFeed: builders.news,
}));
vi.mock("./externalMarketImpact", async original => ({
  ...await original<typeof import("./externalMarketImpact")>(), buildExternalMarketImpact: builders.external,
}));

const directories: string[] = [];
const date = new Date("2026-08-21T06:00:00Z");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(date);
  builders.core.mockReset().mockImplementation(async input => buildUnavailableMarketRegimeResearch(input, "fixture"));
  builders.news.mockReset().mockImplementation(async input => buildUnavailableRealResearchDataFeed(input, "fixture"));
  builders.external.mockReset().mockImplementation(async input => buildUnavailableExternalMarketImpact(input, "fixture"));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("kairos-plan-ledger-")) {
      throw new Error("Unexpected ledger fixture directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(backend: "memory" | "json") {
  const directory = mkdtempSync(join(tmpdir(), "kairos-plan-ledger-")); directories.push(directory);
  const config = createTestConfig({ MARKET_MODE: "paper", STORE_BACKEND: backend, DATA_DIR: directory,
    TRADING_STARTING_CASH: 20_000, TRADING_SEED_PORTFOLIO: false,
    MAX_ORDER_NOTIONAL: 10_000, MAX_POSITION_WEIGHT: 0.8, SLIPPAGE_BPS: 0 });
  let clock = new Date(date);
  const system = createTradingSystem(config, () => clock);
  system.marketDataProvider = "akshare";
  system.broker.setStrategyProfile("growth");
  const snapshot = { mode: "paper" as const, sequence: 1, marketTime: date.toISOString(), quotes: [
    { symbol: "600001", name: "本地反例", price: 10, previousClose: 10, changePercent: 0,
      volume: 10_000_000, tradable: true, updatedAt: date.toISOString() },
  ] };
  vi.spyOn(system.market, "getSnapshot").mockImplementation(() => snapshot);
  vi.spyOn(system.market, "getQuote").mockImplementation(symbol => snapshot.quotes.find(q => q.symbol === symbol));
  const request = { system, config, now: date };
  const buy = (type: "market" | "limit" = "market") => system.broker.submitOrder({
    symbol: "600001", side: "buy", type, quantity: 100, ...(type === "limit" ? { limitPrice: 9 } : {}),
  });
  const digest = () => ({ cash: system.store.getCash(), available: system.store.getAvailableCash(),
    positions: system.broker.getPositions(snapshot), orders: system.broker.getOrders(20_000),
    fillLedger: system.store.getPaperFillLedger(), risk: system.store.getPaperRiskCheckpoint() });
  function waitForResearch() {
    let complete!: (value: MarketRegimeResearchReport) => void;
    let fail!: (reason: Error) => void;
    let begin!: () => void;
    const started = new Promise<void>(yes => { begin = yes; });
    builders.core.mockImplementationOnce(() => new Promise<MarketRegimeResearchReport>((yes, no) => {
      complete = yes; fail = no; begin();
    }));
    return {
      started,
      finish: () => complete(buildUnavailableMarketRegimeResearch(builders.core.mock.calls.at(-1)![0], "fixture")),
      fail: () => fail(new Error("fixture provider unavailable")),
    };
  }
  return { ...request, request, directory, snapshot, buy, digest, waitForResearch,
    seedSellable() { clock = new Date("2026-08-20T06:00:00Z"); buy(); clock = new Date(date); },
  };
}

type Fixture = ReturnType<typeof fixture>;
const changes: Array<{ name: string; setup?: (f: Fixture) => OrderRecord; change: (f: Fixture, initial?: OrderRecord) => void }> = [
  { name: "new pending buy", change: f => { expect(f.buy("limit").status).toBe("pending"); } },
  { name: "immediate buy fill", change: f => { expect(f.buy().status).toBe("filled"); } },
  { name: "pending buy cancellation", setup: f => f.buy("limit"), change: (f, order) => {
    expect(f.system.broker.cancelOrder(order!.id).status).toBe("cancelled");
  } },
  { name: "pending buy fill without a new order", setup: f => f.buy("limit"), change: f => {
    f.snapshot.quotes[0].price = 8; f.system.broker.markToMarket(f.snapshot);
    expect(f.system.broker.getOrders()[0].status).toBe("filled");
  } },
  { name: "pending sell cancellation with unchanged cash", setup: f => {
    f.seedSellable(); return f.system.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", limitPrice: 11, quantity: 100 });
  }, change: (f, order) => { expect(f.system.broker.cancelOrder(order!.id).status).toBe("cancelled"); } },
  { name: "external rejected order with unchanged cash", change: f => {
    expect(f.system.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1 }).status).toBe("rejected");
  } },
  { name: "pending and cancellation restoring the cash balance", change: f => {
    f.system.broker.cancelOrder(f.buy("limit").id);
  } },
];

describe.each(["memory", "json"] as const)("%s Paper plan ledger wait boundary", backend => {
  it.each(changes)("invalidates a plan after $name without reverting the successful external operation", async ({ setup, change }) => {
    const f = fixture(backend); const initial = setup?.(f);
    const revision = f.system.store.getExecutionRevision();
    const research = f.waitForResearch();
    const result = buildCurrentPaperTradingPlan(f.request);
    const conflict = result.then(() => null, error => error);
    await research.started;
    expect(builders.core).toHaveBeenCalledOnce();
    change(f, initial); const afterExternal = f.digest();
    expect(f.system.store.getExecutionRevision()).toBe(revision);
    research.finish(); expect(await conflict).toMatchObject({ name: "PaperExecutionContextChangedError", statusCode: 409,
      message: expect.stringContaining("账本") });
    expect(f.digest()).toEqual(afterExternal);
    if (backend === "json") {
      const persisted = JSON.parse(readFileSync(join(f.directory, "paper-trading-state.json"), "utf8"));
      expect(persisted.cash).toBe(afterExternal.cash); expect(persisted.orders).toEqual(afterExternal.orders);
    }
  });

  it.each(["response", "provider-error", "deadline"] as const)("detects changed ledger with %s and permits a fresh calculation", async outcome => {
    const f = fixture(backend); const research = f.waitForResearch();
    const stale = buildCurrentPaperTradingPlan(f.request);
    const rejected = stale.then(() => null, error => error);
    await research.started;
    f.buy(); const after = f.digest();
    if (outcome === "response") research.finish();
    else if (outcome === "provider-error") research.fail();
    else await vi.advanceTimersByTimeAsync(12_001);
    expect(await rejected).toBeInstanceOf(PaperExecutionContextChangedError); expect(f.digest()).toEqual(after);
    if (outcome === "deadline") research.finish();
    const fresh = await buildCurrentPaperTradingPlan(f.request);
    expect(fresh.plan.account.cash).toBe(after.available);
    expect(f.digest()).toEqual(after);
  });

  it("keeps an unchanged plan valid across quote/audit/risk observation updates and a cache hit", async () => {
    const f = fixture(backend); f.seedSellable();
    const research = f.waitForResearch();
    const plan = buildCurrentPaperTradingPlan(f.request);
    await research.started;
    f.system.store.appendAudit("system", "fixture.read", "unrelated observation");
    f.snapshot.sequence += 1;
    f.system.broker.markToMarket(f.snapshot);
    const after = f.digest(); research.finish();
    const first = await plan;
    const second = await buildCurrentPaperTradingPlan(f.request);
    expect(second.plan).toEqual(first.plan);
    expect(builders.core).toHaveBeenCalledOnce();
    expect(f.digest()).toEqual(after);
  });

  it("discards a real executor's stale research plan without notifying or submitting automatic orders", async () => {
    const f = fixture(backend); const research = f.waitForResearch();
    const notifier = { notify: vi.fn(), notifyOrderEvents: vi.fn() };
    const executor = new PaperAutoExecutor({ system: f.system, config: f.config, enabled: true,
      intervalMs: 60_000, tradeWindowOnly: true, maxOrdersPerRun: 2, maxDailyOrders: 10,
      targetDailyOrders: 6, clock: () => date, planNotifier: notifier });
    const running = executor.runOnce();
    await research.started;
    expect(builders.core).toHaveBeenCalledOnce();
    f.buy(); const after = f.digest();
    const submit = vi.spyOn(f.system.broker, "submitOrder");
    research.finish(); const result = await running;
    expect(result.planQuality).toBe("watch-only");
    expect(result.submittedOrders).toEqual([]);
    expect(result.skippedOperations).toEqual(expect.arrayContaining([expect.objectContaining({
      symbol: "SYSTEM", reason: expect.stringContaining("账本"),
    })]));
    expect(submit).not.toHaveBeenCalled(); expect(notifier.notify).not.toHaveBeenCalled();
    expect(notifier.notifyOrderEvents).not.toHaveBeenCalled();
    expect(f.digest()).toEqual(after);
  });
});

it.each(["cancel", "fill"] as const)("detects an old pending sell outside the real 10000-order window: %s", async change => {
  const original = fixture("json"); original.seedSellable();
  const pending = original.system.broker.submitOrder({ symbol: "600001", side: "sell", type: "limit", limitPrice: 11, quantity: 100 });
  const rejected = original.system.broker.submitOrder({ symbol: "600001", side: "buy", type: "market", quantity: 1 });
  const file = join(original.directory, "paper-trading-state.json");
  const state = JSON.parse(readFileSync(file, "utf8"));
  state.orders = [...Array.from({ length: 10_000 }, (_, index) => ({ ...rejected, id: `ORD-${String(30_000 - index).padStart(6, "0")}` })),
    ...state.orders.filter((order: OrderRecord) => order.id !== rejected.id)];
  state.orderSequence = 30_000;
  writeFileSync(file, JSON.stringify(state));
  const system = createTradingSystem(original.config, () => date); system.marketDataProvider = "akshare";
  vi.spyOn(system.market, "getSnapshot").mockReturnValue(original.snapshot);
  vi.spyOn(system.market, "getQuote").mockReturnValue(original.snapshot.quotes[0]);
  expect(system.store.listOrders(10_000).some(order => order.id === pending.id)).toBe(false);
  expect(system.store.getPendingOrders().map(order => order.id)).toEqual([pending.id]);
  const research = original.waitForResearch();
  const plan = buildCurrentPaperTradingPlan({ system, config: original.config, now: date });
  const conflict = plan.then(() => null, error => error);
  await research.started;
  const before = system.store.listOrders(10_000); const cash = system.store.getCash();
  if (change === "cancel") system.broker.cancelOrder(pending.id);
  else { original.snapshot.quotes[0].price = 12; system.broker.markToMarket(original.snapshot); }
  expect(system.store.listOrders(10_000)).toEqual(before);
  if (change === "cancel") expect(system.store.getCash()).toBe(cash);
  const after = { cash: system.store.getCash(), ledger: system.store.getPaperFillLedger(), orders: system.broker.getOrders(20_000) };
  research.finish(); expect(await conflict).toBeInstanceOf(PaperExecutionContextChangedError);
  expect({ cash: system.store.getCash(), ledger: system.store.getPaperFillLedger(), orders: system.broker.getOrders(20_000) }).toEqual(after);
});
