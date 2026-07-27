const HISTORY_REQUEST_MIN_TIMEOUT_MS = 8_000;
const HISTORY_REQUEST_MAX_TIMEOUT_MS = 30_000;

export function historyBridgeTimeoutMs(baseTimeoutMs: number): number {
  return Math.min(
    HISTORY_REQUEST_MAX_TIMEOUT_MS,
    Math.max(HISTORY_REQUEST_MIN_TIMEOUT_MS, Math.round(baseTimeoutMs * 2)),
  );
}
