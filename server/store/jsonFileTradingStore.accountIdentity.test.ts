import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

const directories: string[] = [];
const now = () => new Date("2026-11-09T02:00:00.000Z");
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "kairos-account-binding-"));
  directories.push(directory);
  const store = new JsonFileTradingStore(directory, 20_000, false, { now });
  store.setPaused(true);
  store.setStrategyProfile("growth");
  store.createOrder({ symbol: "000001", side: "buy", type: "limit",
    quantity: 100, limitPrice: 10 }, 11);
  const file = join(directory, "paper-trading-state.json");
  return { directory, file, read: () => JSON.parse(readFileSync(file, "utf8")) };
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory)).toMatch(/^kairos-account-binding-/);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("single A-share ledger account binding", () => {
  it.each([
    ["a futures account", "PAPER-FUT-CN-01"],
    ["another stock account", "PAPER-CN-02"],
    ["different casing", "paper-cn-01"],
    ["leading whitespace", " PAPER-CN-01"],
    ["an empty identifier", ""],
    ["null", null],
    ["a number", 1],
    ["an object", { accountId: "PAPER-CN-01" }],
    ["a missing identifier", undefined],
  ])("rejects %s before the legacy upgrade can rewrite its identity", (_label, accountId) => {
    const { directory, file, read } = setup();
    const state = read();
    state.accountId = accountId;
    delete state.accountEpoch;
    state.auditEvents[0].timestamp = "2000-01-01T00:00:00.000Z";
    writeFileSync(file, JSON.stringify(state));
    const bytes = readFileSync(file);
    const names = readdirSync(directory).sort();
    expect(() => new JsonFileTradingStore(directory, 99_999, false, { now }))
      .toThrow("Persisted Paper account does not match this A-share store.");
    expect(readFileSync(file)).toEqual(bytes);
    expect(readdirSync(directory).sort()).toEqual(names);
  });

  it("keeps the correct account, economics, controls and pending orders across restart", () => {
    const { directory, file, read } = setup();
    const before = read();
    const bytes = readFileSync(file);
    const reloaded = new JsonFileTradingStore(directory, 99_999, false, { now });
    expect(read()).toEqual(before);
    expect(readFileSync(file)).toEqual(bytes);
    expect(reloaded.getCash()).toBe(20_000);
    expect(reloaded.getAvailableCash()).toBe(19_000);
    expect(reloaded.isPaused()).toBe(true);
    expect(reloaded.getStrategyProfile()).toBe("growth");
    expect(reloaded.getAccountEpoch()).toBe(before.accountEpoch);
    expect(reloaded.listOrders()[0]).toMatchObject({ id: before.orders[0].id, status: "pending" });
  });
});
