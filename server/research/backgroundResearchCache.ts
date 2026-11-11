export type BackgroundResearchFallback = "warming" | "capacity" | "not-yet-observed" | "invalid-time";

interface Entry<T> {
  pending: boolean;
  completedAt?: number;
  expiresAt?: number;
  value?: T;
}

/** Read-only, bounded snapshots. Clearing visibility never cancels or frees active work. */
export class BackgroundResearchCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly active = new Set<Entry<T>>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 8));
  }

  getOrRefresh(key: string, options: {
    asOf: number;
    ttlMs: number;
    create: () => Promise<T> | T;
    fallback: (reason: BackgroundResearchFallback) => T;
  }): T {
    const now = this.now();
    if (!Number.isFinite(options.asOf) || !Number.isFinite(now)) return options.fallback("invalid-time");
    const existing = this.entries.get(key);
    if (existing?.pending) return options.fallback("warming");
    if (existing?.completedAt !== undefined) {
      if (existing.completedAt > options.asOf || existing.completedAt > now) return options.fallback("not-yet-observed");
      if (existing.expiresAt! > now && existing.expiresAt! > options.asOf) return existing.value!;
      this.entries.delete(key);
    }
    if (this.active.size >= this.maxEntries) return options.fallback("capacity");
    while (this.entries.size >= this.maxEntries) {
      const completed = [...this.entries].find(([, entry]) => !entry.pending);
      if (!completed) return options.fallback("capacity");
      this.entries.delete(completed[0]);
    }
    const entry: Entry<T> = { pending: true };
    this.entries.set(key, entry);
    this.active.add(entry);
    void Promise.resolve().then(options.create).then(value => {
      if (this.entries.get(key) !== entry) return;
      entry.value = value;
      entry.pending = false;
      entry.completedAt = this.now();
      entry.expiresAt = entry.completedAt + Math.max(0, options.ttlMs);
    }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }).finally(() => this.active.delete(entry));
    return options.fallback("warming");
  }

  clear(): void { this.entries.clear(); }
}
