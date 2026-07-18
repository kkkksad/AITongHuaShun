export type ApiPerformanceState = "idle" | "healthy" | "degraded" | "critical";

export interface RoutePerformanceSnapshot {
  method: string;
  route: string;
  requestCount: number;
  failureCount: number;
  failureRate: number;
  slowCount: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastStatus: number;
  lastSeenAt: string;
}

export interface RequestTelemetrySnapshot {
  generatedAt: string;
  state: ApiPerformanceState;
  window: {
    maxRoutes: number;
    samplesPerRoute: number;
    slowThresholdMs: number;
    criticalThresholdMs: number;
  };
  totals: {
    requests: number;
    failures: number;
    slowRequests: number;
    inFlight: number;
    failureRate: number;
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  routes: RoutePerformanceSnapshot[];
  recommendations: string[];
}

export interface ApiPerformanceRuntime {
  mode: string;
  marketDataProvider: string;
  realTradingEnabled: boolean;
  websocketConnections: number;
  marketQuality: {
    state: "healthy" | "degraded" | "unusable";
    overall: number;
    freshness: number;
    validSymbols: number;
    requestedSymbols: number;
    issueCount: number;
  };
}

export interface ApiPerformanceSnapshot extends RequestTelemetrySnapshot {
  runtime: ApiPerformanceRuntime;
}
