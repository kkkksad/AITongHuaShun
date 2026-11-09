import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTradingApp } from "./app";
import { hashPassword } from "./auth";
import { ProcessResourceMonitor } from "./monitoring/processResources";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.restoreAllMocks(); });
describe("process diagnostics HTTP integration", () => {
  it("returns resources through the authenticated no-store performance route only", async () => {
    const config = createTestConfig({ AUTH_ENABLED: true, AUTH_USERNAME: "metrics-reader", AUTH_PASSWORD_HASH: await hashPassword("fixture-metrics-password") });
    const app = await buildTradingApp({ config, startMarket: false }); apps.push(app);
    const sample = vi.spyOn(ProcessResourceMonitor.prototype, "snapshot");
    expect((await app.inject("/api/system/performance")).statusCode).toBe(401); expect(sample).not.toHaveBeenCalled();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "metrics-reader", password: "fixture-metrics-password" } });
    const response = await app.inject({ url: "/api/system/performance", headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] } });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json().runtime.processResources).toMatchObject({ scope: "api-process", interval: null });
    expect(response.json().runtime.processResources.memory.rssBytes).toBeGreaterThan(0);
  });
  it("keeps health reads lightweight and leaves account and risk untouched, then closes the collector", async () => {
    const config = createTestConfig(); const clock = () => new Date("2026-11-09T20:00:00.000Z");
    const system = createTradingSystem(config, clock);
    const app = await buildTradingApp({ config, system, clock, startMarket: false }); apps.push(app);
    const sample = vi.spyOn(ProcessResourceMonitor.prototype, "snapshot");
    const close = vi.spyOn(ProcessResourceMonitor.prototype, "close");
    const before = system.broker.getAccount(); const riskBefore = system.risk.getState();
    await app.inject("/api/health"); expect(sample).not.toHaveBeenCalled();
    await app.inject("/api/system/performance");
    expect(sample).toHaveBeenCalledOnce(); expect(system.broker.getAccount()).toEqual(before); expect(system.risk.getState()).toEqual(riskBefore);
    await app.close(); apps.pop(); expect(close).toHaveBeenCalledOnce();
  });
});
