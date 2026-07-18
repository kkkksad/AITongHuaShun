import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_EXPIRED_EVENT,
  fetchApiPerformance,
  fetchAuditEvents,
  fetchCrossMarketStrategyContext,
  fetchExternalMarketImpact,
  fetchIpoSubscriptionResearch,
  fetchHongKongMarketResearch,
  fetchMarketDataQuality,
  fetchMarketRegimeResearch,
  fetchStrategyRobustness,
  fetchStockTrendForecast,
  fetchTurningPointResearch,
  getTradingSocketUrl,
  login,
  notifyAuthExpired,
  runPaperAutoExecutionOnce,
} from "./tradingApi";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("session-aware trading API", () => {
  beforeEach(() => {
    notifyAuthExpired();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses cookies and sends the in-memory CSRF token for mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          expiresIn: 3_600,
          expiresAt: "2026-07-14T13:00:00.000Z",
          csrfToken: "csrf-token",
          user: { username: "admin", role: "admin" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    await login("admin", "correct-horse-battery-staple");
    await runPaperAutoExecutionOnce();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/auth\/login$/),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/trading\/auto-paper-execution\/run$/),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("never puts authentication material in the WebSocket URL", () => {
    window.localStorage.setItem("xuanshu.auth.token", "legacy-sensitive-token");
    const url = getTradingSocketUrl();
    expect(url).not.toContain("token");
    expect(url).not.toContain("legacy-sensitive-token");
    expect(new URL(url).pathname).toBe("/ws");
  });

  it("notifies the application when a protected request returns 401", async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, handler, { once: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: "UNAUTHORIZED", message: "登录已失效，请重新登录" },
          401,
        ),
      ),
    );

    await expect(fetchAuditEvents()).rejects.toThrow("登录已失效");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("requests bounded real market-regime research with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "degraded",
        sectorOutlooks: [],
        stockRegimes: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchMarketRegimeResearch(99, 0, 999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/api\/research\/market-regime\?sectorLimit=20&stockLimit=1&days=500$/,
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests market data quality with cookie auth and forwards cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        provider: "akshare",
        requestedSymbols: 8,
        validSymbols: 8,
        qualityState: "healthy",
        score: { overall: 96 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchMarketDataQuality(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/market\/quality$/),
      expect.objectContaining({
        credentials: "include",
        signal: controller.signal,
      }),
    );
  });

  it("requests bounded API performance with cookie auth and forwards cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        state: "idle",
        totals: { requests: 0 },
        routes: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchApiPerformance(controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/system\/performance$/),
      expect.objectContaining({
        credentials: "include",
        signal: controller.signal,
      }),
    );
  });

  it("requests bounded real strategy robustness history with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        entries: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchStrategyRobustness(99, 999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/api\/research\/strategy-robustness\?limit=12&days=500$/,
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests bounded cross-market strategy context with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        riskTone: "neutral",
        futures: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchCrossMarketStrategyContext(99, 999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/api\/research\/cross-market-strategy-context\?limit=16&days=500$/,
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests bounded external-market impact with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        influenceMode: "observation-only",
        markets: [],
        crypto: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchExternalMarketImpact(999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/api\/research\/external-market-impact\?days=500$/,
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests bounded real IPO subscription research with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        items: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchIpoSubscriptionResearch(999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/research\/ipo-subscriptions\?limit=80$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("encodes a Chinese stock trend query and bounds the history window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        query: "贵州茅台 & 600519",
        resolution: "resolved",
        horizons: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchStockTrendForecast("  贵州茅台 & 600519  ", 999);

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    const parsed = new URL(requestedUrl, "http://localhost");
    expect(parsed.pathname).toBe("/api/research/stock-trend");
    expect(parsed.searchParams.get("query")).toBe("贵州茅台 & 600519");
    expect(parsed.searchParams.get("days")).toBe("500");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(requestedUrl).not.toContain("password");
    expect(requestedUrl).not.toContain("token");
  });

  it("requests a bounded turning-point scan with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        candidates: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchTurningPointResearch(99, 999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/research\/turning-points\?limit=12&days=500$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("requests bounded Hong Kong research with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sourceStatus: "live-read-only",
        items: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchHongKongMarketResearch(99, 999);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/research\/hong-kong-market\?limit=12&days=500$/),
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
