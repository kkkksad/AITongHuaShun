import { describe, expect, it } from "vitest";
import { MacdAccumulator, macd } from "./indicators";

const prices = Array.from({ length: 500 }, (_, i) =>
  i < 100 ? 10 + i * 0.07 : i < 200 ? 17 : i < 300 ? 17 - (i - 200) * 0.04
    : 13 + Math.sin(i * 0.31) * 2 + Math.cos(i * 0.07) * 0.4);

describe("incremental MACD mathematical compatibility", () => {
  it.each([[12, 26, 9], [8, 36, 13], [2, 5, 1], [1, 1, 1]])(
    "matches the complete-prefix reference exactly at every observation for %i/%i/%i", (fast, slow, signal) => {
      const accumulator = new MacdAccumulator(fast, slow, signal);
      prices.forEach((price, index) => {
        expect(accumulator.update(price)).toEqual(macd(prices.slice(0, index + 1), fast, slow, signal));
      });
    },
  );

  it("resets warmup and all EMA state for reuse with a different sequence", () => {
    const accumulator = new MacdAccumulator(3, 8, 4);
    prices.forEach(price => accumulator.update(price)); accumulator.reset();
    const next = prices.slice(0, 140).reverse();
    next.forEach((price, index) => expect(accumulator.update(price)).toEqual(macd(next.slice(0, index + 1), 3, 8, 4)));
  });

  it("preserves near-zero crossovers without rounding or epsilon thresholds", () => {
    const values = Array.from({ length: 200 }, (_, i) => 1 + Math.sin(i * 0.2) * 1e-12);
    const accumulator = new MacdAccumulator(3, 8, 4);
    values.forEach((price, index) => expect(accumulator.update(price)).toEqual(macd(values.slice(0, index + 1), 3, 8, 4)));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("propagates invalid observations like the existing reference: %s", invalid => {
    const values = [...prices.slice(0, 30), invalid, ...prices.slice(30, 50)];
    const accumulator = new MacdAccumulator(3, 8, 4);
    values.forEach((price, index) => expect(accumulator.update(price)).toEqual(macd(values.slice(0, index + 1), 3, 8, 4)));
  });
});
