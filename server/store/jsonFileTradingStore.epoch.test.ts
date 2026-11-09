import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

const directories: string[] = [];
const now = () => new Date("2026-11-09T02:00:00.000Z");
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "kairos-epoch-"));
  directories.push(directory);
  const store = new JsonFileTradingStore(directory, 20_000, false, { now });
  const file = join(directory, "paper-trading-state.json");
  const read = () => JSON.parse(readFileSync(file, "utf8"));
  return { directory, file, read, store };
}
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("persistent Paper account epoch", () => {
  it("persists one UUID across restarts and non-reset changes", () => {
    const { directory, store, read } = setup();
    const epoch = read().accountEpoch;
    expect(epoch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    store.setPaused(true);
    store.setStrategyProfile("growth");
    new JsonFileTradingStore(directory, 30_000, false, { now });
    expect(read().accountEpoch).toBe(epoch);
    expect(read()).toMatchObject({ cash: 20_000, startingEquity: 20_000, paused: true, strategyProfile: "growth" });
  });

  it("distinguishes identical resets even at the same clock timestamp", () => {
    const { store, read } = setup();
    const epochs = [read().accountEpoch];
    for (let index = 0; index < 2; index += 1) {
      store.resetAccount({ startingCash: 20_000, strategyProfile: "balanced" });
      epochs.push(read().accountEpoch);
    }
    expect(new Set(epochs).size).toBe(3);
  });

  it("adds an epoch once to a legacy ledger without changing its economic state", () => {
    const { directory, file, read, store } = setup();
    const order = store.createOrder({ symbol: "000001", side: "buy", type: "limit", quantity: 100, limitPrice: 10 }, 11);
    store.appendAudit("system", "legacy.keep", "legacy evidence");
    const legacy = read();
    delete legacy.accountEpoch;
    writeFileSync(file, JSON.stringify(legacy));
    new JsonFileTradingStore(directory, 99_999, false, { now });
    const migrated = read();
    expect(migrated.accountEpoch).toEqual(expect.any(String));
    expect(migrated.orders[0].id).toBe(order.id);
    const { accountEpoch, ...rest } = migrated;
    expect(rest).toEqual(legacy);
    new JsonFileTradingStore(directory, 99_999, false, { now });
    expect(read().accountEpoch).toBe(accountEpoch);
  });

  it("refuses an invalid explicit epoch before modifying the ledger", () => {
    const { directory, file, read } = setup();
    writeFileSync(file, JSON.stringify({ ...read(), accountEpoch: "" }));
    const before = readFileSync(file, "utf8");
    expect(() => new JsonFileTradingStore(directory, 20_000, false, { now })).toThrow(/epoch/i);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
