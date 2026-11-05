import { describe, expect, it } from "vitest";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";

function systemAt(initial = "2026-11-05T15:59:59.999Z") {
  let now = new Date(initial);
  const system = createTradingSystem(createTestConfig({
    MARKET_MODE: "paper", TRADING_SEED_PORTFOLIO: false,
    TRADING_STARTING_CASH: 100_000, MAX_ORDER_NOTIONAL: 100_000,
    MAX_POSITION_WEIGHT: 1, SLIPPAGE_BPS: 0,
  }), () => now);
  return { system, setTime: (time: string) => { now = new Date(time); } };
}

describe("account snapshot calculation boundaries", () => {
  it("keeps empty positions fresh when cash, profile or pause changes at the same time", () => {
    const { system } = systemAt();
    const before = system.broker.getAccount();
    expect(system.broker.getPositions()).toEqual([]);
    system.broker.setStrategyProfile("growth");
    system.broker.pause();
    const after = system.broker.getAccount();
    expect(after).toMatchObject({ cash: before.cash, equity: before.equity, paused: true, strategyProfile: "growth" });
    expect(before.paused).toBe(false);
    system.broker.resetAccount({ startingCash: 20_000, strategyProfile: "balanced" });
    expect(system.broker.getAccount()).toMatchObject({ cash: 20_000, equity: 20_000, paused: false });
  });

  it("unlocks T+1 at China midnight and relocks when the injected clock moves back", () => {
    const { system, setTime } = systemAt();
    expect(system.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
    expect(system.broker.getPositions()[0]).toMatchObject({ quantity: 100, availableQuantity: 0, t1LockedQuantity: 100 });
    setTime("2026-11-05T16:00:00.000Z");
    expect(system.broker.getPositions()[0]).toMatchObject({ quantity: 100, availableQuantity: 100, t1LockedQuantity: 0 });
    setTime("2026-11-05T15:59:59.999Z");
    expect(system.broker.getPositions()[0]).toMatchObject({ quantity: 100, availableQuantity: 0, t1LockedQuantity: 100 });
    setTime("2026-11-06T16:00:00.000Z");
    expect(system.broker.getPositions()[0].availableQuantity).toBe(100);
  });

  it("recomputes holdings and equity for changed quotes at an unchanged clock time", () => {
    const { system } = systemAt();
    system.broker.submitOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 });
    const snapshot = system.market.getSnapshot();
    const before = system.broker.getAccount(snapshot);
    const updated = { ...snapshot, quotes: snapshot.quotes.map((quote) => quote.symbol === "601318" ? { ...quote, price: quote.price + 2 } : quote) };
    const after = system.broker.getAccount(updated);
    expect(after.cash).toBe(before.cash);
    expect(after.equity).toBeCloseTo(before.equity + 200);
    expect(after.marketValue).toBeCloseTo(before.marketValue + 200);
    expect(system.broker.getPositions(updated)[0].availableQuantity).toBe(0);
    expect(system.broker.getAccount(snapshot)).toEqual(before);
  });
});
