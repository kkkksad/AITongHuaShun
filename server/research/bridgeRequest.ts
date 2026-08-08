import { createHash } from "node:crypto";

export type BridgeRequestErrorCode =
  | "http"
  | "invalid-json"
  | "network"
  | "timeout";

export class BridgeRequestError extends Error {
  constructor(
    message: string,
    readonly code: BridgeRequestErrorCode,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

interface FetchBridgeJsonInput {
  url: string;
  token?: string;
  timeoutMs: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

interface BridgeRequestCacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const MAX_BRIDGE_REQUEST_CACHE_ENTRIES = 64;
const bridgeRequestCache = new Map<string, BridgeRequestCacheEntry>();
const fetchScopeIds = new WeakMap<object, number>();
let fetchScopeSequence = 0;

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return 15_000;
  return Math.max(1, Math.round(value));
}

function normalizeDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return normalized || null;
}

function responseDetail(body: string): string | null {
  try {
    const payload = JSON.parse(body) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return normalizeDetail((payload as Record<string, unknown>).detail);
  } catch {
    return null;
  }
}

export function bridgeErrorMessage(error: unknown): string {
  return error instanceof BridgeRequestError
    ? error.message
    : "行情桥请求失败";
}

function bridgeCacheKey(input: FetchBridgeJsonInput): string {
  let fetchScope = "default-fetch";
  if (input.fetchImpl) {
    let scopeId = fetchScopeIds.get(input.fetchImpl);
    if (scopeId === undefined) {
      fetchScopeSequence += 1;
      scopeId = fetchScopeSequence;
      fetchScopeIds.set(input.fetchImpl, scopeId);
    }
    fetchScope = `fetch-${scopeId}`;
  }
  const tokenScope = input.token
    ? createHash("sha256").update(input.token).digest("base64url").slice(0, 16)
    : "anonymous";
  return `${fetchScope}\u0000${tokenScope}\u0000${input.url}`;
}

function evictExpiredBridgeRequests(now: number): void {
  for (const [key, entry] of bridgeRequestCache) {
    if (entry.expiresAt <= now) bridgeRequestCache.delete(key);
  }
}

function reserveBridgeRequestCacheSlot(now: number): void {
  evictExpiredBridgeRequests(now);
  while (bridgeRequestCache.size >= MAX_BRIDGE_REQUEST_CACHE_ENTRIES) {
    const oldestKey = bridgeRequestCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    bridgeRequestCache.delete(oldestKey);
  }
}

export function clearBridgeRequestCache(): void {
  bridgeRequestCache.clear();
}

async function fetchBridgeJsonUncached<T>(
  input: FetchBridgeJsonInput,
): Promise<T> {
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      headers: {
        Accept: "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      },
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      const detail = responseDetail(body);
      throw new BridgeRequestError(
        `行情桥返回 HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        "http",
        response.status,
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new BridgeRequestError(
        "行情桥返回了无法解析的 JSON",
        "invalid-json",
        response.status,
      );
    }
  } catch (error: unknown) {
    if (error instanceof BridgeRequestError) throw error;
    if (controller.signal.aborted) {
      throw new BridgeRequestError(
        `连接行情桥超时（${timeoutMs}ms）`,
        "timeout",
      );
    }
    throw new BridgeRequestError(
      "无法连接行情桥，请确认行情服务已启动",
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBridgeJson<T>(
  input: FetchBridgeJsonInput,
): Promise<T> {
  const cacheTtlMs = Number.isFinite(input.cacheTtlMs)
    ? Math.max(0, Math.round(input.cacheTtlMs ?? 0))
    : 0;
  if (cacheTtlMs === 0) return fetchBridgeJsonUncached<T>(input);

  const now = Date.now();
  const key = bridgeCacheKey(input);
  const cached = bridgeRequestCache.get(key);
  if (cached && cached.expiresAt > now) {
    bridgeRequestCache.delete(key);
    bridgeRequestCache.set(key, cached);
    return cached.promise as Promise<T>;
  }
  if (cached) bridgeRequestCache.delete(key);

  reserveBridgeRequestCacheSlot(now);
  const promise = fetchBridgeJsonUncached<T>(input);
  bridgeRequestCache.set(key, {
    expiresAt: now + cacheTtlMs,
    promise,
  });
  void promise.catch(() => {
    if (bridgeRequestCache.get(key)?.promise === promise) {
      bridgeRequestCache.delete(key);
    }
  });
  return promise;
}
