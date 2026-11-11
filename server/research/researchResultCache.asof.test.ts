import { describe, expect, it, vi } from "vitest";
import { ResearchResultCache } from "./researchResultCache";

function deferred() {
  let resolve!: (value: string) => void, reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("research context cache as-of upper bound", () => {
  it("does not return a later completed context to an earlier request", async () => {
    const cache = new ResearchResultCache<string>();
    expect(await cache.getOrCreate("same", 30_000, () => "later", 2000)).toBe("later");
    expect(await cache.getOrCreate("same", 30_000, () => "earlier", 1000)).toBe("earlier");
    const create = vi.fn(() => "unnecessary");
    expect(await cache.getOrCreate("same", 30_000, create, 1001)).toBe("earlier");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"])("does not let later in-flight work %s over an earlier replacement", async outcome => {
    const cache = new ResearchResultCache<string>({ maxEntries: 2 }); const later = deferred();
    const future = cache.getOrCreate("same", 30_000, () => later.promise, 2000).catch(error => error);
    await Promise.resolve();
    const earlier = cache.getOrCreate("same", 30_000, () => "earlier", 1000);
    // Release the old work before awaiting the new read so this regression also
    // terminates on the old implementation that incorrectly shares its Promise.
    await Promise.resolve();
    if (outcome === "resolve") later.resolve("later"); else later.reject(new Error("late failure"));
    await future;
    expect(await earlier).toBe("earlier");
    expect(await cache.getOrCreate("same", 30_000, () => "unexpected", 1001)).toBe("earlier");
  });

  it("preserves future single-flight when capacity prevents an earlier replacement", async () => {
    const cache = new ResearchResultCache<string>({ maxEntries: 1 }); const later = deferred();
    const createLater = vi.fn(() => later.promise);
    const future = cache.getOrCreate("same", 30_000, createLater, 2000);
    await Promise.resolve();
    const createEarlier = vi.fn(() => "earlier");
    const denied = cache.getOrCreate("same", 30_000, createEarlier, 1000).catch(error => error);
    const shared = cache.getOrCreate("same", 30_000, createLater, 2000);
    later.resolve("later"); await future;
    expect(await denied).toMatchObject({ statusCode: 503 });
    expect(shared).toBe(future);
    expect(await shared).toBe("later");
    expect(createEarlier).not.toHaveBeenCalled(); expect(createLater).toHaveBeenCalledOnce();
  });

  it("does not share a context with unknown provenance when the caller supplies a bound", async () => {
    const cache = new ResearchResultCache<string>();
    await cache.getOrCreate("same", 30_000, () => "unknown");
    expect(await cache.getOrCreate("same", 30_000, () => "bounded", 1000)).toBe("bounded");
  });

  it("keeps replaced future work in the active budget until its original Promise settles", async () => {
    const cache = new ResearchResultCache<string>({ maxEntries: 2 });
    const later = deferred(), earlier = deferred(), other = deferred();
    const future = cache.getOrCreate("same", 30_000, () => later.promise, 2000);
    const replacement = cache.getOrCreate("same", 30_000, () => earlier.promise, 1000);
    const overflowFactory = vi.fn(() => "overflow");
    const firstDenied = cache.getOrCreate("overflow", 30_000, overflowFactory, 1000).catch(error => error);
    await Promise.resolve(); earlier.resolve("earlier");
    // A broken implementation might still share future; release it for cleanup
    // in finally so a failing assertion never leaves work owned by the test.
    try {
      expect(replacement).not.toBe(future);
      expect(await replacement).toBe("earlier");
      expect(await firstDenied).toMatchObject({ statusCode: 503 });
      const another = cache.getOrCreate("other", 30_000, () => other.promise, 1000).catch(error => error);
      const secondDenied = cache.getOrCreate("overflow", 30_000, overflowFactory, 1000).catch(error => error);
      expect(await secondDenied).toMatchObject({ statusCode: 503 });
      expect(overflowFactory).not.toHaveBeenCalled();
      later.resolve("later"); await future;
      expect(await cache.getOrCreate("overflow", 30_000, overflowFactory, 1000)).toBe("overflow");
      other.resolve("other"); expect(await another).toBe("other");
    } finally { later.resolve("later"); earlier.resolve("earlier"); other.resolve("other"); }
  });

  it.each([NaN, Infinity, -Infinity])("rejects invalid as-of %s without work or cache invalidation", async asOf => {
    const cache = new ResearchResultCache<string>(); const create = vi.fn(() => "invalid");
    await cache.getOrCreate("same", 30_000, () => "valid", 1000);
    await expect(cache.getOrCreate("same", 30_000, create, asOf)).rejects.toThrow("as-of");
    expect(create).not.toHaveBeenCalled();
    expect(await cache.getOrCreate("same", 30_000, () => "unexpected", 1000)).toBe("valid");
  });

  it("keeps equal and forward time reads shared and applies the original wall-clock TTL", async () => {
    let clock = 0; const cache = new ResearchResultCache<string>({ now: () => clock });
    const create = vi.fn(() => "first");
    const first = cache.getOrCreate("same", 100, create, 1000);
    expect(cache.getOrCreate("same", 100, create, 1000)).toBe(first);
    expect(cache.getOrCreate("same", 100, create, 2000)).toBe(first);
    await first; clock = 99;
    expect(await cache.getOrCreate("same", 100, create, 3000)).toBe("first");
    clock = 100;
    expect(await cache.getOrCreate("same", 100, () => "expired", 3000)).toBe("expired");
    expect(create).toHaveBeenCalledOnce();
  });
});
