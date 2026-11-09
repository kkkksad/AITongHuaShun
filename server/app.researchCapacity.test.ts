import type { FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { buildTradingApp } from "./app";
import { hashPassword } from "./auth";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";
import { ResearchCapacityError } from "./research/researchCapacity";
import * as paperPlans from "./research/paperTradingPlanService";

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.restoreAllMocks(); });

it("returns authenticated no-store 503 for busy research without touching the account", async () => {
  const config = createTestConfig({ AUTH_ENABLED: true, AUTH_USERNAME: "research-reader",
    AUTH_PASSWORD_HASH: await hashPassword("fixture-capacity-password"), TRADING_STARTING_CASH: 20_000, TRADING_SEED_PORTFOLIO: false });
  const clock = () => new Date("2026-11-09T22:00:00.000Z");
  const system = createTradingSystem(config, clock);
  const before = system.broker.getAccount();
  const app = await buildTradingApp({ config, system, clock, startMarket: false }); apps.push(app);
  const create = vi.spyOn(paperPlans, "buildCurrentPaperTradingPlan").mockRejectedValue(new ResearchCapacityError());
  const url = "/api/research/paper-trading-plan";
  expect((await app.inject(url)).statusCode).toBe(401); expect(create).not.toHaveBeenCalled();
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { username: "research-reader", password: "fixture-capacity-password" } });
  const response = await app.inject({ url, headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] } });
  expect(response.statusCode).toBe(503);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.json()).toEqual({ error: "RESEARCH_BUSY", message: new ResearchCapacityError().message });
  expect(system.broker.getOrders()).toEqual([]);
  expect(system.broker.getAccount()).toEqual(before);
});
