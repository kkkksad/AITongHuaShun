import { describe, expect, it } from "vitest";
import { rsi } from "./indicators";

describe("Cutler RSI flat-window convention", () => {
  it.each([1, 2, 6, 14, 30])("returns neutral 50 for %i unchanged observations", (period) => {
    expect(rsi(Array(period + 1).fill(10), period)).toBe(50);
  });

  it("uses the current window after an old directional move has rolled out", () => {
    expect(rsi([20, 10, 10, 10], 2)).toBe(50);
    expect(rsi([1, 10, 10, 10], 2)).toBe(50);
  });

  it("does not round a small genuine rise or fall into a flat window", () => {
    expect(rsi([10, 10, 10 + 1e-12], 2)).toBe(100);
    expect(rsi([10, 10, 10 - 1e-12], 2)).toBe(0);
  });

  it("preserves the simple recent-window gain/loss ratio instead of switching to Wilder smoothing", () => {
    expect(rsi([100, 1, 2, 4, 3], 3)).toBe(75);
    expect(rsi([100, 1, 2, 4, 3, 2], 3)).toBe(50);
  });

  it("keeps the period-plus-one warmup and invalid-input propagation", () => {
    expect(rsi([10, 10], 2)).toBeNaN();
    expect(rsi([10, 10], 0)).toBeNaN();
    expect(rsi([10, NaN, 10], 2)).toBeNaN();
  });
});
