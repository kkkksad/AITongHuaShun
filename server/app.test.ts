import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTradingApp } from "./app";
import { hashPassword } from "./auth";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";

async function useGrowthPaperProfile(app: FastifyInstance): Promise<void> {
  const response = await app.inject({
    method: "PUT",
    url: "/api/account/strategy-profile",
    payload: { strategyProfile: "growth" },
  });
  expect(response.statusCode).toBe(200);
}

function todayAtChinaTime(time: string): Date {
  const chinaDate = new Date(Date.now() + 8 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
  return new Date(`${chinaDate}T${time}+08:00`);
}

describe("trading API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTradingApp({
      config: createTestConfig(),
      startMarket: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports a healthy simulation-only service", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      mode: "mock",
      realTradingEnabled: false,
      authEnabled: false,
    });
  });

  it("rejects account reset outside paper mode", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/reset",
      payload: {
        startingCash: 10_000,
        strategyProfile: "balanced",
        confirmation: "重置模拟账户",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "PAPER_MODE_REQUIRED" });
  });

  it("resets a paper account and persists the selected strategy profile", async () => {
    await app.close();
    app = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_SEED_PORTFOLIO: false,
      }),
      startMarket: false,
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/account/reset",
      payload: {
        startingCash: 999,
        strategyProfile: "growth",
        confirmation: "重置模拟账户",
      },
    });
    expect(invalid.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/api/account/reset",
      payload: {
        startingCash: 20_000,
        strategyProfile: "defensive",
        confirmation: "重置模拟账户",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        cash: 20_000,
        equity: 20_000,
        startingEquity: 20_000,
        strategyProfile: "defensive",
      },
      positions: [],
      orders: [],
    });

    const profile = await app.inject({
      method: "PUT",
      url: "/api/account/strategy-profile",
      payload: { strategyProfile: "growth" },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().account.strategyProfile).toBe("growth");
  });

  it("returns bounded system log pagination metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/logs?limit=50&offset=0",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: expect.any(Number),
      filtered: expect.any(Number),
      returned: expect.any(Number),
      offset: 0,
      limit: 50,
      page: 1,
      pageCount: expect.any(Number),
      hasPrevious: false,
      hasNext: expect.any(Boolean),
      entries: expect.any(Array),
    });

    const excessiveLimit = await app.inject({
      method: "GET",
      url: "/api/logs?limit=201",
    });
    const negativeOffset = await app.inject({
      method: "GET",
      url: "/api/logs?offset=-1",
    });

    expect(excessiveLimit.statusCode).toBe(400);
    expect(negativeOffset.statusCode).toBe(400);
  });

  it("declares read-only market data and paper-only execution capabilities", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/capabilities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketData: {
        provider: "mock",
        readOnly: true,
        external: false,
      },
      execution: {
        provider: "paper-broker",
        mode: "paper",
        liveSupported: false,
        humanApprovalRequiredForLive: true,
      },
      autoPaperExecution: {
        enabled: false,
        mode: "local-paper-broker-only",
        liveTradingEnabled: false,
      },
      authentication: {
        enabled: false,
        mode: "test-unprotected",
        defaultCredentials: false,
      },
      researchData: {
        dataDir: "./data/research",
        maxSymbols: 200,
        historyDays: 756,
        maxCacheMb: 512,
        storeRawNews: false,
      },
    });
    expect(response.json().openApi).toBe("/documentation/json");
  });

  it("returns coverage-aware market quality with short private cache semantics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/market/quality",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "private, max-age=5, stale-while-revalidate=15",
    );
    expect(response.json()).toMatchObject({
      provider: "mock",
      requestedSymbols: expect.any(Number),
      validSymbols: expect.any(Number),
      qualityState: expect.stringMatching(/healthy|degraded|unusable/),
      score: {
        freshness: expect.any(Number),
        completeness: expect.any(Number),
        staleCount: expect.any(Number),
        overall: expect.any(Number),
      },
    });
  });

  it("returns an idle bounded API performance snapshot without recording itself", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/system/performance",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      state: "idle",
      window: {
        maxRoutes: 64,
        samplesPerRoute: 128,
        slowThresholdMs: 1_500,
      },
      totals: {
        requests: 0,
        failures: 0,
        inFlight: 0,
      },
      routes: [],
      runtime: {
        mode: "mock",
        marketDataProvider: "mock",
        realTradingEnabled: false,
        websocketConnections: 0,
        marketQuality: {
          state: expect.stringMatching(/healthy|degraded|unusable/),
          overall: expect.any(Number),
          freshness: expect.any(Number),
          validSymbols: expect.any(Number),
          requestedSymbols: expect.any(Number),
          issueCount: expect.any(Number),
        },
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /cookie|csrf|password|token|requestBody|responseBody/i,
    );
  });

  it("aggregates completed business requests by route template", async () => {
    const account = await app.inject({ method: "GET", url: "/api/account" });
    expect(account.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/system/performance",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "healthy",
      totals: {
        requests: 1,
        failures: 0,
        inFlight: 0,
      },
      routes: [
        {
          method: "GET",
          route: "/api/account",
          requestCount: 1,
          failureCount: 0,
          lastStatus: 200,
          p95Ms: expect.any(Number),
        },
      ],
    });
  });

  it("protects APIs, metrics, docs, and mutations with a server session", async () => {
    const password = "correct-horse-battery-staple";
    const authApp = await buildTradingApp({
      config: createTestConfig({
        AUTH_ENABLED: true,
        AUTH_USERNAME: "local-admin",
        AUTH_PASSWORD_HASH: await hashPassword(password),
      }),
      startMarket: false,
    });

    try {
      for (const url of [
        "/api/capabilities",
        "/api/account",
        "/api/system/performance",
        "/api/research/daily-review",
        "/api/research/strategy-robustness",
        "/api/research/cross-market-strategy-context",
        "/api/research/market-regime",
        "/api/research/turning-points",
        "/api/research/hong-kong-market",
        "/api/research/stock-trend?query=600519",
        "/api/research/ipo-subscriptions",
        "/metrics",
        "/documentation/json",
      ]) {
        const rejected = await authApp.inject({ method: "GET", url });
        expect(rejected.statusCode, url).toBe(401);
      }

      const login = await authApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "local-admin",
          password,
        },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).not.toHaveProperty("token");
      const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
      const sessionCookie = String(login.headers["set-cookie"]).split(";")[0];

      const account = await authApp.inject({
        method: "GET",
        url: "/api/account",
        headers: { cookie: sessionCookie },
      });
      expect(account.statusCode).toBe(200);

      const capabilities = await authApp.inject({
        method: "GET",
        url: "/api/capabilities",
        headers: { cookie: sessionCookie },
      });
      expect(capabilities.statusCode).toBe(200);
      expect(capabilities.json().authentication).toMatchObject({
        enabled: true,
        mode: "server-session",
      });

      const missingCsrf = await authApp.inject({
        method: "POST",
        url: "/api/trading/pause",
        headers: { cookie: sessionCookie },
      });
      expect(missingCsrf.statusCode).toBe(403);

      const paused = await authApp.inject({
        method: "POST",
        url: "/api/trading/pause",
        headers: { cookie: sessionCookie, "x-csrf-token": csrfToken },
      });
      expect(paused.statusCode).toBe(200);

      const logout = await authApp.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: sessionCookie, "x-csrf-token": csrfToken },
      });
      expect(logout.statusCode).toBe(200);

      const afterLogout = await authApp.inject({
        method: "GET",
        url: "/api/account",
        headers: { cookie: sessionCookie },
      });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      await authApp.close();
    }
  });

  it("rate limits repeated login failures", async () => {
    const authApp = await buildTradingApp({
      config: createTestConfig({
        AUTH_ENABLED: true,
        AUTH_USERNAME: "local-admin",
        AUTH_PASSWORD_HASH: await hashPassword("correct-horse-battery-staple"),
        AUTH_LOGIN_RATE_LIMIT_MAX: 2,
      }),
      startMarket: false,
    });

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await authApp.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "local-admin", password: "wrong-password" },
        });
        expect(response.statusCode).toBe(401);
      }
      const limited = await authApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "local-admin", password: "wrong-password" },
      });
      expect(limited.statusCode).toBe(429);
    } finally {
      await authApp.close();
    }
  });

  it("returns a guarded strategy research leaderboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/strategy-leaderboard?bars=45",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: {
        provider: "mock",
        sampleType: "synthetic-from-current-snapshot",
        bars: 45,
      },
    });
    expect(response.json().entries.length).toBeGreaterThan(0);
    expect(
      response.json().entries.map((entry: { strategyKey: string }) => entry.strategyKey),
    ).toEqual(expect.arrayContaining(["kairosWashoutRecovery", "kairosTrendHealth"]));
    expect(response.json().entries[0]).toMatchObject({
      rank: 1,
      bestParams: expect.any(Object),
      metrics: expect.any(Object),
    });
    expect(
      response.json().entries.some(
        (entry: { qualityGate: string; metrics: { totalTrades: number; totalReturn: number } }) =>
          entry.qualityGate !== "blocked" &&
          entry.metrics.totalTrades > 0 &&
          entry.metrics.totalReturn > 0,
      ),
    ).toBe(true);
    expect(response.json().guardrails.join("")).toContain("不代表真实收益");
  });

  it("returns daily A-share strategy candidates for paper validation", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/daily-candidates?limit=3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      strategyKey: "aSharePullback",
      strategyName: "A股强势回踩确认",
      autoUpdate: {
        execution: "paper-only",
      },
    });
    expect(response.json().candidates.length).toBeLessThanOrEqual(3);
    expect(response.json().candidates[0]).toMatchObject({
      rank: 1,
      symbol: expect.any(String),
      score: expect.any(Number),
      action: expect.stringMatching(/paper-buy|watch|avoid/),
    });
    expect(response.json().guardrails.join("")).toContain("模拟盘观察");
  });

  it("returns daily quality stocks for research watchlists", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/daily-quality-stocks?limit=3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      methodology: {
        name: "每日优质股评分",
        dataScope: {
          historicalBars: false,
        },
      },
      autoUpdate: {
        execution: "paper-only",
      },
    });
    expect(response.json().stocks.length).toBeLessThanOrEqual(3);
    expect(response.json().stocks[0]).toMatchObject({
      rank: 1,
      symbol: expect.any(String),
      score: expect.any(Number),
      grade: expect.stringMatching(/S|A|B|C/),
      action: expect.stringMatching(/focus|watch|avoid/),
    });
    expect(response.json().guardrails.join("")).toContain("每日优质股");
  });

  it("tracks in-memory research learning state", async () => {
    await app.inject({
      method: "GET",
      url: "/api/research/strategy-leaderboard?bars=45",
    });
    await app.inject({
      method: "GET",
      url: "/api/research/daily-candidates?limit=3",
    });
    await app.inject({
      method: "GET",
      url: "/api/research/daily-quality-stocks?limit=3",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/research/learning-state",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      dataMemory: {
        storage: "in-memory",
        marketSnapshotSamples: expect.any(Number),
        researchRuns: 3,
      },
      researchLoop: {
        strategyLeaderboardRuns: 1,
        dailyCandidateRuns: 1,
        dailyQualityRuns: 1,
      },
      currentCapability: {
        paperExecution: true,
        liveExecution: false,
      },
    });
    expect(response.json().researchLoop.latestRuns).toHaveLength(3);
    expect(response.json().guardrails.join("")).toContain("不代表真实收益");
  });

  it("returns self-optimization and bounded research data policy", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/self-optimization",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "paper-research",
      optimizer: {
        status: "guarded-ready",
      },
      retention: {
        backend: "bounded-local-cache",
        dataDir: "./data/research",
        maxSymbols: 200,
        historyDays: 756,
        maxCacheMb: 512,
        storeRawNews: false,
      },
    });
    expect(response.json().guardrails.join("")).toContain("paper trading");
  });

  it("publishes an OpenAPI document for the simulation API", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      info: {
        title: "KAIROS Quant API",
      },
    });
    expect(response.json().paths).toHaveProperty("/api/orders");
    expect(response.json().paths).toHaveProperty("/api/capabilities");
    expect(response.json().paths).toHaveProperty("/api/market/quality");
    expect(response.json().paths).toHaveProperty("/api/system/performance");
    expect(response.json().paths).toHaveProperty("/api/research/strategy-leaderboard");
    expect(response.json().paths).toHaveProperty("/api/research/strategy-robustness");
    expect(response.json().paths).toHaveProperty("/api/research/cross-market-strategy-context");
    expect(response.json().paths).toHaveProperty("/api/research/daily-candidates");
    expect(response.json().paths).toHaveProperty("/api/research/daily-quality-stocks");
    expect(response.json().paths).toHaveProperty("/api/research/learning-state");
    expect(response.json().paths).toHaveProperty("/api/research/paper-trading-plan");
    expect(response.json().paths).toHaveProperty("/api/integrations/supermind/signal-package");
    expect(response.json().paths).toHaveProperty("/api/trading/auto-paper-execution/status");
    expect(response.json().paths).toHaveProperty("/api/trading/auto-paper-execution/run");
    expect(response.json().paths).toHaveProperty("/api/research/real-data-feed");
    expect(response.json().paths).toHaveProperty("/api/research/market-regime");
    expect(response.json().paths).toHaveProperty("/api/research/turning-points");
    expect(response.json().paths).toHaveProperty("/api/research/hong-kong-market");
    expect(response.json().paths).toHaveProperty("/api/research/stock-trend");
    expect(response.json().paths).toHaveProperty("/api/research/self-optimization");
  });

  it("returns explicit real-data feed boundaries when AkShare is disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/real-data-feed",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      news: {
        items: [],
      },
      globalMarkets: {
        markets: [],
      },
      impact: {
        direction: "neutral",
      },
    });
    expect(response.json().news.warning).toContain("不会使用静态模拟数据替代");
    expect(response.json().guardrails.join("")).toContain("不包含账户、下单或撤单能力");
  });

  it("validates lightweight real-data feed bounds", async () => {
    const invalidNewsLimit = await app.inject({
      method: "GET",
      url: "/api/research/real-data-feed?scope=news&newsLimit=9&symbolLimit=3",
    });
    const invalidSymbolLimit = await app.inject({
      method: "GET",
      url: "/api/research/real-data-feed?scope=news&newsLimit=40&symbolLimit=9",
    });

    expect(invalidNewsLimit.statusCode).toBe(400);
    expect(invalidSymbolLimit.statusCode).toBe(400);
  });

  it("does not replace real strategy robustness history with synthetic data", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/strategy-robustness?limit=12&days=500",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      source: {
        sampleType: "real-qfq-fixed-parameter-multi-window",
        requestedDays: 500,
        windowCount: 3,
      },
      methodology: {
        parametersOptimizedOnReportData: false,
        nonOverlappingWindows: true,
      },
      entries: [],
    });
    expect(response.json().warnings.join(" ")).toContain("不会使用合成历史替代");
  });

  it("validates strategy robustness query bounds", async () => {
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/research/strategy-robustness?limit=13&days=500",
    });
    const invalidDays = await app.inject({
      method: "GET",
      url: "/api/research/strategy-robustness?limit=12&days=359",
    });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidDays.statusCode).toBe(400);
  });

  it("does not fabricate a cross-market strategy context in mock mode", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/cross-market-strategy-context?limit=12&days=180",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      riskTone: "mixed",
      positionPosture: "cash-only",
      futures: [],
      source: {
        requestedDays: 180,
        globalCount: 0,
        futuresQuoteCount: 0,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不直接生成订单");
  });

  it("validates cross-market strategy context query bounds", async () => {
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/research/cross-market-strategy-context?limit=3&days=180",
    });
    const invalidDays = await app.inject({
      method: "GET",
      url: "/api/research/cross-market-strategy-context?limit=12&days=59",
    });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidDays.statusCode).toBe(400);
  });

  it("does not fabricate external-market impact in mock mode", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/external-market-impact?days=500",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      influenceMode: "observation-only",
      markets: [],
      crypto: [],
      aShareImpact: {
        bias: "neutral",
        allowPositionIncrease: false,
      },
      source: {
        requestedDays: 500,
        globalSnapshotCount: 0,
        cryptoCount: 0,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不能提高 A 股仓位");
  });

  it("validates external-market impact query bounds", async () => {
    const invalidDays = await app.inject({
      method: "GET",
      url: "/api/research/external-market-impact?days=59",
    });

    expect(invalidDays.statusCode).toBe(400);
  });

  it("does not replace unavailable market-regime history with static data", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/market-regime?sectorLimit=5&stockLimit=4&days=180",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      source: {
        days: 180,
        sectorAdjustment: "none",
        stockAdjustment: "qfq",
      },
      sectorOutlooks: [],
      stockRegimes: [],
      methodology: {
        horizons: [3, 5],
        walkForward: true,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不会使用静态板块数据替代");
  });

  it("does not fabricate a stock trend forecast when real history is disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/stock-trend?query=600519&days=360",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      query: "600519",
      resolution: "mock-disabled",
      selected: null,
      matches: [],
      horizons: [],
      chart: [],
      methodology: {
        horizons: [3, 5, 10],
        walkForward: true,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不会提交模拟或真实订单");
  });

  it("does not fabricate turning-point candidates when real history is disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/turning-points?limit=12&days=360",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      horizon: 5,
      minimumSamples: 20,
      candidates: [],
      source: {
        requestedDays: 360,
        analyzedCount: 0,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不直接生成本地 paper");
  });

  it("validates turning-point query bounds before accessing history", async () => {
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/research/turning-points?limit=13&days=360",
    });
    const invalidDays = await app.inject({
      method: "GET",
      url: "/api/research/turning-points?limit=8&days=179",
    });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidDays.statusCode).toBe(400);
  });

  it("does not fabricate Hong Kong market research when AkShare is disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/hong-kong-market?limit=8&days=180",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      sourceStatus: "mock-disabled",
      items: [],
      source: {
        requestedDays: 180,
        quoteCount: 0,
        historyCount: 0,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不会生成港股订单");
  });

  it("validates Hong Kong research query bounds", async () => {
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/api/research/hong-kong-market?limit=0&days=180",
    });
    const invalidDays = await app.inject({
      method: "GET",
      url: "/api/research/hong-kong-market?limit=8&days=59",
    });

    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidDays.statusCode).toBe(400);
  });

  it("validates stock trend queries before accessing research data", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/research/stock-trend",
    });
    const tooLong = await app.inject({
      method: "GET",
      url: `/api/research/stock-trend?query=${"a".repeat(41)}`,
    });

    expect(missing.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
  });

  it("adds baseline security headers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("rate limits repeated requests", async () => {
    const limitedApp = await buildTradingApp({
      config: {
        ...createTestConfig(),
        RATE_LIMIT_MAX: 1,
        RATE_LIMIT_WINDOW_MS: 60_000,
      },
      startMarket: false,
    });

    try {
      await limitedApp.inject({
        method: "GET",
        url: "/api/health",
      });
      const response = await limitedApp.inject({
        method: "GET",
        url: "/api/health",
      });

      expect(response.statusCode).toBe(429);
    } finally {
      await limitedApp.close();
    }
  });

  it("validates order request payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "INVALID",
        side: "buy",
        type: "market",
        quantity: 100,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "INVALID_REQUEST",
    });
  });

  it("fills orders and exposes them through the order endpoint", async () => {
    const orderResponse = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "300750",
        side: "buy",
        type: "market",
        quantity: 100,
        clientOrderId: "api-order-1",
      },
    });
    const ordersResponse = await app.inject({
      method: "GET",
      url: "/api/orders",
    });

    expect(orderResponse.statusCode).toBe(201);
    expect(orderResponse.json().order.status).toBe("filled");
    expect(ordersResponse.json()).toHaveLength(1);
  });

  it("rejects new orders after the account is paused", async () => {
    await app.inject({
      method: "POST",
      url: "/api/trading/pause",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "300750",
        side: "buy",
        type: "market",
        quantity: 100,
        clientOrderId: "paused-order",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().order).toMatchObject({
      status: "rejected",
      rejectionReason: "交易已暂停",
    });
  });

  it("accepts a limit order as pending", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "601318",
        side: "buy",
        type: "limit",
        quantity: 100,
        limitPrice: 50,
        clientOrderId: "api-limit-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().order).toMatchObject({
      status: "pending",
      type: "limit",
      limitPrice: 50,
      symbol: "601318",
    });
  });

  it("rejects a limit order without limitPrice", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "601318",
        side: "buy",
        type: "limit",
        quantity: 100,
        clientOrderId: "bad-limit",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_REQUEST");
  });

  it("cancels a pending order", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: {
        symbol: "601318",
        side: "buy",
        type: "limit",
        quantity: 100,
        limitPrice: 50,
        clientOrderId: "to-cancel-api",
      },
    });

    const orderId = createResponse.json().order.id;

    const cancelResponse = await app.inject({
      method: "DELETE",
      url: `/api/orders/${orderId}`,
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().order.status).toBe("cancelled");
  });

  it("returns error when cancelling a non-existent order", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/orders/non-existent-id",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_REQUEST");
  });

  it("returns a paper trading plan with A-share guardrails", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/paper-trading-plan",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "mock",
      capitalPlan: {
        lotSize: 100,
      },
      account: {
        accountId: expect.any(String),
      },
    });
    expect(response.json().rules.join("")).toContain("T+1");
    expect(response.json().guardrails.join("")).toContain("同花顺");
    expect(response.json().qualitySummary).toMatchObject({
      candidatePoolSize: expect.any(Number),
      affordableCandidateCount: expect.any(Number),
      actionCounts: expect.objectContaining({
        "paper-buy-plan": expect.any(Number),
        blocked: expect.any(Number),
        hold: expect.any(Number),
      }),
      strategyCoverage: expect.objectContaining({
        matchedKeys: expect.any(Array),
        unmatchedCandidateCount: expect.any(Number),
      }),
      planQuality: expect.stringMatching(/^(actionable|watch-only|blocked)$/),
    });
    expect(response.json().operations.length).toBeGreaterThan(0);
  });

  it("returns a daily market and paper trading review", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/daily-review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "mock",
      provider: "mock",
      dateBasis: expect.stringMatching(
        /^(current-weekday|pre-market-previous-weekday|weekend-previous-weekday)$/,
      ),
      market: {
        tone: expect.stringMatching(/^(risk-on|balanced|risk-off|insufficient-data)$/),
        breadth: {
          total: expect.any(Number),
          advancers: expect.any(Number),
          decliners: expect.any(Number),
        },
      },
      account: {
        equity: expect.any(Number),
        cumulativePnl: expect.any(Number),
        cumulativePnlPercent: expect.any(Number),
        performanceBasis: expect.stringMatching(/^(mark-to-market|unavailable)$/),
        missingPreviousCloseSymbols: expect.any(Array),
        capitalDeployedPercent: expect.any(Number),
      },
      trades: {
        submitted: expect.any(Number),
        items: expect.any(Array),
      },
      strategyReview: {
        grade: expect.stringMatching(/^(disciplined|watch|needs-improvement)$/),
        nextActions: expect.any(Array),
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("paper");
  });

  it("does not substitute static IPO subscriptions when real data is disabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/ipo-subscriptions?limit=40",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "mock",
      provider: "mock",
      sourceStatus: "mock-disabled",
      items: [],
      counts: {
        openToday: 0,
        upcoming: 0,
        awaitingListing: 0,
        listedRecently: 0,
      },
    });
    expect(response.json().guardrails.join(" ")).toContain("不会自动提交新股申购");
  });

  it("returns safe paper auto execution status by default", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/trading/auto-paper-execution/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: false,
      mode: "paper-auto",
      execution: "local-paper-broker-only",
      liveTradingEnabled: false,
      tradeWindowOnly: true,
    });
    expect(response.json().guardrails.join("")).toContain("PaperBroker");
  });

  it("keeps the API alive when the first paper execution runs before market data arrives", async () => {
    const config = createTestConfig({
      MARKET_MODE: "paper",
      PAPER_AUTO_EXECUTION_ENABLED: true,
      PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: false,
    });
    const system = createTradingSystem(config);
    vi.spyOn(system.market, "getSnapshot").mockReturnValue({
      mode: "paper",
      sequence: 0,
      marketTime: new Date().toISOString(),
      quotes: [],
    });
    const paperApp = await buildTradingApp({
      config,
      system,
      startMarket: false,
    });

    try {
      const run = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });
      const health = await paperApp.inject({
        method: "GET",
        url: "/api/health",
      });

      expect(run.statusCode).toBe(200);
      expect(run.json().run).toMatchObject({
        planQuality: "not-run",
        submittedOrders: [],
      });
      expect(run.json().run.skippedOperations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          symbol: "SYSTEM",
          action: "observe",
          reason: expect.stringContaining("temporarily unavailable"),
        }),
      ]));
      expect(health.statusCode).toBe(200);
    } finally {
      await paperApp.close();
    }
  });

  it("can manually run paper auto execution in local paper mode", async () => {
    const paperApp = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_STARTING_CASH: 10_000,
        TRADING_SEED_PORTFOLIO: false,
        MAX_ORDER_NOTIONAL: 6_000,
        MAX_POSITION_WEIGHT: 1,
        PAPER_AUTO_EXECUTION_ENABLED: true,
        PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: false,
        PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN: 1,
        PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: 2,
      }),
      startMarket: false,
      clock: () => todayAtChinaTime("10:30:00"),
    });
    await useGrowthPaperProfile(paperApp);

    try {
      const response = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });
      const orders = await paperApp.inject({
        method: "GET",
        url: "/api/orders",
      });
      const audit = await paperApp.inject({
        method: "GET",
        url: "/api/audit?limit=20",
      });
      const status = await paperApp.inject({
        method: "GET",
        url: "/api/trading/auto-paper-execution/status",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().run).toMatchObject({
        trigger: "manual",
        planQuality: "actionable",
      });
      expect(response.json().run.submittedOrders).toHaveLength(1);
      expect(response.json().run.submittedOrders[0]).toMatchObject({
        side: "buy",
        status: "filled",
      });
      expect(response.json().run.submittedOrders[0].clientOrderId).toContain(
        "kairos-auto-paper",
      );
      expect(orders.json()[0].clientOrderId).toContain("kairos-auto-paper");
      expect(status.json().todaySubmittedOrders).toBe(1);
      expect(audit.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "paper-auto-execution.run",
          data: expect.objectContaining({
            trigger: "manual",
            submittedOrders: 1,
          }),
        }),
        expect.objectContaining({
          action: "paper-auto-execution.decision",
          data: expect.objectContaining({
            strategy: expect.any(String),
            reason: expect.any(String),
            ruleChecks: expect.any(Array),
          }),
        }),
      ]));
    } finally {
      await paperApp.close();
    }
  });

  it("paces new paper capital during the opening phase", async () => {
    const paperApp = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_STARTING_CASH: 10_000,
        TRADING_SEED_PORTFOLIO: false,
        MAX_ORDER_NOTIONAL: 6_000,
        MAX_POSITION_WEIGHT: 1,
        PAPER_AUTO_EXECUTION_ENABLED: true,
        PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: true,
      }),
      startMarket: false,
      clock: () => new Date("2026-07-17T09:35:00+08:00"),
    });
    await useGrowthPaperProfile(paperApp);

    try {
      const response = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });

      expect(response.json().run).toMatchObject({
        phase: "opening",
        phaseMaxInvestedRatio: 0.45,
        submittedOrders: [],
      });
      expect(response.json().run.skippedOperations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "paper-buy-plan",
          reason: expect.stringContaining("开盘观察仓位节奏限制"),
        }),
      ]));
    } finally {
      await paperApp.close();
    }
  });

  it("allows the same bounded paper plan after morning confirmation", async () => {
    const paperApp = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_STARTING_CASH: 10_000,
        TRADING_SEED_PORTFOLIO: false,
        MAX_ORDER_NOTIONAL: 6_000,
        MAX_POSITION_WEIGHT: 1,
        PAPER_AUTO_EXECUTION_ENABLED: true,
        PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: true,
      }),
      startMarket: false,
      clock: () => new Date("2026-07-17T10:30:00+08:00"),
    });
    await useGrowthPaperProfile(paperApp);

    try {
      const response = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });

      expect(response.json().run).toMatchObject({
        phase: "morning-confirmation",
        phaseMaxInvestedRatio: 0.6,
      });
      expect(response.json().run.submittedOrders).toHaveLength(1);
    } finally {
      await paperApp.close();
    }
  });

  it("sends a deduplicated WxPusher reminder for an actionable local paper plan", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 1000,
      msg: "processed",
      success: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const paperApp = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_STARTING_CASH: 10_000,
        TRADING_SEED_PORTFOLIO: false,
        MAX_ORDER_NOTIONAL: 6_000,
        MAX_POSITION_WEIGHT: 1,
        PAPER_AUTO_EXECUTION_ENABLED: true,
        PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: false,
        PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN: 1,
        PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: 2,
        WXPUSHER_ENABLED: true,
        WXPUSHER_SPT: "SPT_testToken123",
      }),
      startMarket: false,
      clock: () => new Date("2026-07-17T10:30:00+08:00"),
    });
    await useGrowthPaperProfile(paperApp);

    try {
      const firstRun = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });
      const secondRun = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });
      const orders = await paperApp.inject({
        method: "GET",
        url: "/api/orders",
      });
      const audit = await paperApp.inject({
        method: "GET",
        url: "/api/audit?limit=50",
      });

      expect(firstRun.json().run.submittedOrders).toHaveLength(1);
      expect(secondRun.statusCode).toBe(200);
      expect(secondRun.json().run.submittedOrders).toHaveLength(0);
      expect(orders.json()).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(audit.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "wxpusher.paper-plan.sent" }),
      ]));
      expect(audit.body).not.toContain("SPT_testToken123");
    } finally {
      await paperApp.close();
      vi.unstubAllGlobals();
    }
  });

  it("keeps local paper execution running when WxPusher rejects a reminder", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 1001,
      msg: "rejected",
      success: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const paperApp = await buildTradingApp({
      config: createTestConfig({
        MARKET_MODE: "paper",
        TRADING_STARTING_CASH: 10_000,
        TRADING_SEED_PORTFOLIO: false,
        MAX_ORDER_NOTIONAL: 6_000,
        MAX_POSITION_WEIGHT: 1,
        PAPER_AUTO_EXECUTION_ENABLED: true,
        PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: false,
        PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN: 1,
        PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: 2,
        WXPUSHER_ENABLED: true,
        WXPUSHER_SPT: "SPT_testToken123",
      }),
      startMarket: false,
      clock: () => new Date("2026-07-17T10:30:00+08:00"),
    });
    await useGrowthPaperProfile(paperApp);

    try {
      const run = await paperApp.inject({
        method: "POST",
        url: "/api/trading/auto-paper-execution/run",
      });
      const audit = await paperApp.inject({
        method: "GET",
        url: "/api/audit?limit=50",
      });

      expect(run.json().run.submittedOrders).toHaveLength(1);
      expect(run.json().run.submittedOrders[0].status).toBe("filled");
      expect(audit.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "wxpusher.paper-plan.failed",
          data: expect.objectContaining({ reason: "provider-request-failed" }),
        }),
      ]));
      expect(audit.body).not.toContain("SPT_testToken123");
    } finally {
      await paperApp.close();
      vi.unstubAllGlobals();
    }
  });

  it("returns a SuperMind signal package without credential handling", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/supermind/signal-package",
    });

    const payloadText = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      bridge: {
        provider: "supermind",
        mode: "signal-file-only",
        execution: "manual-upload-or-review",
        liveTradingEnabled: false,
      },
      sourcePlan: {
        operationCount: expect.any(Number),
      },
    });
    expect(response.json().csv).toContain("signal_id,trading_date,symbol");
    expect(response.json().supermindTemplate).toContain("handle_bar");
    expect(response.json().guardrails.join("")).toContain("Do not paste passwords");
    expect(payloadText).not.toContain("AUTH_PASSWORD");
    expect(payloadText).not.toContain("Cookie");
  });
});
