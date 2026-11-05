import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildTradingApp } from "./app";
import { hashPassword } from "./auth";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";

describe("应用监控的安全路由与实例隔离", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function createApp(options: Parameters<typeof buildTradingApp>[0] = {
    config: createTestConfig({ API_DOCS_ENABLED: false, RATE_LIMIT_MAX: 1_000 }),
    startMarket: false,
  }) {
    const app = await buildTradingApp(options);
    apps.push(app);
    return app;
  }

  async function metrics(app: FastifyInstance, cookie?: string) {
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      ...(cookie ? { headers: { cookie } } : {}),
    });
    expect(response.statusCode).toBe(200);
    return response.body;
  }

  it("不同未知路径和查询聚合到固定标签，不挤占业务遥测或保存原始值", async () => {
    const app = await createApp();
    await app.inject({ method: "GET", url: "/api/account" });
    for (let index = 0; index < 70; index++) {
      const response = await app.inject({
        method: "GET",
        url: `${index % 2 ? "/api" : ""}/fake_raw_path_marker_${index}?fake_query_marker=${index}`,
      });
      expect(response.statusCode).toBe(404);
    }

    const text = await metrics(app);
    expect(text).not.toContain("fake_raw_path_marker");
    expect(text).not.toContain("fake_query_marker");
    const unmatched = text.split("\n").filter((line) =>
      line.startsWith("http_requests_total{") && line.includes('status="404"'),
    );
    expect(unmatched).toEqual([
      'http_requests_total{method="GET",route="/__unmatched__",status="404"} 70',
    ]);
    const performance = (await app.inject({ method: "GET", url: "/api/system/performance" })).json();
    expect(performance.routes).toMatchObject([{ method: "GET", route: "/api/account", requestCount: 1 }]);
    expect(performance.totals.requests).toBe(1);
    expect(JSON.stringify(performance)).not.toMatch(/fake_raw_path_marker|fake_query_marker/);
  });

  it("未认证未知请求仍受保护，401标签不保存查询或路径值", async () => {
    const password = "fake-metrics-test-password";
    const app = await createApp({
      config: createTestConfig({
        API_DOCS_ENABLED: false,
        AUTH_ENABLED: true,
        AUTH_USERNAME: "fake-metrics-user",
        AUTH_PASSWORD_HASH: await hashPassword(password),
      }),
      startMarket: false,
    });
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/fake_anonymous_path_marker?fake_query_marker=hidden",
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const login = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { username: "fake-metrics-user", password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const text = await metrics(app, cookie);

    expect(text).toContain('http_requests_total{method="GET",route="/__unmatched__",status="401"} 1');
    expect(text).not.toMatch(/fake_anonymous_path_marker|fake_query_marker|fake-metrics-user|fake-metrics-test-password/);
    const performance = (await app.inject({
      method: "GET", url: "/api/system/performance", headers: { cookie },
    })).json();
    expect(performance.routes).toEqual([]);
  });

  it("已注册参数路由继续使用模板并去除查询值", async () => {
    const app = await createApp();
    for (const id of ["fake_order_marker_A", "fake_order_marker_B"]) {
      const response = await app.inject({
        method: "DELETE", url: `/api/orders/${id}?fake_query_marker=hidden`,
      });
      expect(response.statusCode).toBe(400);
    }
    const text = await metrics(app);
    expect(text).toContain('http_requests_total{method="DELETE",route="/api/orders/:orderId",status="400"} 2');
    expect(text).not.toMatch(/fake_order_marker|fake_query_marker/);
    const performance = (await app.inject({ method: "GET", url: "/api/system/performance" })).json();
    expect(performance.routes).toMatchObject([{ method: "DELETE", route: "/api/orders/:orderId", requestCount: 2 }]);
    expect(performance.totals.failures).toBe(0);
  });

  it("并存应用以及关闭后重建的应用不继承别的HTTP计数", async () => {
    const first = await createApp();
    const second = await createApp();
    await first.inject({ method: "GET", url: "/api/account" });

    expect(await metrics(first)).toContain('route="/api/account"');
    expect(await metrics(second)).not.toContain('route="/api/account"');
    await first.close();
    apps.splice(apps.indexOf(first), 1);
    const third = await createApp();
    expect(await metrics(third)).not.toContain('route="/api/account"');
    const performance = (await second.inject({ method: "GET", url: "/api/system/performance" })).json();
    expect(performance.totals.requests).toBe(0);
  });

  it("订单、撤单、账户持仓事件与风险指标都写入所属应用", async () => {
    const configA = createTestConfig({
      API_DOCS_ENABLED: false, TRADING_SEED_PORTFOLIO: false,
      TRADING_STARTING_CASH: 1_000_000, MAX_ORDER_NOTIONAL: 1_000_000,
      MAX_POSITION_WEIGHT: 1,
    });
    const configB = { ...configA, TRADING_STARTING_CASH: 2_000_000 };
    const systemA = createTradingSystem(configA);
    const first = await createApp({ config: configA, system: systemA, startMarket: false });
    const second = await createApp({ config: configB, startMarket: false });
    const filled = await first.inject({
      method: "POST", url: "/api/orders",
      payload: { symbol: "600519", side: "buy", type: "market", quantity: 100 },
    });
    expect(filled.json().order.status).toBe("filled");
    const pending = await first.inject({
      method: "POST", url: "/api/orders",
      payload: { symbol: "600519", side: "buy", type: "limit", quantity: 100, limitPrice: 1 },
    });
    expect(pending.json().order.status).toBe("pending");
    const cancelled = await first.inject({ method: "DELETE", url: `/api/orders/${pending.json().order.id}` });
    expect(cancelled.statusCode).toBe(200);
    systemA.risk.setInitialEquity(1_000_000);
    systemA.risk.recordTradeResult(-100_000, 900_000);

    const own = await metrics(first);
    const other = await metrics(second);
    expect(own).toContain('orders_total{side="buy",status="filled"} 1');
    expect(own).toContain('orders_total{side="buy",status="pending"} 1');
    expect(own).toContain("order_cancellations_total 1");
    expect(own).toContain("account_positions_count 1");
    expect(own).toContain("risk_circuit_breaker 1");
    expect(other).not.toContain('orders_total{');
    expect(other).not.toContain("order_cancellations_total 1");
    expect(other).not.toContain("account_positions_count 1");
    expect(other).toContain("account_equity 2000000\n");
    expect(other).toContain("account_cash 2000000\n");
    expect(other).toContain("risk_circuit_breaker 0");
  });

  it("WebSocket连接和关闭只改变所属应用的连接数", async () => {
    const first = await createApp();
    const second = await createApp();
    await Promise.all([first.ready(), second.ready()]);
    const firstSocket = await first.injectWS("/ws");
    const secondSocket = await second.injectWS("/ws");
    try {
      expect(await metrics(first)).toContain("ws_connections 1\n");
      expect(await metrics(second)).toContain("ws_connections 1\n");
      const serverSocket = first.websocketServer.clients.values().next().value!;
      const firstClosed = once(serverSocket, "close");
      serverSocket.terminate();
      await firstClosed;
      expect(await metrics(first)).toContain("ws_connections 0\n");
      expect(await metrics(second)).toContain("ws_connections 1\n");
    } finally {
      firstSocket.terminate();
      secondSocket.terminate();
    }
  });
});
