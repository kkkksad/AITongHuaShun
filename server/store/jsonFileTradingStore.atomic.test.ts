import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockMarket } from "../market/mockMarket";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const directories: string[] = [];
const mutations = ["create", "reject", "cancel", "fill", "pause", "profile", "strategy", "reset", "audit"] as const;
type Mutation = typeof mutations[number];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-json-atomic-")); directories.push(directory);
  let time = new Date("2026-11-02T02:00:00.000Z");
  const now = () => time;
  const store = new JsonFileTradingStore(directory, 20_000, false, { now });
  const snapshot = new MockMarket("paper", 1000, now).getSnapshot();
  return { directory, store, snapshot,
    file: path.join(directory, "paper-trading-state.json"),
    nextDay() { time = new Date(time.getTime() + 86_400_000); },
    reload() { return new JsonFileTradingStore(directory, 20_000, false, { now }); } };
}

function prepare(kind: Mutation, f: ReturnType<typeof fixture>): () => unknown {
  const { store } = f;
  if (kind === "create") return () => store.createOrder({ symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 10 }, 11);
  if (["reject", "cancel", "fill"].includes(kind)) {
    const order = store.createOrder({ symbol: "601318", side: "buy", type: "limit", quantity: 100, limitPrice: 10 }, 11);
    if (kind === "reject") return () => store.rejectOrder(order, "fixture rejection", "FIXTURE_REJECT");
    if (kind === "cancel") return () => store.cancelOrder(order);
    return () => store.fillOrder(order, "fixture", 10, 5);
  }
  if (kind === "pause") return () => store.setPaused(true);
  if (kind === "profile") return () => store.setStrategyProfile("growth");
  if (kind === "strategy") return () => store.setExecutionStrategy("rsi");
  if (kind === "reset") return () => store.resetAccount({ startingCash: 30_000, strategyProfile: "growth" });
  return () => store.appendAudit("system", "fixture.event", "fixture event");
}

function observable(f: ReturnType<typeof fixture>) {
  return { revision: f.store.getExecutionRevision(), cash: f.store.getCash(), available: f.store.getAvailableCash(), paused: f.store.isPaused(),
    profile: f.store.getStrategyProfile(), strategy: f.store.getExecutionStrategy(),
    positions: f.store.getPositions(f.snapshot), orders: f.store.listOrders(), audit: f.store.listAudit(),
    cycles: f.store.getPaperFillLedger(), checkpoint: f.store.getPaperRiskCheckpoint?.() };
}

afterEach(() => {
  vi.mocked(fs.renameSync).mockClear();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-json-atomic-")) throw new Error("Unexpected fixture directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(mutations)("JSON atomic %s mutation", (kind) => {
  it("commits state and nested audit using one actual replacement", () => {
    const f = fixture(); const mutate = prepare(kind, f); vi.mocked(fs.renameSync).mockClear();
    mutate();
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
  });

  it("restores memory, generation, reservations, counters and disk after a failed replacement", () => {
    const f = fixture(); const mutate = prepare(kind, f);
    const diskBefore = fs.readFileSync(f.file, "utf8"); const memoryBefore = observable(f);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error("fixture rename failure"); });
    expect(mutate).toThrow("fixture rename failure");
    expect(observable(f)).toEqual(memoryBefore);
    expect(fs.readFileSync(f.file, "utf8")).toBe(diskBefore);
    // A later successful change must not promote any rejected in-memory mutation.
    f.store.appendAudit("system", "fixture.after-recovery", "fixture recovery");
    const reloaded = f.reload();
    expect(reloaded.getCash()).toBe(memoryBefore.cash);
    expect(reloaded.getAvailableCash()).toBe(memoryBefore.available);
    expect(reloaded.getPositions(f.snapshot)).toEqual(memoryBefore.positions);
    expect(reloaded.listOrders()).toEqual(memoryBefore.orders);
    const diskAfter = JSON.parse(fs.readFileSync(f.file, "utf8"));
    const before = JSON.parse(diskBefore);
    expect(diskAfter.accountEpoch).toBe(before.accountEpoch);
    expect(diskAfter.startingEquity).toBe(before.startingEquity);
    expect(diskAfter.orderSequence).toBe(before.orderSequence);
    expect(diskAfter.auditSequence).toBe(before.auditSequence + 1);
  });
});

describe("JSON terminal no-ops", () => {
  it("does not rewrite or prune on replay of a terminal fill/rejection", () => {
    const f = fixture(); const order = f.store.createOrder({ symbol: "601318", side: "buy", type: "market", quantity: 100 }, 10);
    const filled = f.store.fillOrder(order, "fixture", 10, 5);
    vi.mocked(fs.renameSync).mockClear();
    f.store.fillOrder(filled, "fixture", 99, 50); f.store.rejectOrder(filled, "fixture", "FIXTURE");
    expect(fs.renameSync).not.toHaveBeenCalled();
  });
});
