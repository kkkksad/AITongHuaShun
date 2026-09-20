import { describe, expect, it, vi } from "vitest";
import { withResearchDeadline } from "./researchDeadline";

describe("withResearchDeadline", () => {
  it("returns the optional result before the deadline", async () => {
    const fallback = vi.fn(() => "fallback");

    await expect(withResearchDeadline({
      task: Promise.resolve("ready"),
      timeoutMs: 100,
      fallback,
    })).resolves.toBe("ready");

    expect(fallback).not.toHaveBeenCalled();
  });

  it("returns an explicit fallback when the optional source is slow", async () => {
    vi.useFakeTimers();
    try {
      const fallback = vi.fn((reason: unknown) => {
        expect(reason).toBeInstanceOf(Error);
        return "degraded";
      });
      const pending = new Promise<string>(() => undefined);
      const result = withResearchDeadline({
        task: pending,
        timeoutMs: 4_000,
        fallback,
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await expect(result).resolves.toBe("degraded");
      expect(fallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns an optional source rejection into its fallback", async () => {
    const fallback = vi.fn(() => "degraded");

    await expect(withResearchDeadline({
      task: Promise.reject(new Error("bridge down")),
      timeoutMs: 100,
      fallback,
    })).resolves.toBe("degraded");

    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
