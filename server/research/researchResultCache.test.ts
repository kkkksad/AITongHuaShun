import { describe, expect, it, vi } from "vitest";
import { ResearchResultCache } from "./researchResultCache";

describe("ResearchResultCache", () => {
  it("preserves active work when full and rejects a new key without starting it", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 2 });
    let resolve!: (value: number) => void;
    const pending = new Promise<number>(done => { resolve = done; });
    const createA = vi.fn(() => pending);
    const createB = vi.fn(() => pending);
    const overflow = vi.fn(async () => 99);
    const first = cache.getOrCreate("a", 1000, createA);
    const second = cache.getOrCreate("b", 1000, createB);
    const third = cache.getOrCreate("overflow", 1000, overflow).catch(error => error);
    const firstAgain = cache.getOrCreate("a", 1000, createA);
    await Promise.resolve(); resolve(42);
    await Promise.all([first, second, firstAgain]);
    const denied = await third;
    expect(overflow).not.toHaveBeenCalled();
    expect(createA).toHaveBeenCalledOnce();
    expect(firstAgain).toBe(first);
    expect(denied).toMatchObject({ statusCode: 503 });
    expect(await cache.getOrCreate("overflow", 1000, overflow)).toBe(99);
  });

  it("keeps active capacity occupied across clear until the actual work settles", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 1 });
    let resolve!: (value: number) => void;
    const first = cache.getOrCreate("a", 1000, () => new Promise(done => { resolve = done; }));
    await Promise.resolve(); cache.clear();
    const overflow = vi.fn(async () => 99);
    const denied = cache.getOrCreate("b", 1000, overflow).catch(error => error);
    resolve(42); await first;
    expect(await denied).toMatchObject({ statusCode: 503 });
    expect(overflow).not.toHaveBeenCalled();
    expect(await cache.getOrCreate("b", 1000, overflow)).toBe(99);
  });

  it("evicts TTL evaluation failures so a later call can recover", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 1 });
    await expect(cache.getOrCreate("a", () => { throw new Error("fixture TTL failure"); }, () => 42))
      .rejects.toThrow("fixture TTL failure");
    await expect(cache.getOrCreate("a", 1000, () => 99)).resolves.toBe(99);
  });

  it.each(["resolve", "reject"])("does not let an old %s overwrite a post-clear replacement", async outcome => {
    const cache = new ResearchResultCache<number>({ maxEntries: 2 });
    let resolve!: (value: number) => void;
    let reject!: (reason: Error) => void;
    const old = cache.getOrCreate("a", 1000, () => new Promise<number>((yes, no) => { resolve = yes; reject = no; }));
    const observed = old.catch(error => error);
    await Promise.resolve(); cache.clear();
    expect(await cache.getOrCreate("a", 1000, () => 99)).toBe(99);
    if (outcome === "resolve") resolve(42); else reject(new Error("old failure"));
    await observed;
    const create = vi.fn(() => 123);
    expect(await cache.getOrCreate("a", 1000, create)).toBe(99);
    expect(create).not.toHaveBeenCalled();
  });

  it("replaces a completed value while preserving a still-pending older calculation", async () => {
    const cache = new ResearchResultCache<number>({ maxEntries: 2 });
    let resolve!: (value: number) => void;
    const work = new Promise<number>(done => { resolve = done; });
    const create = vi.fn(() => work);
    const pending = cache.getOrCreate("pending", 1000, create);
    await cache.getOrCreate("done", 1000, () => 1);
    await cache.getOrCreate("new", 1000, () => 2);
    const same = cache.getOrCreate("pending", 1000, create);
    resolve(42);
    expect(await same).toBe(await pending);
    expect(same).toBe(pending);
    expect(create).toHaveBeenCalledOnce();
  });
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
