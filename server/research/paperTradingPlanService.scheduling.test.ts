import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { buildCurrentPaperTradingPlan } from "./paperTradingPlanService";
import { buildUnavailableMarketRegimeResearch } from "./marketRegimeResearch";
import { buildUnavailableRealResearchDataFeed } from "./realResearchData";
import { buildUnavailableExternalMarketImpact } from "./externalMarketImpact";
import { buildUnavailableStrategyLeaderboard } from "./strategyLeaderboard";

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
