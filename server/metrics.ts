/**
 * Prometheus-compatible metrics collector.
 *
 * Exposes a /metrics endpoint for Prometheus scraping.
 * Tracks:
 *   - HTTP request count & latency by route/method/status
 *   - WebSocket connections
 *   - Order execution count
 *   - Account equity snapshot
 *   - Risk circuit breaker state
 */

interface MetricLabel {
  [key: string]: string;
}

interface CounterMetric {
  type: "counter";
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, number>;
}

interface GaugeMetric {
  type: "gauge";
  name: string;
  help: string;
  labelNames: string[];
  values: Map<string, number>;
}

type Metric = CounterMetric | GaugeMetric;

function labelKey(labels: MetricLabel, labelNames: string[]): string {
  return labelNames.map((n) => `${n}="${labels[n] ?? ""}"`).join(",");
}

class MetricsRegistry {
  private metrics: Map<string, Metric> = new Map();

  registerCounter(name: string, help: string, labelNames: string[] = []): void {
    this.metrics.set(name, {
      type: "counter",
      name,
      help,
      labelNames,
      values: new Map(),
    });
  }

  registerGauge(name: string, help: string, labelNames: string[] = []): void {
    this.metrics.set(name, {
      type: "gauge",
      name,
      help,
      labelNames,
      values: new Map(),
    });
  }

  inc(name: string, labels: MetricLabel = {}, by = 1): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "counter") return;
    const k = labelKey(labels, metric.labelNames);
    metric.values.set(k, (metric.values.get(k) ?? 0) + by);
  }

  set(name: string, value: number, labels: MetricLabel = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") return;
    const k = labelKey(labels, metric.labelNames);
    metric.values.set(k, value);
  }

  get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /** Export all metrics in Prometheus text format */
  export(): string {
    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      for (const [k, v] of metric.values) {
        if (k) {
          lines.push(`${metric.name}{${k}} ${v}`);
        } else {
          lines.push(`${metric.name} ${v}`);
        }
      }
    }

    return lines.join("\n") + "\n";
  }
}

// ─── Singleton registry ────────────────────────────────────────────────────

const registry = new MetricsRegistry();

// HTTP metrics
registry.registerCounter(
  "http_requests_total",
  "Total HTTP requests",
  ["method", "route", "status"],
);
registry.registerCounter(
  "http_request_duration_seconds_total",
  "Total HTTP request duration in seconds",
  ["method", "route", "status"],
);

// WebSocket metrics
registry.registerGauge(
  "ws_connections",
  "Active WebSocket connections",
);

// Trading metrics
registry.registerCounter(
  "orders_total",
  "Total orders submitted",
  ["side", "status"],
);
registry.registerCounter(
  "order_cancellations_total",
  "Total order cancellations",
);

// Account metrics
registry.registerGauge(
  "account_equity",
  "Current account equity in CNY",
);
registry.registerGauge(
  "account_cash",
  "Current account cash in CNY",
);
registry.registerGauge(
  "account_positions_count",
  "Number of open positions",
);

// Risk metrics
registry.registerGauge(
  "risk_circuit_breaker",
  "Circuit breaker active (1 = tripped, 0 = normal)",
);

// ─── Public API ────────────────────────────────────────────────────────────

export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationSec: number,
): void {
  registry.inc("http_requests_total", {
    method: method.toUpperCase(),
    route,
    status: String(status),
  });
  registry.inc("http_request_duration_seconds_total", {
    method: method.toUpperCase(),
    route,
    status: String(status),
  }, durationSec);
}

export function recordWebSocketConnection(delta: number): void {
  const current = getMetricValue("ws_connections") ?? 0;
  registry.set("ws_connections", Math.max(0, current + delta));
}

export function recordOrder(side: string, status: string): void {
  registry.inc("orders_total", { side, status });
}

export function recordOrderCancellation(): void {
  registry.inc("order_cancellations_total");
}

export function recordAccountEquity(equity: number): void {
  registry.set("account_equity", equity);
}

export function recordAccountCash(cash: number): void {
  registry.set("account_cash", cash);
}

export function recordAccountPositions(count: number): void {
  registry.set("account_positions_count", count);
}

export function recordCircuitBreaker(active: boolean): void {
  registry.set("risk_circuit_breaker", active ? 1 : 0);
}

export function getMetricsText(): string {
  return registry.export();
}

function getMetricValue(name: string): number | undefined {
  const metric = registry.get(name);
  if (!metric) return undefined;
  // For gauge with no labels, return first value
  for (const v of metric.values.values()) {
    return v;
  }
  return undefined;
}
