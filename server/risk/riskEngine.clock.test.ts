import { describe, expect, it, vi } from "vitest";
import type { AccountSnapshot, EnhancedRiskLimits } from "../../shared/trading";
import { RiskEngine } from "./riskEngine";

const limits: EnhancedRiskLimits = { maxOrderNotional: 100_000, maxPositionWeight: 0.8, maxDailyLoss: 1,
  lotSize: 100, realTradingEnabled: false, dynamicPositionScaling: true, maxDrawdownReductionFactor: 0.25,
  circuitBreaker: { maxConsecutiveLosses: 5, maxDailyDrawdown: 0.08, cooldownMinutes: 15, recoveryMinutes: 5 } };

function fixture() {
  let time = new Date("2026-11-02T02:00:00.000Z");
  const now = () => time;
  const callback = vi.fn();
  const risk = new RiskEngine({ ...limits, circuitBreaker: { ...limits.circuitBreaker } }, callback, now);
  const account: AccountSnapshot = { accountId: "PAPER-CN-01", mode: "paper", cash: 100_000,
    equity: 100_000, marketValue: 0, realizedPnl: 0, unrealizedPnl: 0, dailyPnl: 0,
    dailyPnlPercent: 0, riskUtilization: 0, paused: false, updatedAt: now().toISOString() };
  const evaluate = () => risk.evaluate({ request: { symbol: "600001", side: "buy", type: "market", quantity: 100 },
    quote: { symbol: "600001", name: "test", price: 10, previousClose: 10, volume: 1_000_000,
      tradable: true, changePercent: 0, updatedAt: now().toISOString() }, account, mode: "paper" });
  return { risk, callback, now, evaluate, setTime(value: string) { time = new Date(value); },
    advance(minutes: number) { time = new Date(time.getTime() + minutes * 60_000); } };
}

describe("risk equity observations and injected Beijing clock", () => {
  it("observes a peak and drawdown without inventing a trade", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(96_000);
    expect(f.risk.getState()).toMatchObject({ peakDailyEquity: 100_000,
      tradeCount: 0, lossCount: 0, consecutiveLosses: 0, lastTradeTime: null, tradingDate: "2026-11-02" });
    expect(f.risk.getState().dailyDrawdown).toBeCloseTo(0.04);
    expect(f.risk.getEffectiveMaxPositionWeight()).toBeCloseTo(0.5);
  });

  it("uses an evidenced opening baseline before the first observation", () => {
    const f = fixture(); f.risk.observeEquity(95_000, 100_000);
    expect(f.risk.getState().peakDailyEquity).toBe(100_000);
    expect(f.risk.getState().dailyDrawdown).toBeCloseTo(0.05);
    expect(f.risk.getState().tradeCount).toBe(0);
  });

  it("does not repeatedly reset the peak using a lower baseline", () => {
    const f = fixture(); f.risk.observeEquity(110_000, 100_000); f.risk.observeEquity(106_000, 100_000);
    f.risk.setInitialEquity(50_000);
    expect(f.risk.getState().peakDailyEquity).toBe(110_000);
    expect(f.risk.getState().dailyDrawdown).toBeCloseTo(1 - 106_000 / 110_000);
  });

  it("trips on mark-to-market drawdown with no closed trades", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(91_000);
    expect(f.risk.getState()).toMatchObject({ circuitState: "tripped", tradeCount: 0, lossCount: 0 });
    expect(f.evaluate().code).toBe("CIRCUIT_BREAKER_TRIPPED");
  });

  it("does not restart cooldown or emit repeated trip alerts on every observation", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(91_000);
    const trippedAt = f.risk.getState().trippedAt;
    for (let i = 0; i < 10; i++) { f.advance(1); f.risk.observeEquity(90_000); }
    expect(f.risk.getState().trippedAt).toBe(trippedAt);
    expect(f.callback.mock.calls.filter(([event]) => event.level === "critical")).toHaveLength(1);
  });

  it("reports the recovery observation period using the injected clock", () => {
    const f = fixture(); f.risk.observeEquity(100_000);
    for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, 99_995);
    f.advance(14); expect(f.evaluate().allowed).toBe(false);
    f.advance(1); expect(f.evaluate()).toMatchObject({ allowed: true, code: "CIRCUIT_RECOVERING" });
    f.advance(5); expect(f.evaluate().allowed).toBe(true);
    expect(f.risk.getState()).toMatchObject({ circuitState: "normal", consecutiveLosses: 0, trippedAt: null });
  });

  it("keeps a tripped circuit latched when equity recovers before cooldown", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(91_000);
    f.advance(1); f.risk.observeEquity(101_000);
    expect(f.evaluate().allowed).toBe(false);
    expect(f.risk.getState().dailyDrawdown).toBe(0);
  });

  it("resets only the daily peak at Beijing midnight and preserves loss streak/counts", () => {
    const f = fixture(); f.risk.observeEquity(100_000);
    f.risk.recordTradeResult(-100, 99_900); f.risk.recordTradeResult(-100, 99_800);
    f.setTime("2026-11-02T16:00:00.000Z");
    f.risk.observeEquity(99_800, 99_800);
    expect(f.risk.getState()).toMatchObject({ tradingDate: "2026-11-03", peakDailyEquity: 99_800,
      dailyDrawdown: 0, consecutiveLosses: 2, tradeCount: 2, lossCount: 2 });
    f.risk.recordTradeResult(-100, 99_700);
    expect(f.risk.getState().consecutiveLosses).toBe(3);
  });

  it("does not reset a daily peak at UTC midnight", () => {
    const f = fixture(); f.setTime("2026-11-02T23:59:00Z"); f.risk.observeEquity(100_000);
    f.advance(2); f.risk.observeEquity(99_000);
    expect(f.risk.getState()).toMatchObject({ tradingDate: "2026-11-03", peakDailyEquity: 100_000 });
    expect(f.risk.getState().dailyDrawdown).toBeCloseTo(0.01);
  });

  it("preserves cooldown crossing Beijing midnight", () => {
    const f = fixture(); f.setTime("2026-11-02T15:59:00Z");
    f.risk.observeEquity(100_000); f.risk.observeEquity(91_000);
    f.advance(2); f.risk.observeEquity(91_000, 91_000);
    expect(f.evaluate().code).toBe("CIRCUIT_BREAKER_TRIPPED");
    expect(f.risk.getState().peakDailyEquity).toBe(91_000);
  });

  it("starts fresh daily drawdown after an overnight drop with a new evidenced baseline", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(95_000);
    f.setTime("2026-11-03T02:00:00Z"); f.risk.observeEquity(94_000, 95_000);
    expect(f.risk.getState().dailyDrawdown).toBeCloseTo(1 - 94_000 / 95_000);
  });

  it("ignores invalid equity observations and initial baselines", () => {
    const f = fixture(); f.risk.observeEquity(100_000);
    const before = f.risk.getState();
    for (const value of [NaN, Infinity, -1]) { f.risk.observeEquity(value); f.risk.setInitialEquity(value); }
    expect(f.risk.getState()).toEqual(before);
  });

  it("rejects invalid trade evidence without changing counters", () => {
    const f = fixture();
    expect(() => f.risk.recordTradeResult(NaN, 100_000)).toThrow();
    expect(() => f.risk.recordTradeResult(-1, Infinity)).toThrow();
    expect(f.risk.getState().tradeCount).toBe(0);
  });

  it("treats zero equity as complete drawdown when an initial peak exists", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(0);
    expect(f.risk.getState()).toMatchObject({ dailyDrawdown: 1, circuitState: "tripped", tradeCount: 0 });
  });

  it("manual reset establishes a fresh baseline from the next observation", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.recordTradeResult(-100, 90_000);
    f.risk.resetCircuit(); f.risk.observeEquity(90_000);
    expect(f.risk.getState()).toMatchObject({ peakDailyEquity: 90_000, dailyDrawdown: 0,
      circuitState: "normal", consecutiveLosses: 0, tradeCount: 0 });
  });

  it("does not expose mutable nested risk configuration", () => {
    const f = fixture(); f.risk.getLimits().circuitBreaker.maxConsecutiveLosses = 999;
    expect(f.risk.getLimits().circuitBreaker.maxConsecutiveLosses).toBe(5);
  });

  it("records closed-trade times from the injected clock", () => {
    const f = fixture(); f.risk.recordTradeResult(-1, 100_000);
    expect(f.risk.getState().lastTradeTime).toBe(f.now().toISOString());
  });

  it("does not erase a same-day peak through setInitialEquity", () => {
    const f = fixture(); f.risk.setInitialEquity(100_000);
    f.risk.recordTradeResult(-1, 99_000); f.risk.setInitialEquity(99_000);
    expect(f.risk.getState().peakDailyEquity).toBe(100_000);
  });

  it("uses the injected cooldown for closed-trade-only callers", () => {
    const f = fixture(); f.risk.setInitialEquity(100_000);
    for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, 99_995);
    f.advance(16);
    expect(f.evaluate()).toMatchObject({ allowed: true, code: "CIRCUIT_RECOVERING" });
  });

  it("preserves the trip timestamp when further loss samples arrive", () => {
    const f = fixture(); f.risk.setInitialEquity(100_000);
    for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, 99_995);
    const trippedAt = f.risk.getState().trippedAt;
    f.advance(5); f.risk.recordTradeResult(-1, 99_994);
    expect(f.risk.getState().trippedAt).toBe(trippedAt);
  });

  it("does not restart the original wall-clock cooldown on a further loss", () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(f.now()); f.risk.setInitialEquity(100_000);
      for (let i = 0; i < 5; i++) f.risk.recordTradeResult(-1, 99_995);
      const trippedAt = f.risk.getState().trippedAt;
      f.advance(5); vi.setSystemTime(f.now()); f.risk.recordTradeResult(-1, 99_994);
      expect(f.risk.getState().trippedAt).toBe(trippedAt);
    } finally { vi.useRealTimers(); }
  });

  it("clears a recovered drawdown warning without creating trades", () => {
    const f = fixture(); f.risk.observeEquity(100_000); f.risk.observeEquity(95_000);
    const warningAt = f.risk.getState().warningAt;
    expect(f.risk.getState().circuitState).toBe("warning");
    f.advance(1); f.risk.observeEquity(95_000);
    expect(f.risk.getState().warningAt).toBe(warningAt);
    f.risk.observeEquity(100_000);
    expect(f.risk.getState()).toMatchObject({ circuitState: "normal", tradeCount: 0, warningAt: null });
  });

  it("does not warn on zero losses with a one-loss trip threshold", () => {
    const f = fixture();
    const risk = new RiskEngine({ ...limits, circuitBreaker: { ...limits.circuitBreaker, maxConsecutiveLosses: 1 } }, undefined, f.now);
    risk.observeEquity(100_000);
    expect(risk.getState().circuitState).toBe("normal");
    risk.recordTradeResult(-1, 99_999);
    expect(risk.getState().circuitState).toBe("tripped");
  });
});
