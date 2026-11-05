import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../shared/trading";
import { buildTradingApp } from "../app";
import { createTradingSystem, type TradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { buildCurrentPaperTradingPlan } from "./paperTradingPlanService";
import {
  buildUnavailableStrategyLeaderboard,
  type StrategyLeaderboardReport,
} from "./strategyLeaderboard";
import { buildCachedStrategyLeaderboard } from "./strategyLeaderboardService";

const { leaderboardBuilder } = vi.hoisted(() => ({ leaderboardBuilder: vi.fn() }));

vi.mock("./strategyLeaderboard", async (importOriginal) => ({
  ...await importOriginal<typeof import("./strategyLeaderboard")>(),
  buildStrategyLeaderboard: leaderboardBuilder,
}));

const config = createTestConfig({ MARKET_MODE: "paper", TRADING_SEED_PORTFOLIO: false });
const snapshotDate = new Date("2026-11-05T02:00:00.000Z");
let app: FastifyInstance | undefined;

function newSystem(): TradingSystem {
  return createTradingSystem(config, () => snapshotDate);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function reportFor(snapshot: MarketSnapshot, bars = 120): StrategyLeaderboardReport {
  return buildUnavailableStrategyLeaderboard(snapshot, "mock", bars, "test fixture");
}

beforeEach(() => {
  leaderboardBuilder.mockReset();
  leaderboardBuilder.mockImplementation(async (
    snapshot: MarketSnapshot,
    provider: string,
    bars: number,
    seed: number,
    requestedSymbols: string[],
  ) => buildUnavailableStrategyLeaderboard(snapshot, provider, bars, "test fixture", seed, requestedSymbols));
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared strategy leaderboard research", () => {
  it("shares concurrent calculations and completed reports without changing timestamps", async () => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    const pending = deferred<StrategyLeaderboardReport>();
    const report = reportFor(snapshot);
    leaderboardBuilder.mockReturnValueOnce(pending.promise);
    const first = buildCachedStrategyLeaderboard({ system, snapshot, bars: 120 });
    const second = buildCachedStrategyLeaderboard({ system, snapshot: structuredClone(snapshot), bars: 120 });
    await Promise.resolve();

    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);
    pending.resolve(report);
    expect(await first).toBe(report);
    expect(await second).toBe(report);
    const cached = await buildCachedStrategyLeaderboard({ system, snapshot, bars: 120 });
    expect(cached).toBe(report);
    expect(cached.generatedAt).toBe(report.generatedAt);
    expect(cached.source.snapshotTime).toBe(snapshot.marketTime);
    expect(leaderboardBuilder).toHaveBeenCalledWith(snapshot, "mock", 120, 42, []);
  });

  it.each([
    ["provider", (system: TradingSystem, _snapshot: MarketSnapshot) => { system.marketDataProvider = "akshare"; }],
    ["snapshot sequence", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.sequence += 1; }],
    ["snapshot time", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.marketTime = "2026-11-05T02:00:01.000Z"; }],
    ["snapshot mode", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.mode = "mock"; }],
    ["quote price", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.quotes[0].price += 1; }],
    ["quote volume", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.quotes[0].volume += 1; }],
    ["quote time", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.quotes[0].updatedAt = "2026-11-05T01:59:00.000Z"; }],
    ["quote name", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.quotes[0].name += "变更"; }],
    ["quote order", (_system: TradingSystem, snapshot: MarketSnapshot) => { snapshot.quotes.reverse(); }],
  ])("does not reuse changed %s", async (_label, change) => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    await buildCachedStrategyLeaderboard({ system, snapshot });
    const changed = structuredClone(snapshot);
    change(system, changed);
    await buildCachedStrategyLeaderboard({ system, snapshot: changed });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
  });

  it("separates bars, seed, requested symbols and their order", async () => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    const input = { system, snapshot, bars: 120, seed: 42, requestedSymbols: ["600519", "000858"] };
    await buildCachedStrategyLeaderboard(input);
    await buildCachedStrategyLeaderboard({ ...input, bars: 90 });
    await buildCachedStrategyLeaderboard({ ...input, seed: 43 });
    await buildCachedStrategyLeaderboard({ ...input, requestedSymbols: ["600519"] });
    await buildCachedStrategyLeaderboard({ ...input, requestedSymbols: ["000858", "600519"] });
    await buildCachedStrategyLeaderboard(input);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(5);
  });

  it("isolates system instances even when their snapshots match", async () => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    await buildCachedStrategyLeaderboard({ system, snapshot });
    await buildCachedStrategyLeaderboard({ system: newSystem(), snapshot });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
  });

  it("starts its thirty-second TTL when computation completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(snapshotDate);
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    const pending = deferred<StrategyLeaderboardReport>();
    leaderboardBuilder.mockReturnValueOnce(pending.promise);
    const first = buildCachedStrategyLeaderboard({ system, snapshot });
    await Promise.resolve();
    vi.setSystemTime(new Date(snapshotDate.getTime() + 45_000));
    const concurrent = buildCachedStrategyLeaderboard({ system, snapshot });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);
    pending.resolve(reportFor(snapshot));
    const report = await first;
    expect(await concurrent).toBe(report);
    vi.setSystemTime(new Date(snapshotDate.getTime() + 74_999));
    expect(await buildCachedStrategyLeaderboard({ system, snapshot })).toBe(report);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(snapshotDate.getTime() + 75_000));
    await buildCachedStrategyLeaderboard({ system, snapshot });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
  });

  it("removes failed calculations so the next call retries", async () => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    const pending = deferred<StrategyLeaderboardReport>();
    leaderboardBuilder.mockReturnValueOnce(pending.promise);
    const first = buildCachedStrategyLeaderboard({ system, snapshot });
    const second = buildCachedStrategyLeaderboard({ system, snapshot });
    const results = Promise.allSettled([first, second]);
    pending.reject(new Error("research failed"));
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await buildCachedStrategyLeaderboard({ system, snapshot });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
  });

  it("retains at most eight calculation keys per system", async () => {
    const system = newSystem();
    const snapshot = system.market.getSnapshot();
    for (let seed = 0; seed < 8; seed++) {
      await buildCachedStrategyLeaderboard({ system, snapshot, seed });
    }
    await buildCachedStrategyLeaderboard({ system, snapshot, seed: 0 });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(8);
    await buildCachedStrategyLeaderboard({ system, snapshot, seed: 8 });
    await buildCachedStrategyLeaderboard({ system, snapshot, seed: 1 });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(9);
    await buildCachedStrategyLeaderboard({ system, snapshot, seed: 0 });
    expect(leaderboardBuilder).toHaveBeenCalledTimes(10);
  });

  it("reuses a real MockMarket version as wall-clock time advances, then recalculates after a tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(snapshotDate);
    const system = createTradingSystem(config);
    const initial = system.market.getSnapshot();
    const first = await buildCachedStrategyLeaderboard({ system, snapshot: initial });

    await vi.advanceTimersByTimeAsync(137);
    const reread = system.market.getSnapshot();
    expect(Date.now()).toBe(snapshotDate.getTime() + 137);
    expect(reread).toEqual(initial);
    expect(await buildCachedStrategyLeaderboard({ system, snapshot: reread })).toBe(first);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);

    const updated = system.market.tick();
    expect(updated.sequence).toBeGreaterThan(initial.sequence);
    expect(updated.marketTime).toBe(new Date().toISOString());
    expect(await buildCachedStrategyLeaderboard({ system, snapshot: updated })).not.toBe(first);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
  });

  it("reuses a real AkShare HTTP provider version between successful polls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(snapshotDate);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
      const url = new URL(String(request));
      const symbols = url.searchParams.get("symbols")!.split(",");
      const quotes = symbols.map((symbol) => ({
        symbol,
        name: "测试行情",
        tradable: url.pathname.endsWith("/quotes"),
        price: 10,
        previousClose: 9.9,
        changePercent: 1,
        volume: 1_000_000,
        updatedAt: new Date().toISOString(),
      }));
      return new Response(JSON.stringify({ quotes }));
    });
    const system = createTradingSystem({
      ...config,
      MARKET_DATA_PROVIDER: "akshare",
      MARKET_SYMBOLS: "600519",
      MARKET_TICK_MS: 1_000,
    });
    system.market.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const initial = system.market.getSnapshot();
      expect(initial.sequence).toBe(1);
      const first = await buildCachedStrategyLeaderboard({ system, snapshot: initial });

      await vi.advanceTimersByTimeAsync(137);
      const reread = system.market.getSnapshot();
      expect(reread).toEqual(initial);
      expect(await buildCachedStrategyLeaderboard({ system, snapshot: reread })).toBe(first);
      expect(leaderboardBuilder).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      const updated = system.market.getSnapshot();
      expect(updated.sequence).toBeGreaterThan(initial.sequence);
      expect(updated.marketTime).not.toBe(initial.marketTime);
      expect(await buildCachedStrategyLeaderboard({ system, snapshot: updated })).not.toBe(first);
      expect(leaderboardBuilder).toHaveBeenCalledTimes(2);
    } finally {
      system.market.stop();
    }
  });

  it("reuses the same calculation across API and Paper while rebuilding account-dependent plans", async () => {
    const system = newSystem();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    app = await buildTradingApp({ config, system, startMarket: false });
    const [response, initial] = await Promise.all([
      app.inject({ method: "GET", url: "/api/research/strategy-leaderboard?bars=120" }),
      buildCurrentPaperTradingPlan({ system, config }),
    ]);
    expect(response.statusCode).toBe(200);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual(initial.leaderboard);

    system.broker.resetAccount({
      startingCash: 20_000,
      strategyProfile: "growth",
      executionStrategy: "auto",
    });
    const updated = await buildCurrentPaperTradingPlan({ system, config });
    expect(updated.leaderboard).toBe(initial.leaderboard);
    expect(updated.plan).not.toBe(initial.plan);
    expect(initial.plan.account.cash).toBe(config.TRADING_STARTING_CASH);
    expect(updated.plan.account.cash).toBe(20_000);
    expect(leaderboardBuilder).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
