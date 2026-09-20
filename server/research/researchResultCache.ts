type CacheEntry<T> = {
  promise: Promise<T>;
  value?: T;
  expiresAt: number;
  settled: boolean;
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
  ): Promise<T> {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && (!existing.settled || existing.expiresAt > now)) {
      return existing.promise;
    }
    if (existing) this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.entries.delete(oldestKey);
    }

    const entry: CacheEntry<T> = {
      promise: Promise.resolve().then(create),
      expiresAt: Number.POSITIVE_INFINITY,
      settled: false,
    };
    this.entries.set(key, entry);
    entry.promise = entry.promise.then(
      (value) => {
        if (this.entries.get(key) === entry) {
          entry.value = value;
          entry.settled = true;
          const resolvedTtlMs = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
          entry.expiresAt = this.now() + Math.max(0, resolvedTtlMs);
        }
        return value;
      },
      (error) => {
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
