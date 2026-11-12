import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "./auth";
import { buildTradingApp } from "./app";
import { createTradingSystem } from "./system";
import { createTestConfig } from "./test/testConfig";

const now = () => new Date("2026-11-09T15:00:00Z");
const directories: string[] = [], apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
async function setup(auth = false) {
  const directory = mkdtempSync(join(tmpdir(), "kairos-history-http-")); directories.push(directory);
  const file = join(directory, "current.json");
  const config = createTestConfig({ MARKET_MODE: "paper", TRADING_STARTING_CASH: 20000,
    STORE_BACKEND: "json", DATA_DIR: directory, TRADING_SEED_PORTFOLIO: false,
    PAPER_HISTORY_READ_MODEL_FILE: file, AUTH_ENABLED: auth, AUTH_USERNAME: "archive-reader",
    AUTH_PASSWORD_HASH: auth ? await hashPassword("fixture-archive-password") : "" });
  const system = createTradingSystem(config, now);
  const app = await buildTradingApp({ config, system, clock: now, startMarket: false }); apps.push(app);
  const dates = Array.from({ length: 7 }, (_, index) => `2026-11-0${index + 3}`);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, accountId: "PAPER-CN-01", accountEpoch: system.store.getAccountEpoch(),
    generatedAt: now().toISOString(), firstObservedAt: now().toISOString(), lastObservedAt: now().toISOString(),
    window: { fromDate: dates[0], toDate: dates[6] }, runCount: 0, openSessionRuns: 0, unknownSessionRuns: 0,
    submittedAttempts: 0, submissionEvidenceRuns: 0, blockers: [], issues: [], latestRuns: [],
    days: dates.map((date) => ({ date, runs: 0, openRuns: 0, unknownSessionRuns: 0, submittedAttempts: 0, submissionEvidenceRuns: 0 })) }));
  return { app, system, file, ledger: join(directory, "paper-trading-state.json") };
}

describe("Paper history HTTP boundary", () => {
  it("returns bounded identities only through the authenticated read model without changing the ledger", async () => {
    const { app, file, ledger } = await setup(true);
    const before = readFileSync(ledger, "utf8");
    const value = JSON.parse(readFileSync(file, "utf8"));
    const identity = { scope: "regime-stock-history", asOf: "2026-11-09T14:59:59.000Z",
      selectedSymbols: ["600010", "600011"], returnedSymbols: ["600011"], acceptedSymbols: ["600011"], usableSymbols: [] };
    value.runCount = value.openSessionRuns = value.submissionEvidenceRuns = 1;
    Object.assign(value.days.at(-1), { runs: 1, openRuns: 1, submissionEvidenceRuns: 1 });
    value.latestRuns = [{ occurredAt: now().toISOString(), session: "open", phase: "morning-confirmation",
      regime: null, planQuality: "watch-only", sourceStatus: "degraded", submittedOrders: 0,
      skippedOperations: 0, blockers: {}, issues: [], stockHistoryCoverage: { ...identity, token: "DO_NOT_PUBLISH" } }];
    writeFileSync(file, JSON.stringify(value));
    expect((await app.inject("/api/research/paper-history")).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: {
      username: "archive-reader", password: "fixture-archive-password" } });
    const response = await app.inject({ url: "/api/research/paper-history", headers: {
      cookie: String(login.headers["set-cookie"]).split(";")[0] } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json()).toMatchObject({ state: "ready", data: { runCount: 1,
      latestRuns: [{ stockHistoryCoverage: identity }] } });
    expect(response.body).not.toContain("DO_NOT_PUBLISH");
    expect(response.json().data).not.toHaveProperty("accountEpoch");
    expect(readFileSync(ledger, "utf8")).toBe(before);
  });
  it("protects the archive behind the existing session and sends no-store", async () => {
    const { app, system } = await setup(true);
    const getEpoch = vi.spyOn(system.store, "getAccountEpoch");
    expect((await app.inject("/api/research/paper-history")).statusCode).toBe(401);
    expect(getEpoch).not.toHaveBeenCalled();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "archive-reader", password: "fixture-archive-password" } });
    const response = await app.inject({ url: "/api/research/paper-history", headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json()).toMatchObject({ state: "ready", data: { runCount: 0 } });
    expect(response.json().data).not.toHaveProperty("accountEpoch");
  });
  it("never mutates the ledger or invokes strategy, market polling or order submission on read", async () => {
    const { app, system, ledger } = await setup();
    const before = readFileSync(ledger, "utf8");
    const submit = vi.spyOn(system.broker, "submitOrder"); const start = vi.spyOn(system.market, "start");
    expect((await app.inject("/api/research/paper-history")).json().state).toBe("ready");
    expect(readFileSync(ledger, "utf8")).toBe(before);
    expect(submit).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it("hides the previous account immediately after reset", async () => {
    const { app, system } = await setup();
    system.store.resetAccount({ startingCash: 20000, strategyProfile: "growth" });
    expect((await app.inject("/api/research/paper-history")).json()).toEqual({ state: "waiting-for-account", data: null });
  });
  it("rechecks identity after asynchronous file reading", async () => {
    const { app, system } = await setup(); const epoch = system.store.getAccountEpoch();
    vi.spyOn(system.store, "getAccountEpoch").mockReturnValueOnce(epoch).mockReturnValue("2e64ed4f-b965-4504-9418-a4276eb03df0");
    expect((await app.inject("/api/research/paper-history")).json()).toEqual({ state: "waiting-for-account", data: null });
  });
});
