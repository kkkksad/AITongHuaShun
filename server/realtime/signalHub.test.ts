import { describe, expect, it, vi } from "vitest";
import {
  createSignal,
  SignalHub,
  type SignalGenerator,
} from "./signalHub";
import type { TradingSignal } from "../../shared/trading";

// ── 辅助 ──────────────────────────────────────────────────

function makeGenerator(
  strategyId: string,
  strategyName: string,
  signals: TradingSignal[] = [],
): SignalGenerator {
  return {
    strategyId,
    strategyName,
    evaluate: vi.fn(() => signals),
    push: vi.fn(),
  };
}

function makeBuySignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return createSignal({
    strategyId: "momentum",
    strategyName: "动量策略",
    symbol: "000001",
    direction: "buy",
    strength: 0.8,
    positionSize: 0.15,
    price: 12.5,
    reason: "突破20日均线",
    ...overrides,
  });
}

// ── 测试 ──────────────────────────────────────────────────

describe("SignalHub", () => {
  it("should register and retrieve strategy generators", () => {
    const hub = new SignalHub();
    const gen = makeGenerator("momentum", "动量策略");

    hub.registerGenerator(gen);
    expect(hub.strategyIds).toContain("momentum");
    expect(hub.generatorCount).toBe(1);
  });

  it("should throw when registering duplicate strategyId", () => {
    const hub = new SignalHub();
    hub.registerGenerator(makeGenerator("momentum", "动量策略"));

    expect(() =>
      hub.registerGenerator(makeGenerator("momentum", "动量策略v2")),
    ).toThrow(/already registered/);
  });

  it("should unregister strategy generators", () => {
    const hub = new SignalHub();
    hub.registerGenerator(makeGenerator("momentum", "动量策略"));

    const removed = hub.unregisterGenerator("momentum");
    expect(removed).toBe(true);
    expect(hub.generatorCount).toBe(0);
  });

  it("should return false when unregistering non-existent generator", () => {
    const hub = new SignalHub();
    expect(hub.unregisterGenerator("nonexistent")).toBe(false);
  });

  it("should subscribe and receive signals", () => {
    const hub = new SignalHub();
    const listener = vi.fn();
    const unsubscribe = hub.subscribe(listener);

    const signal = makeBuySignal();
    hub.broadcast(signal);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(signal);

    // Unsubscribe
    unsubscribe();
    hub.broadcast(makeBuySignal());
    expect(listener).toHaveBeenCalledTimes(1); // no additional calls
  });

  it("should broadcast to multiple listeners", () => {
    const hub = new SignalHub();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    hub.subscribe(listener1);
    hub.subscribe(listener2);

    const signal = makeBuySignal();
    hub.broadcast(signal);

    expect(listener1).toHaveBeenCalledWith(signal);
    expect(listener2).toHaveBeenCalledWith(signal);
  });

  it("should handle listener errors gracefully", () => {
    const hub = new SignalHub();
    const badListener = vi.fn(() => {
      throw new Error("listener failure");
    });
    const goodListener = vi.fn();

    hub.subscribe(badListener);
    hub.subscribe(goodListener);

    // Should not throw
    expect(() => hub.broadcast(makeBuySignal())).not.toThrow();
    expect(goodListener).toHaveBeenCalledTimes(1);
  });

  it("should filter signals by strategyId", () => {
    const hub = new SignalHub();
    const result = hub.broadcastFiltered(
      makeBuySignal({ strategyId: "momentum" }),
      { strategyIds: ["momentum"] },
    );
    expect(result).toBe(true);

    const result2 = hub.broadcastFiltered(
      makeBuySignal({ strategyId: "meanReversion" }),
      { strategyIds: ["momentum"] },
    );
    expect(result2).toBe(false);
  });

  it("should filter signals by symbol", () => {
    const hub = new SignalHub();
    const result = hub.broadcastFiltered(
      makeBuySignal({ symbol: "000001" }),
      { symbols: ["000001", "000002"] },
    );
    expect(result).toBe(true);

    const result2 = hub.broadcastFiltered(
      makeBuySignal({ symbol: "600000" }),
      { symbols: ["000001"] },
    );
    expect(result2).toBe(false);
  });

  it("should filter signals by minStrength", () => {
    const hub = new SignalHub();
    const result = hub.broadcastFiltered(
      makeBuySignal({ strength: 0.9 }),
      { minStrength: 0.7 },
    );
    expect(result).toBe(true);

    const result2 = hub.broadcastFiltered(
      makeBuySignal({ strength: 0.3 }),
      { minStrength: 0.7 },
    );
    expect(result2).toBe(false);
  });

  it("should filter signals by minConfidence", () => {
    const hub = new SignalHub();
    const result = hub.broadcastFiltered(
      makeBuySignal({ confidence: 0.85 }),
      { minConfidence: 0.7 },
    );
    expect(result).toBe(true);

    const result2 = hub.broadcastFiltered(
      makeBuySignal({ confidence: 0.5 }),
      { minConfidence: 0.7 },
    );
    expect(result2).toBe(false);
  });

  it("should evaluate all generators", () => {
    const hub = new SignalHub();
    const gen1 = makeGenerator("momentum", "动量策略", [
      makeBuySignal({ strategyId: "momentum" }),
    ]);
    const gen2 = makeGenerator("meanReversion", "均值回归", [
      createSignal({
        strategyId: "meanReversion",
        strategyName: "均值回归",
        symbol: "000002",
        direction: "sell",
        strength: 0.7,
        positionSize: 0.1,
        price: 8.5,
        reason: "超买信号",
      }),
    ]);

    hub.registerGenerator(gen1);
    hub.registerGenerator(gen2);

    const signals = hub.evaluateAll();
    expect(signals.length).toBe(2);
    expect(gen1.evaluate).toHaveBeenCalled();
    expect(gen2.evaluate).toHaveBeenCalled();
  });

  it("should handle generator evaluation errors gracefully", () => {
    const hub = new SignalHub();
    const badGen: SignalGenerator = {
      strategyId: "bad",
      strategyName: "Bad Strategy",
      evaluate: () => {
        throw new Error("eval failure");
      },
      push: vi.fn(),
    };
    const goodGen = makeGenerator("good", "Good Strategy", [
      makeBuySignal({ strategyId: "good" }),
    ]);

    hub.registerGenerator(badGen);
    hub.registerGenerator(goodGen);

    // Should not throw
    expect(() => hub.evaluateAll()).not.toThrow();
  });

  it("should track active signals", () => {
    const hub = new SignalHub();
    const signal = makeBuySignal();
    hub.broadcast(signal);

    const active = hub.getActiveSignals();
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.some((s) => s.id === signal.id)).toBe(true);
  });

  it("should expire signals past TTL", async () => {
    const hub = new SignalHub();
    const signal = createSignal({
      strategyId: "momentum",
      strategyName: "动量策略",
      symbol: "000001",
      direction: "buy",
      strength: 0.8,
      positionSize: 0.15,
      price: 12.5,
      reason: "test",
      ttlSeconds: 1,
    });

    hub.broadcast(signal);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const active = hub.getActiveSignals();
    expect(active.some((s) => s.id === signal.id)).toBe(false);
  });

  it("should mark signal as executed", () => {
    const hub = new SignalHub();
    const signal = makeBuySignal();
    hub.broadcast(signal);

    const result = hub.markExecuted(signal.id);
    expect(result).toBe(true);

    const active = hub.getActiveSignals();
    expect(active.some((s) => s.id === signal.id)).toBe(false);
  });

  it("should return false when marking non-existent signal", () => {
    const hub = new SignalHub();
    expect(hub.markExecuted("nonexistent")).toBe(false);
  });

  it("should cancel signal and broadcast cancellation", () => {
    const hub = new SignalHub();
    const listener = vi.fn();
    hub.subscribe(listener);

    const signal = makeBuySignal();
    hub.broadcast(signal);
    listener.mockClear();

    const result = hub.cancelSignal(signal.id);
    expect(result).toBe(true);

    // Cancellation broadcast
    expect(listener).toHaveBeenCalledTimes(1);
    const cancelledSignal = listener.mock.calls[0][0] as TradingSignal;
    expect(cancelledSignal.status).toBe("cancelled");
  });

  it("should support auto-evaluate with interval", () => {
    vi.useFakeTimers();

    const hub = new SignalHub();
    const gen = makeGenerator("momentum", "动量策略", [
      makeBuySignal(),
    ]);
    hub.registerGenerator(gen);

    hub.startAutoEvaluate(5000);
    expect(gen.evaluate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(gen.evaluate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(gen.evaluate).toHaveBeenCalledTimes(2);

    hub.stopAutoEvaluate();
    vi.advanceTimersByTime(5000);
    expect(gen.evaluate).toHaveBeenCalledTimes(2); // no more calls

    vi.useRealTimers();
  });

  it("should track listener count", () => {
    const hub = new SignalHub();
    expect(hub.listenerCount).toBe(0);

    const unsub1 = hub.subscribe(() => {});
    expect(hub.listenerCount).toBe(1);

    const unsub2 = hub.subscribe(() => {});
    expect(hub.listenerCount).toBe(2);

    unsub1();
    expect(hub.listenerCount).toBe(1);

    unsub2();
    expect(hub.listenerCount).toBe(0);
  });

  it("should dispose all resources", () => {
    const hub = new SignalHub();
    hub.registerGenerator(makeGenerator("momentum", "动量策略"));
    hub.subscribe(() => {});

    hub.dispose();
    expect(hub.listenerCount).toBe(0);
    expect(hub.generatorCount).toBe(0);
  });
});

describe("createSignal", () => {
  it("should create a valid trading signal", () => {
    const signal = makeBuySignal();

    expect(signal.id).toMatch(/^sig_\d+_\d+$/);
    expect(signal.strategyId).toBe("momentum");
    expect(signal.symbol).toBe("000001");
    expect(signal.direction).toBe("buy");
    expect(signal.strength).toBe(0.8);
    expect(signal.status).toBe("active");
    expect(signal.timestamp).toBeTruthy();
  });

  it("should clamp strength to 0-1 range", () => {
    const high = createSignal({
      strategyId: "test",
      strategyName: "test",
      symbol: "000001",
      direction: "buy",
      strength: 1.5,
      positionSize: 0.1,
      price: 10,
      reason: "test",
    });
    expect(high.strength).toBe(1);

    const low = createSignal({
      strategyId: "test",
      strategyName: "test",
      symbol: "000001",
      direction: "buy",
      strength: -0.5,
      positionSize: 0.1,
      price: 10,
      reason: "test",
    });
    expect(low.strength).toBe(0);
  });

  it("should default confidence to strength when not provided", () => {
    const signal = createSignal({
      strategyId: "test",
      strategyName: "test",
      symbol: "000001",
      direction: "buy",
      strength: 0.75,
      positionSize: 0.1,
      price: 10,
      reason: "test",
    });
    expect(signal.confidence).toBe(0.75);
  });

  it("should default ttlSeconds to 300", () => {
    const signal = createSignal({
      strategyId: "test",
      strategyName: "test",
      symbol: "000001",
      direction: "buy",
      strength: 0.5,
      positionSize: 0.1,
      price: 10,
      reason: "test",
    });
    expect(signal.ttlSeconds).toBe(300);
  });
});
