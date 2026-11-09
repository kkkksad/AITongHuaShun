import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTradingStore } from "./inMemoryTradingStore";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("kairos-execution-revision-")) {
      throw new Error("Unexpected execution revision fixture directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(backend: "memory" | "json") {
  const directory = mkdtempSync(join(tmpdir(), "kairos-execution-revision-")); directories.push(directory);
  const store = backend === "json" ? new JsonFileTradingStore(directory, 20_000, false)
    : new InMemoryTradingStore(20_000, false);
  return { store, directory };
}

describe.each(["memory", "json"] as const)("%s execution control revision", backend => {
  it("records actual control transitions including ABA, with same-value calls unchanged", () => {
    const { store } = fixture(backend);
    let revision = store.getExecutionRevision();
    store.setPaused(false); store.setStrategyProfile("balanced"); store.setExecutionStrategy("auto");
    expect(store.getExecutionRevision()).toBe(revision);
    store.setPaused(true); expect(store.getExecutionRevision()).toBe(++revision);
    store.setPaused(false); expect(store.getExecutionRevision()).toBe(++revision);
    store.setStrategyProfile("growth"); expect(store.getExecutionRevision()).toBe(++revision);
    store.setStrategyProfile("balanced"); expect(store.getExecutionRevision()).toBe(++revision);
    store.setExecutionStrategy("rsi"); expect(store.getExecutionRevision()).toBe(++revision);
    store.setExecutionStrategy("auto"); expect(store.getExecutionRevision()).toBe(++revision);
  });

  it("invalidates a same-money reset and keeps an invalid reset from changing context", () => {
    const { store } = fixture(backend);
    const revision = store.getExecutionRevision();
    store.resetAccount({ startingCash: 20_000, strategyProfile: "balanced", executionStrategy: "auto" });
    expect(store.getExecutionRevision()).toBe(revision + 1);
    expect(() => store.resetAccount({ startingCash: -1, strategyProfile: "growth" })).toThrow();
    expect(store.getExecutionRevision()).toBe(revision + 1);
    expect(store.getCash()).toBe(20_000);
  });

  it("does not cancel a run because of its own fill or audit", () => {
    const { store } = fixture(backend);
    const revision = store.getExecutionRevision();
    const order = store.createOrder({ symbol: "600001", side: "buy", type: "market", quantity: 100 }, 10);
    expect(store.fillOrder(order, "fixture", 10, 5).status).toBe("filled");
    store.appendAudit("system", "fixture.control", "fixture event");
    expect(store.getExecutionRevision()).toBe(revision);
    expect(store.getCash()).toBe(18_995);
  });
});

it("keeps the control revision process-local without changing the JSON schema or account epoch", () => {
  const { store, directory } = fixture("json");
  const epoch = store.getAccountEpoch();
  store.setPaused(true); store.setPaused(false);
  const disk = JSON.parse(readFileSync(join(directory, "paper-trading-state.json"), "utf8"));
  expect(disk).not.toHaveProperty("executionRevision");
  expect(disk.accountEpoch).toBe(epoch);
  const restored = new JsonFileTradingStore(directory, 20_000, false);
  expect(restored.getExecutionRevision()).toBe(0);
  expect(restored.getAccountEpoch()).toBe(epoch);
  expect(restored.getCash()).toBe(20_000);
});
