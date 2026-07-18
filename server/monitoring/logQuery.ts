import type { LogEntry, LogLevel } from "../logger";

export interface LogQueryOptions {
  limit: number;
  offset: number;
  level?: LogLevel;
  module?: string;
}

export interface LogQueryResult {
  total: number;
  filtered: number;
  returned: number;
  offset: number;
  limit: number;
  page: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
  entries: LogEntry[];
}

const levelWeights: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function queryLogEntries(
  entries: readonly LogEntry[],
  options: LogQueryOptions,
): LogQueryResult {
  const limit = positiveInteger(options.limit, 50);
  let filteredEntries = [...entries];

  if (options.level) {
    const minimumLevel = levelWeights[options.level];
    filteredEntries = filteredEntries.filter(
      (entry) => levelWeights[entry.level] >= minimumLevel,
    );
  }

  const moduleFilter = options.module?.trim().toLowerCase();
  if (moduleFilter) {
    filteredEntries = filteredEntries.filter((entry) =>
      entry.module.toLowerCase().includes(moduleFilter),
    );
  }

  filteredEntries.reverse();

  const filtered = filteredEntries.length;
  const pageCount = Math.max(1, Math.ceil(filtered / limit));
  const requestedOffset = Math.floor(nonNegativeInteger(options.offset) / limit) * limit;
  const offset = Math.min(requestedOffset, (pageCount - 1) * limit);
  const pageEntries = filteredEntries.slice(offset, offset + limit);
  const page = Math.floor(offset / limit) + 1;

  return {
    total: entries.length,
    filtered,
    returned: pageEntries.length,
    offset,
    limit,
    page,
    pageCount,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    entries: pageEntries,
  };
}
