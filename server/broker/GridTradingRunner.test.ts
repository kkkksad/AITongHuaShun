import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";
import type { PaperBroker } from "../broker/paperBroker";
import { GridTradingRunner } from "../broker/GridTradingRunner";
import type { MarketSnapshot, MarketQuote } from "../../shared/trading";

// ── Helpers ────────────────────────────────────────────────

function createMockQuote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    symbol: "600519",
    name: "贵州茅台",
    tradable: true,
    price: 1500,
    previousClose: 1490,
    changePercent: 0.67,
    volume: 10000000,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockSnapshot(quotes: MarketQuote[]): MarketSnapshot {
  return {
    mode: "mock",
    sequence: 1,
    marketTime: new Date().toISOString(),
    quotes,
  };
}

function createMockMarket(): {
  market: MarketDataProvider;
  listeners: Array<(s: MarketSnapshot) => void>;
} {
  const listeners: Array<(s: MarketSnapshot) => void> = [];
  return {
    market: {
      start: vi.fn(),
      stop: vi.fn(),
      tick: vi.fn(),
      getQuote: vi.fn(),
      getSnapshot: vi.fn(),
      on: vi.fn((_event: string, listener: (s: MarketSnapshot) => void) => {
        listeners.push(listener);
        return { on: vi.fn(), off: vi.fn() } as unknown as MarketDataProvider;
      }),
      off: vi.fn((_event: string, listener: (s: MarketSnapshot) => void) => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
        return { on: vi.fn(), off: vi.fn() } as unknown as MarketDataProvider;
      }),
    } as unknown as MarketDataProvider,
    listeners,
  };
}

function createMockBroker(): PaperBroker {
  return {
    submitOrder: vi.fn(),
    getAccount: vi.fn(() => ({
      equity: 1000000,
      cash: 500000,
      paused: false,
    })),
  } as unknown as PaperBroker;
}

describe("GridTradingRunner", () => {
  let runner: GridTradingRunner;
  let mockMarket: ReturnType<typeof createMockMarket>;
  let mockBroker: PaperBroker;

  const config = {
    symbol: "600519",
    gridCount: 5,
    gridSpacingPercent: 2,
    lotsPerGrid: 100,
  };

  beforeEach(() => {
    mockMarket = createMockMarket();
    mockBroker = createMockBroker();
    runner = new GridTradingRunner(
      mockMarket.market,
      mockBroker,
      config,
    );
  });

  afterEach(() => {
    if (runner.isRunning) {
      runner.stop();
    }
  });

  describe("start/stop lifecycle", () => {
    it("should start and stop correctly", () => {
      expect(runner.isRunning).toBe(false);

      runner.start();
      expect(runner.isRunning).toBe(true);
      expect(mockMarket.market.on).toHaveBeenCalled();

      runner.stop();
      expect(runner.isRunning).toBe(false);
      expect(mockMarket.market.off).toHaveBeenCalled();
    });

    it("should not subscribe twice when started again", () => {
      runner.start();
      const callCount = (mockMarket.market.on as ReturnType<typeof vi.fn>).mock.calls.length;
      runner.start();
      expect((mockMarket.market.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });
  });

  describe("grid trading logic", () => {
    it("should buy when price drops below grid level", () => {
      mockMarket.market.getQuote = vi.fn(() => createMockQuote({ price: 1500 }));
      runner.start();

      const listener = mockMarket.listeners[0];
      listener(createMockSnapshot([createMockQuote({ price: 1462.5 })]));

      expect(mockBroker.submitOrder).toHaveBeenCalled();
      const calls = (mockBroker.submitOrder as ReturnType<typeof vi.fn>).mock.calls;
      const buyCalls = calls.filter((c: unknown[]) => (c[0] as { side: string }).side === "buy");
      expect(buyCalls.length).toBeGreaterThan(0);
    });

    it("should sell when price rises above grid level", () => {
      mockMarket.market.getQuote = vi.fn(() => createMockQuote({ price: 1500 }));
      runner.start();

      const listener = mockMarket.listeners[0];
      listener(createMockSnapshot([createMockQuote({ price: 1537.5 })]));

      expect(mockBroker.submitOrder).toHaveBeenCalled();
      const calls = (mockBroker.submitOrder as ReturnType<typeof vi.fn>).mock.calls;
      const sellCalls = calls.filter((c: unknown[]) => (c[0] as { side: string }).side === "sell");
      expect(sellCalls.length).toBeGreaterThan(0);
    });

    it("should not trade when price stays within same grid level", () => {
      mockMarket.market.getQuote = vi.fn(() => createMockQuote({ price: 1500 }));
      runner.start();

      const listener = mockMarket.listeners[0];
      listener(createMockSnapshot([createMockQuote({ price: 1510 })]));

      expect(mockBroker.submitOrder).not.toHaveBeenCalled();
    });

    it("should handle submitOrder errors gracefully", () => {
      mockBroker.submitOrder = vi.fn(() => {
        throw new Error("资金不足");
      });
      mockMarket.market.getQuote = vi.fn(() => createMockQuote({ price: 1500 }));
      runner.start();

      const listener = mockMarket.listeners[0];
      expect(() => {
        listener(createMockSnapshot([createMockQuote({ price: 1400 })]));
      }).not.toThrow();
    });

    it("should unsubscribe from market after stop", () => {
      mockMarket.market.getQuote = vi.fn(() => createMockQuote({ price: 1500 }));
      runner.start();
      runner.stop();

      // After stop, the listener should have been unsubscribed
      expect(mockMarket.market.off).toHaveBeenCalled();
      // No orders should have been placed during normal operation
      expect(mockBroker.submitOrder).not.toHaveBeenCalled();
    });
  });
});
