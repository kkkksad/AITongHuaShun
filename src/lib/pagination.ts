export interface PaginationResult<T> {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  requestedPageSize: number,
): PaginationResult<T> {
  const pageSize = normalizePositiveInteger(requestedPageSize, 1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePositiveInteger(requestedPage, 1), pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageCount,
    pageSize,
    rangeStart: total === 0 ? 0 : startIndex + 1,
    rangeEnd: total === 0 ? 0 : startIndex + pageItems.length,
    total,
  };
}
