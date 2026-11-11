import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { buildCurrentPaperTradingPlan } from "./paperTradingPlanService";
import { buildUnavailableMarketRegimeResearch } from "./marketRegimeResearch";
import { buildUnavailableRealResearchDataFeed } from "./realResearchData";
import { buildUnavailableExternalMarketImpact } from "./externalMarketImpact";
import { buildUnavailableStrategyLeaderboard } from "./strategyLeaderboard";
import { InMemoryResearchStore } from "./researchStore";

const builders = vi.hoisted(() => ({ core: vi.fn(), news: vi.fn(), external: vi.fn(), leaderboard: vi.fn() }));
vi.mock("./marketRegimeResearch", async (original) => ({
  ...await original<typeof import("./marketRegimeResearch")>(), buildMarketRegimeResearch: builders.core,
}));
vi.mock("./realResearchData", async (original) => ({
  ...await original<typeof import("./realResearchData")>(), buildRealResearchDataFeed: builders.news,
}));
vi.mock("./externalMarketImpact", async (original) => ({
  ...await original<typeof import("./externalMarketImpact")>(), buildExternalMarketImpact: builders.external,
}));
vi.mock("./strategyLeaderboardService", () => ({ buildCachedStrategyLeaderboard: builders.leaderboard }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const config = createTestConfig({ MARKET_MODE: "paper", TRADING_SEED_PORTFOLIO: false, MARKET_DATA_TIMEOUT_MS: 8_000 });
const date = new Date("2026-11-09T02:00:00Z");
function input() {
  const system = createTradingSystem(config, () => date);
  system.marketDataProvider = "akshare";
  return { config, system, now: date };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(date);
  builders.core.mockReset().mockImplementation(async (value) => buildUnavailableMarketRegimeResearch(value, "fixture"));
  builders.news.mockReset().mockImplementation(async (value) => buildUnavailableRealResearchDataFeed(value, "fixture"));
  builders.external.mockReset().mockImplementation(async (value) => buildUnavailableExternalMarketImpact(value, "fixture"));
  builders.leaderboard.mockReset().mockImplementation(async (value) =>
    buildUnavailableStrategyLeaderboard(value.snapshot, value.system.marketDataProvider));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("Paper research resource ordering", () => {
  it.each([
    { executionStrategy: "auto" as const, active: true, rotates: true },
    { executionStrategy: "rsi" as const, active: true, rotates: false },
    { executionStrategy: "auto" as const, active: false, rotates: false },
  ])("uses the frozen minute only for automatic active history exploration: $executionStrategy/$active", async ({ executionStrategy, active, rotates }) => {
    const request = input();
    request.system.store.setExecutionStrategy(executionStrategy);
    const original = request.system.market.getSnapshot();
    const base = original.quotes[0];
    const quotes = Array.from({ length: 25 }, (_, i) => ({ ...base,
      symbol: `6000${String(i).padStart(2, "0")}`, name: `轮换${i}`, price: 9,
      changePercent: 1.5, previousClose: 8.9, open: 9, high: 9.1, low: 8.9,
      amplitude: 2, turnover: 3, amount: 500_000_000, volume: 10_000_000,
      updatedAt: date.toISOString(), tradable: true,
    }));
    vi.spyOn(request.system.market, "getSnapshot").mockReturnValue({ ...original, quotes });
    const run = (offset: number) => buildCurrentPaperTradingPlan({ ...request,
      activityTargetActive: active, now: new Date(date.getTime() + offset),
    });
    await run(0);
    const first = builders.core.mock.calls.at(-1)![0].preferredStocks;
    await run(1_000);
    expect(builders.core.mock.calls.at(-1)![0].preferredStocks).toEqual(first);
    await run(60_000);
    const last = builders.core.mock.calls.at(-1)![0].preferredStocks;
    expect(last).toHaveLength(active ? 12 : 6);
    expect(last.slice(0, -1)).toEqual(first.slice(0, -1));
    if (rotates) {
      expect(last.at(-1)).not.toEqual(first.at(-1));
      expect(builders.core).toHaveBeenCalledTimes(2);
    } else expect(last).toEqual(first);
    expect(request.system.broker.getOrders()).toEqual([]);
  });

  it("does not reuse a later same-day core context after the planning clock moves backwards", async () => {
    const request = input(); const original = request.system.market.getSnapshot();
    const snapshot = vi.spyOn(request.system.market, "getSnapshot");
    for (const time of ["2026-11-09T06:30:10Z", "2026-11-09T06:30:00Z"]) {
      snapshot.mockReturnValue({ ...original, marketTime: time });
      const result = await buildCurrentPaperTradingPlan({ ...request, now: new Date(time) });
      expect(result.marketRegimeResearch.generatedAt).toBe(new Date(time).toISOString());
    }
    expect(builders.core).toHaveBeenCalledTimes(2);
    expect(request.system.broker.getOrders()).toEqual([]);
  });

  it("does not share a later pending core context with an earlier concurrent request", async () => {
    const request = input(); const original = request.system.market.getSnapshot();
    const laterTime = "2026-11-09T06:30:10Z", earlierTime = "2026-11-09T06:30:00Z";
    const future = deferred<ReturnType<typeof buildUnavailableMarketRegimeResearch>>();
    builders.core.mockImplementation(value => value.now.toISOString() === new Date(laterTime).toISOString()
      ? future.promise : buildUnavailableMarketRegimeResearch(value, "earlier"));
    const snapshot = vi.spyOn(request.system.market, "getSnapshot");
    snapshot.mockReturnValue({ ...original, marketTime: laterTime });
    const later = buildCurrentPaperTradingPlan({ ...request, now: new Date(laterTime) });
    await vi.advanceTimersByTimeAsync(0);
    snapshot.mockReturnValue({ ...original, marketTime: earlierTime });
    const earlier = buildCurrentPaperTradingPlan({ ...request, now: new Date(earlierTime) });
    await vi.advanceTimersByTimeAsync(0);
    future.resolve(buildUnavailableMarketRegimeResearch(builders.core.mock.calls[0][0], "later"));
    const [first, second] = await Promise.all([later, earlier]);
    expect(first.marketRegimeResearch.generatedAt).toBe(new Date(laterTime).toISOString());
    expect(second.marketRegimeResearch.generatedAt).toBe(new Date(earlierTime).toISOString());
    expect(builders.core).toHaveBeenCalledTimes(2);
    expect(request.system.broker.getOrders()).toEqual([]);
  });

  it("returns the core plan immediately while slow auxiliary sources warm, then consumes completed bounded snapshots", async () => {
    const request = input();
    const pending = deferred<ReturnType<typeof buildUnavailableRealResearchDataFeed>>();
    builders.news.mockReturnValue(pending.promise);
    builders.external.mockReturnValue(new Promise(() => {}));
    let result: Awaited<ReturnType<typeof buildCurrentPaperTradingPlan>> | undefined;
    const first = buildCurrentPaperTradingPlan(request).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeDefined();
    expect(result?.realResearchDataFeed.news.warning).toContain("后台预热");
    expect(result?.externalMarketImpact.warnings.join(" ")).toContain("后台预热");
    pending.resolve({ ...buildUnavailableRealResearchDataFeed(builders.news.mock.calls[0][0], "fixture-source-warning"), sourceStatus: "live-read-only" });
    await vi.advanceTimersByTimeAsync(1);
    const second = await buildCurrentPaperTradingPlan({ ...request, now: new Date(date.getTime() + 1) });
    expect(second.realResearchDataFeed.news.warning).toBe("fixture-source-warning");
    expect(second.plan.operations).toEqual(result!.plan.operations);
    expect(second.adaptiveRouting.allowNewPositions).toBe(result!.adaptiveRouting.allowNewPositions);
    expect(builders.news).toHaveBeenCalledOnce();
    expect(request.system.broker.getOrders()).toEqual([]);
    await first;
  });

  it("finishes a 100ms core plan at 100ms rather than waiting an additional 4000ms for optional sources", async () => {
    const request = input();
    builders.core.mockImplementationOnce(async value => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return buildUnavailableMarketRegimeResearch(value, "fixture");
    });
    builders.news.mockReturnValue(new Promise(() => {}));
    builders.external.mockReturnValue(new Promise(() => {}));
    let finishedAt: number | undefined;
    const started = Date.now();
    const pending = buildCurrentPaperTradingPlan(request).then(() => { finishedAt = Date.now() - started; });
    await vi.advanceTimersByTimeAsync(99);
    expect(finishedAt).toBeUndefined(); expect(builders.news).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(finishedAt).toBe(100); expect(builders.news).toHaveBeenCalledOnce();
    await pending;
  });

  it("shares bounded auxiliary work across changing core candidate pools", async () => {
    const request = input();
    builders.news.mockReturnValue(new Promise(() => {}));
    builders.external.mockReturnValue(new Promise(() => {}));
    await buildCurrentPaperTradingPlan({ ...request, activityTargetActive: false });
    await buildCurrentPaperTradingPlan({ ...request, activityTargetActive: true });
    expect(builders.core).toHaveBeenCalledTimes(2);
    expect(builders.news).toHaveBeenCalledOnce();
    expect(builders.external).toHaveBeenCalledOnce();
  });

  it("uses the actual account and effective risk cap to keep impossible high-price entries from occupying all history slots", async () => {
    const request = input();
    const original = request.system.market.getSnapshot();
    const base = original.quotes[0];
    const quotes = Array.from({ length: 8 }, (_, index) => ({
      ...base, symbol: `6000${String(index).padStart(2, "0")}`, name: `候选${index}`,
      price: index === 7 ? 9 : 250 + index, changePercent: 1.5,
      tradable: true, previousClose: 9, updatedAt: date.toISOString(),
      amplitude: 2, turnover: 3, amount: 500_000_000, volume: 10_000_000,
    }));
    vi.spyOn(request.system.market, "getSnapshot").mockReturnValue({ ...original, quotes });
    vi.spyOn(request.system.risk, "getEffectiveMaxOrderNotional").mockReturnValue(1_000);
    await buildCurrentPaperTradingPlan(request);
    const selected = builders.core.mock.calls[0][0].preferredStocks.map((row: { symbol: string }) => row.symbol);
    expect(selected).toHaveLength(6);
    expect(selected[0]).toBe("600007");
    expect(request.system.broker.getOrders()).toEqual([]);
  });

  it("passes the frozen planning clock to core history research", async () => {
    const request = input();
    await buildCurrentPaperTradingPlan(request);
    expect(builders.core.mock.calls[0][0].now).toEqual(request.now);
  });

  it.each([false, true])("isolates cached history across the completed daily close, backwards=%s", async backwards => {
    const request = input();
    const original = request.system.market.getSnapshot();
    const times = ["2026-11-09T06:59:59Z", "2026-11-09T07:00:01Z"];
    if (backwards) times.reverse();
    const snapshot = vi.spyOn(request.system.market, "getSnapshot");
    for (const marketTime of times) {
      snapshot.mockReturnValue({ ...original, marketTime });
      await buildCurrentPaperTradingPlan({ ...request, now: new Date(marketTime) });
    }
    expect(builders.core).toHaveBeenCalledTimes(2);
  });

  it("still shares core history within the same completed-day boundary despite quote ticks", async () => {
    const request = input();
    const original = request.system.market.getSnapshot();
    const snapshot = vi.spyOn(request.system.market, "getSnapshot");
    for (const marketTime of ["2026-11-09T06:59:56Z", "2026-11-09T06:59:58Z"]) {
      snapshot.mockReturnValue({ ...original, marketTime });
      await buildCurrentPaperTradingPlan({ ...request, now: new Date(marketTime) });
    }
    expect(builders.core).toHaveBeenCalledOnce();
  });

  it("ignores defensive evidence after the supplied planning time", async () => {
    const request = input();
    vi.spyOn(request.system.store, "listAudit").mockReturnValue([{
      id: "future", category: "system", timestamp: "2026-11-09T02:00:00.001Z",
      action: "paper-auto-execution.run", message: "fixture", data: {
        tradingDate: "2026-11-09", session: "open", sourceStatus: "live-read-only", regime: "risk-off",
      },
    }]);
    const result = await buildCurrentPaperTradingPlan(request);
    expect(result.adaptiveRouting.regime).toBe("unclear");
    expect(result.adaptiveRouting.stability.status).toBe("direct");
  });

  it("captures a single default cutoff before asynchronous research advances the clock", async () => {
    const request = input();
    vi.spyOn(request.system.store, "listAudit").mockReturnValue([{
      id: "future", category: "system", timestamp: "2026-11-09T02:00:00.500Z",
      action: "paper-auto-execution.run", message: "fixture", data: {
        tradingDate: "2026-11-09", session: "open", sourceStatus: "live-read-only", regime: "risk-off",
      },
    }]);
    builders.core.mockImplementationOnce(async value => {
      vi.setSystemTime(new Date(date.getTime() + 1000));
      return buildUnavailableMarketRegimeResearch(value, "fixture");
    });
    const result = await buildCurrentPaperTradingPlan({ system: request.system, config: request.config });
    expect(result.adaptiveRouting.regime).toBe("unclear");
  });

  it("rejects an invalid planning clock before starting external research", async () => {
    const request = input();
    await expect(buildCurrentPaperTradingPlan({ ...request, now: new Date(NaN) }))
      .rejects.toThrow("Invalid Paper plan clock");
    expect(builders.core).not.toHaveBeenCalled();
    expect(builders.news).not.toHaveBeenCalled();
    expect(request.system.broker.getOrders()).toEqual([]);
  });

  it("shares the entry audit snapshot across routing and usage instead of rereading after research", async () => {
    const request = input();
    const read = vi.spyOn(request.system.store, "listAudit").mockReturnValue([]);
    builders.core.mockImplementationOnce(async value => {
      read.mockReturnValue([{
        id: "late-import", category: "system", timestamp: "2026-11-09T01:59:59Z",
        action: "paper-auto-execution.run", message: "fixture", data: {
          tradingDate: "2026-11-09", session: "open", sourceStatus: "live-read-only", regime: "risk-off",
        },
      }]);
      return buildUnavailableMarketRegimeResearch(value, "fixture");
    });
    const result = await buildCurrentPaperTradingPlan(request);
    expect(result.adaptiveRouting.regime).toBe("unclear");
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not start synthetic optimization for real-history plans even if the builder would hang", async () => {
    builders.leaderboard.mockImplementation(() => new Promise(() => {}));
    let result: Awaited<ReturnType<typeof buildCurrentPaperTradingPlan>> | undefined;
    const request = buildCurrentPaperTradingPlan(input()).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(result).toBeDefined();
    expect(builders.leaderboard).not.toHaveBeenCalled();
    expect(builders.core).toHaveBeenCalledOnce();
    expect(builders.news).toHaveBeenCalledOnce();
    expect(result?.leaderboard).toMatchObject({ evaluationStatus: "not-requested", entries: [] });
    expect(result?.leaderboard.guardrails.join(" ")).toContain("独立");
    expect(result?.leaderboard.guardrails.join(" ")).not.toContain("没有可交易行情");
    await request;
  });

  it("does not record a synthetic research run when only real-history planning was requested", async () => {
    const researchStore = new InMemoryResearchStore();
    const record = vi.spyOn(researchStore, "recordStrategyLeaderboard");
    const result = await buildCurrentPaperTradingPlan({ ...input(), researchStore });
    expect(result.leaderboard.entries).toEqual([]);
    expect(record).not.toHaveBeenCalled();
    expect(builders.leaderboard).not.toHaveBeenCalled();
  });

  it("preserves synthetic research and its history for the mock demonstration", async () => {
    const request = input();
    request.system.marketDataProvider = "mock";
    const researchStore = new InMemoryResearchStore();
    const record = vi.spyOn(researchStore, "recordStrategyLeaderboard");
    const pending = deferred<ReturnType<typeof buildUnavailableStrategyLeaderboard>>();
    builders.leaderboard.mockReturnValueOnce(pending.promise);
    let settled = false;
    const result = buildCurrentPaperTradingPlan({ ...request, researchStore }).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(builders.leaderboard).toHaveBeenCalledOnce();
    const report = buildUnavailableStrategyLeaderboard(request.system.market.getSnapshot(), "mock");
    pending.resolve(report);
    expect((await result).leaderboard).toBe(report);
    expect(record).toHaveBeenCalledWith(report);
  });
  it.each(["profile", "strategy-ABA", "pause-resume", "same-money-reset"])(
    "discards read-only plans when %s changes while shared research is pending", async (change) => {
      const request = input();
      builders.core.mockImplementationOnce(async value => {
        await Promise.resolve();
        const broker = request.system.broker;
        if (change === "profile") broker.setStrategyProfile("growth");
        if (change === "strategy-ABA") { broker.setExecutionStrategy("rsi"); broker.setExecutionStrategy("auto"); }
        if (change === "pause-resume") { broker.pause(); broker.resume(); }
        if (change === "same-money-reset") broker.resetAccount({ startingCash: config.TRADING_STARTING_CASH, strategyProfile: "balanced" });
        return buildUnavailableMarketRegimeResearch(value, "fixture");
      });
      await expect(buildCurrentPaperTradingPlan(request)).rejects.toMatchObject({ statusCode: 409 });
      const next = await buildCurrentPaperTradingPlan(request);
      expect(next.plan.strategyProfile.key).toBe(request.system.store.getStrategyProfile());
      expect(request.system.broker.getOrders()).toEqual([]);
    },
  );
  it.each([0, 37, 500])("passes the configured %s bps cost model into the resulting plan", async (slippageBps) => {
    const costConfig = createTestConfig({ ...config, SLIPPAGE_BPS: slippageBps });
    const system = createTradingSystem(costConfig, () => date);
    system.marketDataProvider = "akshare";
    const result = await buildCurrentPaperTradingPlan({ config: costConfig, system, now: date });
    expect(result.plan.rules.some(rule => rule.includes(`${slippageBps} bps 预计滑点`))).toBe(true);
  });
  it("lets core history use two bounded slots before auxiliary requests", async () => {
    const start = Date.now();
    let active = 0;
    let peak = 0;
    let coreFinishedAt: number | undefined;
    const queued: Array<() => void> = [];
    const work = (duration: number) => new Promise<void>((resolve) => {
      const launch = () => {
        active += 1;
        peak = Math.max(peak, active);
        setTimeout(() => { active -= 1; resolve(); queued.shift()?.(); }, duration);
      };
      if (active < 2) launch(); else queued.push(launch);
    });
    builders.core.mockImplementation(async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Initial sector snapshot.
      await Promise.all([work(50), work(50)]);
      coreFinishedAt = Date.now() - start;
      return buildUnavailableMarketRegimeResearch(value, "fixture");
    });
    builders.news.mockImplementation(async (value) => { await work(200); return buildUnavailableRealResearchDataFeed(value, "fixture"); });
    builders.external.mockImplementation(async (value) => { await work(200); return buildUnavailableExternalMarketImpact(value, "fixture"); });
    const result = buildCurrentPaperTradingPlan(input());
    await vi.runAllTimersAsync();
    await result;
    expect(coreFinishedAt).toBe(150);
    expect(peak).toBe(2);
  });

  it("does not start auxiliary work while core data remains pending, and shares concurrent plans", async () => {
    const request = input();
    const pending = deferred<ReturnType<typeof buildUnavailableMarketRegimeResearch>>();
    builders.core.mockReturnValueOnce(pending.promise);
    const first = buildCurrentPaperTradingPlan(request);
    const second = buildCurrentPaperTradingPlan(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(builders.core).toHaveBeenCalledOnce();
    expect(builders.news).not.toHaveBeenCalled();
    expect(builders.external).not.toHaveBeenCalled();
    pending.resolve(buildUnavailableMarketRegimeResearch(builders.core.mock.calls[0][0], "fixture"));
    await Promise.all([first, second]);
    expect(builders.news).toHaveBeenCalledOnce();
    expect(builders.external).toHaveBeenCalledOnce();
  });

  it("still starts auxiliary work after core failure and preserves explicit degraded data", async () => {
    builders.core.mockRejectedValueOnce(new Error("core offline"));
    builders.news.mockRejectedValueOnce(new Error("news offline"));
    const result = await buildCurrentPaperTradingPlan(input());
    expect(result.marketRegimeResearch.sourceStatus).toBe("degraded");
    expect(result.realResearchDataFeed.sourceStatus).toBe("degraded");
    expect(builders.external).toHaveBeenCalledOnce();
  });

  it("bounds core at twelve seconds, returns before the background deadline, and observes late rejections", async () => {
    const core = deferred<never>();
    const auxiliary = deferred<never>();
    builders.core.mockReturnValueOnce(core.promise);
    builders.news.mockReturnValueOnce(auxiliary.promise);
    builders.external.mockReturnValueOnce(auxiliary.promise);
    let settled = false;
    const result = buildCurrentPaperTradingPlan(input()).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(builders.news).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(builders.news).toHaveBeenCalledOnce();
    expect(builders.external).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect((await result).realResearchDataFeed.news.warning).toContain("后台预热");
    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect((await result).marketRegimeResearch.sourceStatus).toBe("degraded");
    core.reject(new Error("late core failure"));
    auxiliary.reject(new Error("late auxiliary failure"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
