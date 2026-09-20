import { describe, expect, it, vi } from "vitest";
import { ResearchResultCache } from "./researchResultCache";

describe("ResearchResultCache", () => {
  it("shares one in-flight calculation and reuses its completed value until expiry", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 2, now: () => 1_000 });
    const create = vi.fn(async () => 42);

    const [first, second] = await Promise.all([
      cache.getOrCreate("snapshot-1", 5_000, create),
      cache.getOrCreate("snapshot-1", 5_000, create),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(cache.getOrCreate("snapshot-1", 5_000, create)).resolves.toBe(42);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed calculation so a later request can retry", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 2 });
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("bridge unavailable"))
      .mockResolvedValueOnce(7);

    await expect(cache.getOrCreate("snapshot-1", 5_000, create)).rejects.toThrow(
      "bridge unavailable",
    );
    await expect(cache.getOrCreate("snapshot-1", 5_000, create)).resolves.toBe(7);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("expires completed values and bounds retained snapshots", async () => {
    let now = 1_000;
    const cache = new ResearchResultCache<number>({ maxEntries: 1, now: () => now });
    const create = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await expect(cache.getOrCreate("snapshot-1", 100, create)).resolves.toBe(1);
    now = 1_050;
    await expect(cache.getOrCreate("snapshot-1", 100, create)).resolves.toBe(1);
    now = 1_101;
    await expect(cache.getOrCreate("snapshot-1", 100, create)).resolves.toBe(2);
    await expect(cache.getOrCreate("snapshot-2", 100, create)).resolves.toBe(3);

    expect(create).toHaveBeenCalledTimes(3);
  });

  it("can shorten the TTL for degraded results so recovery is retried quickly", async () => {
    let now = 1_000;
    const cache = new ResearchResultCache<{ degraded: boolean }>({
      now: () => now,
    });
    const create = vi.fn()
      .mockResolvedValueOnce({ degraded: true })
      .mockResolvedValueOnce({ degraded: false });
    const ttl = (value: { degraded: boolean }) => value.degraded ? 100 : 5_000;

    await expect(cache.getOrCreate("research", ttl, create)).resolves
      .toEqual({ degraded: true });
    now = 1_101;
    await expect(cache.getOrCreate("research", ttl, create)).resolves
      .toEqual({ degraded: false });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
