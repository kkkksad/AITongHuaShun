import { describe, expect, it } from "vitest";
import type {
  AccountSnapshot,
  EnhancedRiskLimits,
  MarketQuote,
  PositionSnapshot,
  RiskState,
} from "../../shared/trading";
import { RiskEngine } from "./riskEngine";

// ── 测试夹具 ──────────────────────────────────────────────

const limits: EnhancedRiskLimits = {
  maxOrderNotional: 100_000,
  maxPositionWeight: 0.25,
  maxDailyLoss: 0.05,
  lotSize: 100,
  realTradingEnabled: false,
  circuitBreaker: {
    maxConsecutiveLosses: 5,
    maxDailyDrawdown: 0.08,
    cooldownMinutes: 15,
    recoveryMinutes: 5,
  },
  dynamicPositionScaling: true,
  maxDrawdownReductionFactor: 0.25,
};

const account: AccountSnapshot = {
  accountId: "PAPER-CN-01",
  mode: "mock",
  cash: 500_000,
  equity: 1_000_000,
  marketValue: 500_000,
  unrealizedPnl: 0,
  realizedPnl: 0,
  dailyPnl: 0,
  dailyPnlPercent: 0,
  riskUtilization: 0.5,
  paused: false,
  updatedAt: "2026-07-11T00:00:00.000Z",
};

const quote: MarketQuote = {
  symbol: "300750",
  name: "宁德时代",
  tradable: true,
  price: 250,
  previousClose: 248,
  changePercent: 0.8,
  volume: 1_000_000,
  updatedAt: "2026-07-11T00:00:00.000Z",
};

const position: PositionSnapshot = {
  symbol: quote.symbol,
  name: quote.name,
  quantity: 100,
  averagePrice: 245,
  currentPrice: quote.price,
  marketValue: 25_000,
  unrealizedPnl: 500,
  realizedPnl: 0,
  weight: 0.025,
};

// ── 基本风控测试 ──────────────────────────────────────────

describe("RiskEngine - basic checks", () => {
  const risk = new RiskEngine(limits);

  it("approves a valid paper order", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account,
      position,
      mode: "mock",
    });

    expect(result).toEqual({
      allowed: true,
      code: "APPROVED",
      message: "风险检查通过",
    });
  });

  it("rejects display-only indices", () => {
    const result = risk.evaluate({
      request: {
        symbol: "000001",
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote: { ...quote, symbol: "000001", tradable: false },
      account,
      mode: "mock",
    });

    expect(result.code).toBe("NON_TRADABLE_SYMBOL");
  });

  it("rejects orders while trading is paused", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account: { ...account, paused: true },
      mode: "mock",
    });

    expect(result.code).toBe("TRADING_PAUSED");
  });

  it("rejects quantities outside the board lot", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 50,
      },
      quote,
      account,
      mode: "mock",
    });

    expect(result.code).toBe("INVALID_LOT_SIZE");
  });

  it("uses the limit price when checking order notional", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "limit",
        quantity: 100,
        limitPrice: 1_200,
      },
      quote,
      account,
      mode: "mock",
    });

    expect(result.code).toBe("ORDER_NOTIONAL_LIMIT");
  });

  it("subtracts pending sell orders from available position", () => {
    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "sell",
        type: "limit",
        quantity: 100,
        limitPrice: 300,
      },
      quote,
      account,
      position,
      reservedSellQuantity: 100,
      mode: "mock",
    });

    expect(result.code).toBe("INSUFFICIENT_POSITION");
  });
});

// ── 增强风控：熔断器 ─────────────────────────────────────

describe("RiskEngine - circuit breaker", () => {
  it("starts in normal state", () => {
    const risk = new RiskEngine(limits);
    expect(risk.getState().circuitState).toBe("normal");
    expect(risk.getState().consecutiveLosses).toBe(0);
    expect(risk.getState().dailyDrawdown).toBe(0);
  });

  it("transitions to warning after consecutive losses reach 60% threshold", () => {
    const risk = new RiskEngine(limits);

    // 3 consecutive losses (60% of 5 = 3)
    for (let i = 0; i < 3; i++) {
      risk.recordTradeResult(-1000, 999_000 - i * 1000);
    }

    const state = risk.getState();
    expect(state.consecutiveLosses).toBe(3);
    expect(state.circuitState).toBe("warning");
  });

  it("transitions to tripped after maxConsecutiveLosses is reached", () => {
    const risk = new RiskEngine(limits);

    // 5 consecutive losses triggers circuit breaker
    for (let i = 0; i < 5; i++) {
      risk.recordTradeResult(-5000, 1_000_000 - (i + 1) * 5000);
    }

    const state = risk.getState();
    expect(state.consecutiveLosses).toBe(5);
    expect(state.circuitState).toBe("tripped");
    expect(state.trippedAt).toBeTruthy();
  });

  it("rejects orders when circuit is tripped", () => {
    const risk = new RiskEngine(limits);

    // Trigger circuit breaker with 5 consecutive losses
    for (let i = 0; i < 5; i++) {
      risk.recordTradeResult(-5000, 1_000_000 - (i + 1) * 5000);
    }

    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account,
      mode: "mock",
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CIRCUIT_BREAKER_TRIPPED");
    expect(result.message).toContain("熔断器已触发");
  });

  it("resets consecutive losses after a profitable trade", () => {
    const risk = new RiskEngine(limits);

    // 2 losses
    risk.recordTradeResult(-1000, 999_000);
    risk.recordTradeResult(-1000, 998_000);

    expect(risk.getState().consecutiveLosses).toBe(2);

    // 1 profit resets the counter
    risk.recordTradeResult(500, 998_500);

    expect(risk.getState().consecutiveLosses).toBe(0);
  });

  it("manual reset clears tripped state", () => {
    const risk = new RiskEngine(limits);

    // Trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      risk.recordTradeResult(-5000, 1_000_000 - (i + 1) * 5000);
    }

    expect(risk.getState().circuitState).toBe("tripped");

    // Manual reset
    risk.resetCircuit();

    const state = risk.getState();
    expect(state.circuitState).toBe("normal");
    expect(state.consecutiveLosses).toBe(0);
    expect(state.trippedAt).toBeNull();
  });

  it("trips on daily drawdown exceeding threshold", () => {
    const risk = new RiskEngine(limits);

    // Simulate large drawdown: equity drops from 1M to 900K (10% drawdown > 8% threshold)
    risk.recordTradeResult(-100_000, 900_000);

    expect(risk.getState().circuitState).toBe("tripped");
    expect(risk.getState().dailyDrawdown).toBeCloseTo(0.1, 2);
  });
});

// ── 增强风控：动态限额 ───────────────────────────────────

describe("RiskEngine - dynamic limits", () => {
  it("returns full position weight when no drawdown", () => {
    const risk = new RiskEngine(limits);
    expect(risk.getEffectiveMaxPositionWeight()).toBe(0.25);
  });

  it("reduces position weight when drawdown increases", () => {
    const risk = new RiskEngine(limits);

    // 4% drawdown (half of maxDrawdown 8%)
    risk.recordTradeResult(-40_000, 960_000);

    const dynamicWeight = risk.getEffectiveMaxPositionWeight();
    // Expected: 0.25 * (1 - (1-0.25) * 0.5) = 0.25 * (1 - 0.75 * 0.5) = 0.25 * 0.625 = 0.15625
    expect(dynamicWeight).toBeLessThan(0.25);
    expect(dynamicWeight).toBeGreaterThanOrEqual(0.0625); // >= 0.25 * 0.25
  });

  it("never reduces below minimum reduction factor", () => {
    const risk = new RiskEngine(limits);

    // Hit max drawdown
    risk.recordTradeResult(-80_000, 920_000);

    const dynamicWeight = risk.getEffectiveMaxPositionWeight();
    // Minimum: 0.25 * 0.25 = 0.0625
    expect(dynamicWeight).toBeGreaterThanOrEqual(0.0625);
  });

  it("reduces max order notional proportionally", () => {
    const risk = new RiskEngine(limits);

    // No drawdown - full notional
    expect(risk.getEffectiveMaxOrderNotional()).toBe(100_000);

    // Significant drawdown
    risk.recordTradeResult(-60_000, 940_000);

    const reducedNotional = risk.getEffectiveMaxOrderNotional();
    expect(reducedNotional).toBeLessThan(100_000);
    expect(reducedNotional).toBeGreaterThanOrEqual(25_000); // >= 100_000 * 0.25
  });

  it("rejects order exceeding dynamic notional limit", () => {
    const risk = new RiskEngine(limits);

    // Create large drawdown to reduce limits
    risk.recordTradeResult(-70_000, 930_000);

    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 300,
      },
      quote,
      account,
      mode: "mock",
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("ORDER_NOTIONAL_LIMIT");
    expect(result.message).toContain("超过当前限额");
  });

  it("static limits when dynamicPositionScaling is disabled", () => {
    const staticLimits: EnhancedRiskLimits = {
      ...limits,
      dynamicPositionScaling: false,
    };

    const risk = new RiskEngine(staticLimits);

    // Simulate drawdown
    risk.recordTradeResult(-70_000, 930_000);

    // Weight should remain unchanged
    expect(risk.getEffectiveMaxPositionWeight()).toBe(0.25);
    expect(risk.getEffectiveMaxOrderNotional()).toBe(100_000);
  });
});

// ── 增强风控：状态追踪 ───────────────────────────────────

describe("RiskEngine - state tracking", () => {
  it("tracks trade and loss counts", () => {
    const risk = new RiskEngine(limits);

    risk.recordTradeResult(-100, 999_900);
    risk.recordTradeResult(200, 1_000_100);
    risk.recordTradeResult(-50, 1_000_050);

    const state = risk.getState();
    expect(state.tradeCount).toBe(3);
    expect(state.lossCount).toBe(2);
  });

  it("tracks peak daily equity", () => {
    const risk = new RiskEngine(limits);

    risk.recordTradeResult(10_000, 1_010_000);
    expect(risk.getState().peakDailyEquity).toBe(1_010_000);

    risk.recordTradeResult(-5_000, 1_005_000);
    // Peak should remain at 1_010_000
    expect(risk.getState().peakDailyEquity).toBe(1_010_000);

    risk.recordTradeResult(20_000, 1_025_000);
    expect(risk.getState().peakDailyEquity).toBe(1_025_000);
  });

  it("calculates daily drawdown correctly", () => {
    const risk = new RiskEngine(limits);

    // Set peak at 1M
    risk.recordTradeResult(0, 1_000_000);
    expect(risk.getState().dailyDrawdown).toBe(0);

    // Drop to 950K = 5% drawdown
    risk.recordTradeResult(-50_000, 950_000);
    expect(risk.getState().dailyDrawdown).toBeCloseTo(0.05, 3);
  });
});

// ── 增强风控：恢复流程 ───────────────────────────────────

describe("RiskEngine - recovery flow", () => {
  it("warning state still allows trading", () => {
    const risk = new RiskEngine(limits);

    // Trigger warning with 3 consecutive losses
    for (let i = 0; i < 3; i++) {
      risk.recordTradeResult(-1000, 999_000 - i * 1000);
    }

    expect(risk.getState().circuitState).toBe("warning");

    const result = risk.evaluate({
      request: {
        symbol: quote.symbol,
        side: "buy",
        type: "market",
        quantity: 100,
      },
      quote,
      account: { ...account, equity: 997_000 },
      mode: "mock",
    });

    // Warning allows trades but with warning code
    expect(result.allowed).toBe(true);
    expect(result.code).toBe("RISK_WARNING");
    expect(result.message).toContain("风控预警");
  });

  it("getState returns a readonly copy", () => {
    const risk = new RiskEngine(limits);
    const state = risk.getState();

    // Modifying the copy should not affect internal state
    (state as RiskState).consecutiveLosses = 99;
    expect(risk.getState().consecutiveLosses).toBe(0);
  });
});
