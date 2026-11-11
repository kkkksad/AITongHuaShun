import { ResearchCapacityError } from "./researchCapacity";

type CacheEntry<T> = {
  promise: Promise<T>;
  value?: T;
  expiresAt: number;
  settled: boolean;
  asOfMs?: number;
};

export interface ResearchResultCacheOptions {
  maxEntries?: number;
  now?: () => number;
}

export type ResearchResultCacheTtl<T> =
  number | ((value: T) => number);

/**
 * Shares expensive read-only research work without retaining account state.
 * Failed work is removed so a transient bridge outage can be retried.
 */
export class ResearchResultCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly activeEntries = new Set<CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: ResearchResultCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 8));
    this.now = options.now ?? Date.now;
  }

  getOrCreate(
    key: string,
    ttlMs: ResearchResultCacheTtl<T>,
    create: () => Promise<T> | T,
    asOfMs?: number,
  ): Promise<T> {
    if (asOfMs !== undefined && !Number.isFinite(asOfMs)) {
      return Promise.reject(new Error("Invalid research cache as-of time"));
    }
    const now = this.now();
    const existing = this.entries.get(key);
    const timeAllowed = asOfMs === undefined ||
      existing?.asOfMs !== undefined && existing.asOfMs <= asOfMs;
    if (existing && timeAllowed && (!existing.settled || existing.expiresAt > now)) {
      return existing.promise;
    }

    // Cache invalidation does not cancel work. Keep its admission slot until
    // the original Promise settles, including work hidden by clear().
    if (this.activeEntries.size >= this.maxEntries) return Promise.reject(new ResearchCapacityError());
    // An earlier request may replace later work only after admission. Rejected
    // replacements must leave the original in-flight work shareable; replaced
    // work retains its active slot until it actually settles.
    if (existing) this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const completed = [...this.entries].find(([, entry]) => entry.settled);
      if (!completed) return Promise.reject(new ResearchCapacityError());
      this.entries.delete(completed[0]);
    }

    const entry: CacheEntry<T> = {
      promise: Promise.resolve().then(create),
      expiresAt: Number.POSITIVE_INFINITY,
      settled: false,
      asOfMs,
    };
    this.entries.set(key, entry);
    this.activeEntries.add(entry);
    entry.promise = entry.promise.then(
      (value) => {
        try {
          if (this.entries.get(key) === entry) {
            const resolvedTtlMs = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
            entry.value = value;
            entry.settled = true;
            entry.expiresAt = this.now() + Math.max(0, resolvedTtlMs);
          }
          return value;
        } catch (error) {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        } finally {
          this.activeEntries.delete(entry);
        }
      },
      (error) => {
        this.activeEntries.delete(entry);
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      },
    );
    return entry.promise;
  }

  clear(): void {
    this.entries.clear();
  }
}
