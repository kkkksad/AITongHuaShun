import type { FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { buildTradingApp } from "./app";
import { hashPassword } from "./auth";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";
import * as paperPlans from "./research/paperTradingPlanService";
import { PaperExecutionContextChangedError } from "./trading/paperExecutionContext";

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.restoreAllMocks(); });

it("returns an authenticated no-store conflict for an invalidated plan and leaves orders untouched", async () => {
  const config = createTestConfig({ AUTH_ENABLED: true, AUTH_USERNAME: "plan-reader",
    AUTH_PASSWORD_HASH: await hashPassword("fixture-plan-reader-password") });
  const clock = () => new Date("2026-11-09T22:00:00.000Z");
  const system = createTradingSystem(config, clock);
  const before = system.broker.getAccount();
  const app = await buildTradingApp({ config, system, clock, startMarket: false }); apps.push(app);
  const plan = vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockRejectedValue(new PaperExecutionContextChangedError());
  const url = "/api/research/paper-trading-plan";
  expect((await app.inject(url)).statusCode).toBe(401); expect(plan).not.toHaveBeenCalled();
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username: "plan-reader", password: "fixture-plan-reader-password" } });
  const response = await app.inject({ url, headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] } });
  expect(response.statusCode).toBe(409);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.json()).toEqual({ error: "INVALID_REQUEST", message: new PaperExecutionContextChangedError().message });
  expect(system.broker.getOrders()).toEqual([]);
  expect(system.broker.getAccount()).toEqual(before);
});
