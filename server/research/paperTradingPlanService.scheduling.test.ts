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

  it("bounds core at twelve seconds then auxiliary at four seconds and observes late rejections", async () => {
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
    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect((await result).marketRegimeResearch.sourceStatus).toBe("degraded");
    core.reject(new Error("late core failure"));
    auxiliary.reject(new Error("late auxiliary failure"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
