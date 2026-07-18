import { describe, expect, it } from "vitest";
import {
  RequestTelemetry,
  normalizeTelemetryRoute,
  shouldTrackTelemetryRequest,
} from "./requestTelemetry";

describe("RequestTelemetry", () => {
  it("starts idle with bounded zero-value totals", () => {
    const telemetry = new RequestTelemetry();

    expect(telemetry.snapshot()).toMatchObject({
      state: "idle",
      totals: {
        requests: 0,
        failures: 0,
        slowRequests: 0,
        inFlight: 0,
        failureRate: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
      },
      routes: [],
    });
  });

  it("computes percentiles, server failures, slow requests, and critical state", () => {
    let now = 1_000;
    const telemetry = new RequestTelemetry({ now: () => now });
    const samples = [100, 200, 300, 600, 1_600, 2_000, 6_000];

    samples.forEach((durationMs, index) => {
      now += 10;
      telemetry.record({
        durationMs,
        method: "GET",
        route: "/api/research/strategy-leaderboard",
        statusCode: index === 4 ? 429 : index === 6 ? 503 : 200,
      });
    });

    const snapshot = telemetry.snapshot();
    expect(snapshot.state).toBe("critical");
    expect(snapshot.totals).toMatchObject({
      requests: 7,
      failures: 2,
      slowRequests: 3,
      failureRate: 2 / 7,
      p50Ms: 600,
      p95Ms: 6_000,
      maxMs: 6_000,
    });
    expect(snapshot.routes[0]).toMatchObject({
      method: "GET",
      route: "/api/research/strategy-leaderboard",
      requestCount: 7,
      failureCount: 2,
      slowCount: 3,
      lastStatus: 503,
    });
  });

  it("does not classify ordinary 4xx validation responses as backend failures", () => {
    const telemetry = new RequestTelemetry();
    telemetry.record({
      durationMs: 20,
      method: "GET",
      route: "/api/research/stock-trend",
      statusCode: 400,
    });

    expect(telemetry.snapshot().totals.failures).toBe(0);
  });

  it("bounds percentile samples without losing lifetime route counts", () => {
    const telemetry = new RequestTelemetry({ samplesPerRoute: 2 });
    [100, 200, 300, 400, 500].forEach((durationMs) => {
      telemetry.record({
        durationMs,
        method: "GET",
        route: "/api/orders",
        statusCode: 200,
      });
    });

    const route = telemetry.snapshot().routes[0];
    expect(route.requestCount).toBe(5);
    expect(route.p50Ms).toBe(400);
    expect(route.p95Ms).toBe(500);
  });

  it("evicts the least recently updated route when the route budget is full", () => {
    let now = 1_000;
    const telemetry = new RequestTelemetry({ maxRoutes: 2, now: () => now });
    const record = (route: string) => {
      now += 1;
      telemetry.record({ durationMs: 10, method: "GET", route, statusCode: 200 });
    };

    record("/api/first");
    record("/api/second");
    record("/api/third");

    expect(telemetry.snapshot().routes.map((route) => route.route).sort()).toEqual([
      "/api/second",
      "/api/third",
    ]);
  });

  it("tracks in-flight requests without allowing negative counts", () => {
    const telemetry = new RequestTelemetry();
    telemetry.startRequest();
    telemetry.startRequest();
    expect(telemetry.snapshot().totals.inFlight).toBe(2);

    telemetry.finishRequest({
      durationMs: 25,
      method: "GET",
      route: "/api/account",
      statusCode: 200,
    });
    telemetry.finishRequest({
      durationMs: 30,
      method: "GET",
      route: "/api/account",
      statusCode: 200,
    });
    telemetry.finishRequest({
      durationMs: 35,
      method: "GET",
      route: "/api/account",
      statusCode: 200,
    });

    expect(telemetry.snapshot().totals.inFlight).toBe(0);
  });

  it("releases in-flight capacity when a client aborts", () => {
    const telemetry = new RequestTelemetry();
    telemetry.startRequest();
    telemetry.cancelRequest();
    telemetry.cancelRequest();

    expect(telemetry.snapshot().totals.inFlight).toBe(0);
    expect(telemetry.snapshot().totals.requests).toBe(0);
  });

  it("normalizes query values and excludes observer endpoints", () => {
    expect(normalizeTelemetryRoute("/api/orders?limit=50")).toBe("/api/orders");
    expect(normalizeTelemetryRoute("/api/orders/:orderId")).toBe("/api/orders/:orderId");
    expect(shouldTrackTelemetryRequest("GET", "/api/orders?limit=50")).toBe(true);
    expect(shouldTrackTelemetryRequest("OPTIONS", "/api/orders")).toBe(false);
    expect(shouldTrackTelemetryRequest("GET", "/api/health")).toBe(false);
    expect(shouldTrackTelemetryRequest("GET", "/api/system/performance")).toBe(false);
    expect(shouldTrackTelemetryRequest("GET", "/metrics")).toBe(false);
    expect(shouldTrackTelemetryRequest("POST", "/api/auth/login")).toBe(false);
    expect(shouldTrackTelemetryRequest("GET", "/api/auth/session")).toBe(false);
    expect(shouldTrackTelemetryRequest("POST", "/api/auth/logout")).toBe(false);
  });
});
