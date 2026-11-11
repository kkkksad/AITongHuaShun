import { describe, expect, it } from "vitest";
import { BackgroundResearchCache } from "./backgroundResearchCache";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }

describe("background research evidence snapshots", () => {
  it("returns a cold fallback immediately, shares pending work, and exposes only a completed snapshot", async () => {
    let now = 100, calls = 0;
    const cache = new BackgroundResearchCache<string>({ now: () => now });
    const task = deferred<string>();
    const read = (asOf = now) => cache.getOrRefresh("key", {
      asOf, ttlMs: 60, create: () => { calls++; return task.promise; }, fallback: reason => reason,
    });
    expect(read()).toBe("warming"); expect(read()).toBe("warming");
    await flush(); expect(calls).toBe(1);
    now = 110; task.resolve("actual"); await flush();
    expect(read(109)).toBe("not-yet-observed");
    expect(read(110)).toBe("actual");
    now = 170;
    expect(read()).toBe("warming"); // Exact TTL expiry cannot reuse old evidence.
    await flush(); expect(calls).toBe(2);
  });

  it("does not reuse a snapshot after clock rollback", async () => {
    let now = 100;
    const cache = new BackgroundResearchCache<string>({ now: () => now });
    const read = () => cache.getOrRefresh("key", { asOf: now, ttlMs: 60, create: () => "actual", fallback: reason => reason });
    read(); await flush(); now = 99;
    expect(read()).toBe("not-yet-observed");
  });

  it("bounds concurrent work, permits same-key reads, and recovers capacity after completion", async () => {
    const cache = new BackgroundResearchCache<string>({ maxEntries: 1, now: () => 100 });
    const first = deferred<string>();
    let calls = 0;
    const read = (key: string) => cache.getOrRefresh(key, {
      asOf: 100, ttlMs: 60, create: () => { calls++; return first.promise; }, fallback: reason => reason,
    });
    expect(read("a")).toBe("warming"); expect(read("a")).toBe("warming");
    expect(read("b")).toBe("capacity"); await flush(); expect(calls).toBe(1);
    first.resolve("actual"); await flush();
    expect(read("b")).toBe("warming"); await flush(); expect(calls).toBe(2);
  });

  it("observes rejected tasks and allows a later read to retry", async () => {
    const cache = new BackgroundResearchCache<string>({ now: () => 100 });
    let calls = 0;
    const read = () => cache.getOrRefresh("key", {
      asOf: 100, ttlMs: 60, create: () => { if (++calls === 1) throw Error("private upstream"); return "actual"; }, fallback: reason => reason,
    });
    expect(read()).toBe("warming"); await flush();
    expect(read()).toBe("warming"); await flush();
    expect(read()).toBe("actual"); expect(calls).toBe(2);
  });

  it("does not release a cleared in-flight slot or let its result overwrite a new generation", async () => {
    const cache = new BackgroundResearchCache<string>({ maxEntries: 1, now: () => 100 });
    const old = deferred<string>();
    const read = (create = () => "new" as string | Promise<string>) => cache.getOrRefresh("key", {
      asOf: 100, ttlMs: 60, create, fallback: reason => reason,
    });
    read(() => old.promise); await flush(); cache.clear();
    expect(read()).toBe("capacity");
    old.resolve("old"); await flush();
    expect(read()).toBe("warming"); await flush(); expect(read()).toBe("new");
  });

  it("never starts work for an invalid evidence boundary", async () => {
    const cache = new BackgroundResearchCache<string>();
    let calls = 0;
    expect(cache.getOrRefresh("key", { asOf: NaN, ttlMs: 60, create: () => { calls++; return "actual"; }, fallback: reason => reason })).toBe("invalid-time");
    await flush(); expect(calls).toBe(0);
  });

  it("does not let an older cleared generation overwrite a completed newer snapshot", async () => {
    const cache = new BackgroundResearchCache<string>({ maxEntries: 2, now: () => 100 });
    const old = deferred<string>();
    const options = { asOf: 100, ttlMs: 60, fallback: (reason: string) => reason };
    cache.getOrRefresh("key", { ...options, create: () => old.promise }); await flush();
    cache.clear();
    cache.getOrRefresh("key", { ...options, create: () => "new" }); await flush();
    old.resolve("old"); await flush();
    expect(cache.getOrRefresh("key", { ...options, create: () => "wrong" })).toBe("new");
  });
});
