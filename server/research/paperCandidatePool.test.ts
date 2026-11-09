import { describe, expect, it } from "vitest";
import type { PaperTradingOperation } from "./paperTradingPlan";
import { buildPaperCandidatePool } from "./paperCandidatePool";
import { buildPaperTradingPlan } from "./paperTradingPlan";
import { createTradingSystem } from "../system";
import { createTestConfig } from "../test/testConfig";
import { buildDailyCandidates } from "./dailyCandidates";
import { buildDailyQualityStocks } from "./dailyQualityStocks";
import { buildUnavailableStrategyLeaderboard } from "./strategyLeaderboard";

function operation(symbol: string, action: PaperTradingOperation["action"], reason = "逐股实际原因"): PaperTradingOperation {
  return { symbol, name: symbol, action, reason, timestamp: "2026-11-10T02:00:00Z",
    strategy: "fixture", quantity: 0, price: 10, estimatedNotional: 0, ruleChecks: [] };
}
const scan = (symbol: string, action: "watch" | "focus" | "avoid" = "watch") => ({
  symbol, name: `股票${symbol}`, action, reasons: ["扫描器原始理由"], riskFlags: [],
});

describe("read-only Paper candidate pool", () => {
  it("attaches the merged evidence to an actual plan without changing its order inputs or account", () => {
    const config = createTestConfig({ TRADING_SEED_PORTFOLIO: false });
    const system = createTradingSystem(config, () => new Date("2026-11-10T02:00:00Z"));
    const snapshot = system.market.getSnapshot();
    const account = system.broker.getAccount(snapshot);
    const input = {
      snapshot, provider: system.marketDataProvider, account, positions: [],
      candidates: buildDailyCandidates(snapshot, system.marketDataProvider, 40),
      qualityStocks: buildDailyQualityStocks(snapshot, system.marketDataProvider, 60),
      leaderboard: buildUnavailableStrategyLeaderboard(snapshot, system.marketDataProvider),
      initialCapital: config.TRADING_STARTING_CASH, lotSize: system.limits.lotSize,
      maxPositionWeight: system.limits.maxPositionWeight, maxSingleOrderNotional: system.limits.maxOrderNotional,
      commissionRate: config.COMMISSION_RATE, minimumCommission: config.MIN_COMMISSION, cashReserveRatio: 0,
    };
    const before = structuredClone(input);
    const plan = buildPaperTradingPlan(input);
    expect(input).toEqual(before);
    expect(system.broker.getAccount()).toEqual(account);
    expect(system.broker.getOrders()).toHaveLength(0);
    const expected = new Set([...input.candidates.candidates, ...input.qualityStocks.stocks].map((row) => row.symbol));
    expect(new Set(plan.candidatePool!.rows.map((row) => row.symbol))).toEqual(expected);
    for (const operation of plan.operations.filter((row) => /^\d{6}$/.test(row.symbol))) {
      expect(plan.candidatePool!.rows).toContainEqual(expect.objectContaining({ symbol: operation.symbol, reason: operation.reason, reasonSource: "symbol-plan" }));
    }
  });
  it("merges both scanners, positions and plan-only symbols once with exact tier counts", () => {
    const result = buildPaperCandidatePool({
      candidates: [scan("600001"), scan("600002")], qualityStocks: [scan("600002", "focus"), scan("600003", "avoid")],
      positions: [{ symbol: "600004", name: "持仓甲" }, { symbol: "600005", name: "持仓乙" }],
      operations: [operation("600001", "paper-buy-plan"), operation("600002", "blocked"), operation("600005", "paper-sell-plan")],
    });
    expect(result.total).toBe(5);
    expect(result.rows.map((row) => row.symbol)).toEqual(["600005", "600004", "600001", "600002", "600003"]);
    expect(result.counts).toEqual({ observation: 1, "pending-confirmation": 1, executable: 1, holding: 1, "holding-exit": 1 });
    expect(result.rows.find((row) => row.symbol === "600002")).toMatchObject({ reason: "逐股实际原因", reasonSource: "symbol-plan" });
  });

  it("shows global restrictions only for candidates actually considered by this plan", () => {
    const result = buildPaperCandidatePool({
      candidates: [scan("600001", "focus"), scan("600002", "focus"), scan("600003")], qualityStocks: [], positions: [],
      consideredSymbols: ["600001"], operations: [operation("CASH", "observe", "当前市场状态禁止新增仓位")],
    });
    expect(result.rows.find((row) => row.symbol === "600001")).toMatchObject({ tier: "pending-confirmation", reasonSource: "global-plan", reason: "当前市场状态禁止新增仓位" });
    expect(result.rows.find((row) => row.symbol === "600002")).toMatchObject({ tier: "observation", reasonSource: "unassessed" });
    expect(result.rows.find((row) => row.symbol === "600003")).toMatchObject({ tier: "observation", reasonSource: "scanner" });
    expect(result.rows.every((row) => row.symbol !== "CASH")).toBe(true);
  });

  it("does not invent a strategy match when an actionable scanner has no individual plan evidence", () => {
    const result = buildPaperCandidatePool({ candidates: [scan("600001", "focus")], qualityStocks: [], positions: [], operations: [] });
    expect(result.rows[0]).toMatchObject({ tier: "observation", reasonSource: "unassessed" });
    expect(result.rows[0].reason).toContain("未生成逐股计划");
    expect(result.rows[0].reason).not.toContain("已命中");
  });

  it("keeps held stocks in their own tier even when another scan or blocked plan suggests buying", () => {
    const result = buildPaperCandidatePool({ candidates: [scan("600001", "focus")], qualityStocks: [], positions: [{ symbol: "600001", name: "持仓" }], operations: [operation("600001", "blocked", "T+1尚未可卖")] });
    expect(result.rows[0]).toMatchObject({ tier: "holding", reason: "T+1尚未可卖", reasonSource: "symbol-plan" });
  });

  it("retains scanner risk evidence and excludes invalid pseudo-symbols", () => {
    const result = buildPaperCandidatePool({ candidates: [{ ...scan("600001", "avoid"), riskFlags: ["流动性不足"] }, scan("CASH"), scan("invalid")], qualityStocks: [], positions: [], operations: [operation("SYSTEM", "blocked")] });
    expect(result.total).toBe(1);
    expect(result.rows[0].reason).toContain("流动性不足");
    expect(result.rows[0].reasonSource).toBe("scanner");
  });

  it("counts the full deduplicated pool while bounding rows and prioritizing position evidence", () => {
    const candidates = Array.from({ length: 125 }, (_, i) => scan(String(600000 + i)));
    const result = buildPaperCandidatePool({ candidates, qualityStocks: [], positions: [{ symbol: "600124", name: "末位持仓" }], operations: [] });
    expect(result.total).toBe(125);
    expect(result.rows).toHaveLength(120);
    expect(result.omitted).toBe(5);
    expect(result.rows[0].symbol).toBe("600124");
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(125);
  });

  it("preserves all input objects and exposes no order quantity or inferred execution permission", () => {
    const value = { candidates: [scan("600001", "focus")], qualityStocks: [], positions: [], operations: [operation("600001", "paper-buy-plan")] };
    const before = structuredClone(value);
    const result = buildPaperCandidatePool(value);
    expect(value).toEqual(before);
    expect(result.rows[0]).not.toHaveProperty("quantity");
    expect(result.rows[0].nextCheck).toContain("提交前");
  });
});
