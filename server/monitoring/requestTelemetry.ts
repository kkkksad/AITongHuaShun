import type {
  ApiPerformanceState,
  RequestTelemetrySnapshot,
  RoutePerformanceSnapshot,
} from "../../shared/systemMonitoring";

export interface RequestTelemetrySample {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

interface RouteAccumulator {
  method: string;
  route: string;
  requestCount: number;
  failureCount: number;
  slowCount: number;
  durationTotalMs: number;
  durations: number[];
  maxMs: number;
  lastStatus: number;
  lastSeenMs: number;
}

interface RequestTelemetryOptions {
  maxRoutes?: number;
  samplesPerRoute?: number;
  slowThresholdMs?: number;
  criticalThresholdMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_ROUTES = 64;
const DEFAULT_SAMPLES_PER_ROUTE = 128;
const DEFAULT_SLOW_THRESHOLD_MS = 1_500;
const DEFAULT_CRITICAL_THRESHOLD_MS = 5_000;

const OBSERVER_ROUTES = new Set([
  "/api/health",
  "/api/system/performance",
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/logout",
  "/metrics",
]);

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedInteger(value: number, fallback: number): number {
  const normalized = Math.round(finitePositive(value, fallback));
  return Math.max(1, normalized);
}

function isFailure(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * ratio));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeTelemetryRoute(route: string): string {
  const pathname = route.split("?")[0]?.trim() ?? "";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function shouldTrackTelemetryRequest(method: string, route: string): boolean {
  if (method.toUpperCase() === "OPTIONS") return false;
  const normalized = normalizeTelemetryRoute(route);
  return normalized.startsWith("/api/") && !OBSERVER_ROUTES.has(normalized);
}

function routeSnapshot(route: RouteAccumulator): RoutePerformanceSnapshot {
  return {
    method: route.method,
    route: route.route,
    requestCount: route.requestCount,
    failureCount: route.failureCount,
    failureRate: route.requestCount > 0 ? route.failureCount / route.requestCount : 0,
    slowCount: route.slowCount,
    averageMs: route.requestCount > 0
      ? rounded(route.durationTotalMs / route.requestCount)
      : 0,
    p50Ms: rounded(percentile(route.durations, 0.5)),
    p95Ms: rounded(percentile(route.durations, 0.95)),
    maxMs: rounded(route.maxMs),
    lastStatus: route.lastStatus,
    lastSeenAt: new Date(route.lastSeenMs).toISOString(),
  };
}

function performanceState(
  requests: number,
  failures: number,
  p95Ms: number,
  slowThresholdMs: number,
  criticalThresholdMs: number,
): ApiPerformanceState {
  if (requests === 0) return "idle";
  const failureRate = failures / requests;
  if (
    p95Ms >= criticalThresholdMs ||
    (requests >= 5 && failureRate >= 0.2)
  ) {
    return "critical";
  }
  if (p95Ms >= slowThresholdMs || failures > 0) return "degraded";
  return "healthy";
}

function recommendations(
  state: ApiPerformanceState,
  routes: RoutePerformanceSnapshot[],
): string[] {
  if (state === "idle") {
    return ["浏览业务页面后将显示真实接口耗时；监控端点自身不计入样本。"];
  }

  const items: string[] = [];
  const failed = routes.find((route) => route.failureCount > 0);
  const slow = routes.find((route) => route.slowCount > 0);
  if (failed) {
    items.push(
      `优先检查 ${failed.method} ${failed.route}，窗口内失败 ${failed.failureCount} 次。`,
    );
  }
  if (slow) {
    items.push(
      `慢接口 ${slow.method} ${slow.route} 的 P95 为 ${slow.p95Ms.toFixed(0)}ms。`,
    );
  }
  if (items.length === 0) {
    items.push("当前业务 API 延迟和服务端失败率处于健康范围。");
  }
  return items.slice(0, 3);
}

export class RequestTelemetry {
  private readonly routes = new Map<string, RouteAccumulator>();
  private readonly maxRoutes: number;
  private readonly samplesPerRoute: number;
  private readonly slowThresholdMs: number;
  private readonly criticalThresholdMs: number;
  private readonly now: () => number;
  private inFlight = 0;

  constructor(options: RequestTelemetryOptions = {}) {
    this.maxRoutes = boundedInteger(options.maxRoutes ?? DEFAULT_MAX_ROUTES, DEFAULT_MAX_ROUTES);
    this.samplesPerRoute = boundedInteger(
      options.samplesPerRoute ?? DEFAULT_SAMPLES_PER_ROUTE,
      DEFAULT_SAMPLES_PER_ROUTE,
    );
    this.slowThresholdMs = finitePositive(
      options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS,
      DEFAULT_SLOW_THRESHOLD_MS,
    );
    this.criticalThresholdMs = Math.max(
      this.slowThresholdMs,
      finitePositive(
        options.criticalThresholdMs ?? DEFAULT_CRITICAL_THRESHOLD_MS,
        DEFAULT_CRITICAL_THRESHOLD_MS,
      ),
    );
    this.now = options.now ?? Date.now;
  }

  startRequest(): void {
    this.inFlight += 1;
  }

  finishRequest(sample: RequestTelemetrySample): void {
    this.cancelRequest();
    this.record(sample);
  }

  cancelRequest(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  record(sample: RequestTelemetrySample): void {
    const route = normalizeTelemetryRoute(sample.route);
    const method = sample.method.toUpperCase();
    const key = `${method} ${route}`;
    const now = this.now();
    const durationMs = Math.max(0, finitePositive(sample.durationMs, 0));
    let accumulator = this.routes.get(key);

    if (!accumulator) {
      this.evictRouteIfNeeded();
      accumulator = {
        method,
        route,
        requestCount: 0,
        failureCount: 0,
        slowCount: 0,
        durationTotalMs: 0,
        durations: [],
        maxMs: 0,
        lastStatus: sample.statusCode,
        lastSeenMs: now,
      };
      this.routes.set(key, accumulator);
    }

    accumulator.requestCount += 1;
    accumulator.failureCount += isFailure(sample.statusCode) ? 1 : 0;
    accumulator.slowCount += durationMs >= this.slowThresholdMs ? 1 : 0;
    accumulator.durationTotalMs += durationMs;
    accumulator.durations.push(durationMs);
    if (accumulator.durations.length > this.samplesPerRoute) {
      accumulator.durations.splice(0, accumulator.durations.length - this.samplesPerRoute);
    }
    accumulator.maxMs = Math.max(accumulator.maxMs, durationMs);
    accumulator.lastStatus = sample.statusCode;
    accumulator.lastSeenMs = now;
  }

  snapshot(): RequestTelemetrySnapshot {
    const routes = Array.from(this.routes.values())
      .map(routeSnapshot)
      .sort((left, right) =>
        right.p95Ms - left.p95Ms ||
        right.failureRate - left.failureRate ||
        right.requestCount - left.requestCount ||
        left.route.localeCompare(right.route),
      );
    const durations = Array.from(this.routes.values()).flatMap((route) => route.durations);
    const requests = routes.reduce((sum, route) => sum + route.requestCount, 0);
    const failures = routes.reduce((sum, route) => sum + route.failureCount, 0);
    const slowRequests = routes.reduce((sum, route) => sum + route.slowCount, 0);
    const durationTotalMs = Array.from(this.routes.values())
      .reduce((sum, route) => sum + route.durationTotalMs, 0);
    const p95Ms = rounded(percentile(durations, 0.95));
    const state = performanceState(
      requests,
      failures,
      p95Ms,
      this.slowThresholdMs,
      this.criticalThresholdMs,
    );

    return {
      generatedAt: new Date(this.now()).toISOString(),
      state,
      window: {
        maxRoutes: this.maxRoutes,
        samplesPerRoute: this.samplesPerRoute,
        slowThresholdMs: this.slowThresholdMs,
        criticalThresholdMs: this.criticalThresholdMs,
      },
      totals: {
        requests,
        failures,
        slowRequests,
        inFlight: this.inFlight,
        failureRate: requests > 0 ? failures / requests : 0,
        averageMs: requests > 0 ? rounded(durationTotalMs / requests) : 0,
        p50Ms: rounded(percentile(durations, 0.5)),
        p95Ms,
        maxMs: rounded(durations.length > 0 ? Math.max(...durations) : 0),
      },
      routes,
      recommendations: recommendations(state, routes),
    };
  }

  private evictRouteIfNeeded(): void {
    if (this.routes.size < this.maxRoutes) return;
    let oldestKey: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, route] of this.routes) {
      if (route.lastSeenMs < oldestSeen) {
        oldestKey = key;
        oldestSeen = route.lastSeenMs;
      }
    }
    if (oldestKey) this.routes.delete(oldestKey);
  }
}
