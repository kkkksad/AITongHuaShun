import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTradingApp } from "./app";
import { createTestConfig } from "./test/testConfig";

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
    });
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
});
