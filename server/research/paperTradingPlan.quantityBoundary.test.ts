import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boundedPlan(cash: number) {
  const time = "2026-11-13T02:00:00.000Z";
  const input = {
    snapshot: { mode: "paper", sequence: 1, marketTime: time,
      quotes: [{ symbol: "600010", name: "安全数量样本", tradable: true, price: 10, previousClose: 9.9,
        changePercent: 1.01, volume: 30000000, amount: 300000000, turnover: 2, amplitude: 2.5,
        open: 9.9, high: 10.1, low: 9.8, updatedAt: time }] },
    provider: "mock", account: { accountId: "PAPER-NUMERIC-FIXTURE", mode: "paper", cash, equity: cash,
      marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, dailyPnl: 0, dailyPnlPercent: 0,
      riskUtilization: 0, paused: false, updatedAt: time }, positions: [], leaderboard: { entries: [] },
    candidates: { candidates: [] }, qualityStocks: { stocks: [{ symbol: "600010", name: "安全数量样本",
      price: 10, score: 96, action: "focus", reasons: ["固定安全数量边界"] }] },
    initialCapital: cash, lotSize: 100, maxPositionWeight: 0.25, maxSingleOrderNotional: cash,
    commissionRate: 0.0003, minimumCommission: 5, slippageBps: 0, cashReserveRatio: 0, strategyProfile: "growth",
  };
  const code = `const {buildPaperTradingPlan}=require(${JSON.stringify(resolve("server/research/paperTradingPlan.ts"))});`
    + `const p=buildPaperTradingPlan(${JSON.stringify(input)});console.log(JSON.stringify({`
    + `buys:p.operations.filter(x=>x.action==='paper-buy-plan').map(x=>({quantity:x.quantity,execution:x.estimatedExecution})),`
    + `cashReserveRatio:p.capitalPlan.cashReserveRatio}));`;
  return spawnSync(process.execPath, ["--import=tsx", "-e", code], { timeout: 5000, encoding: "utf8", windowsHide: true });
}

describe("Paper whole-lot search has a safe integer boundary", () => {
  it.each([1e20, 1e308])("returns bounded no-buy evidence instead of blocking on finite cash %s", cash => {
    const child = boundedPlan(cash);
    expect(child.error?.message).toBeUndefined();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ buys: [], cashReserveRatio: 0 });
  }, 7000);

  it.each([
    { cash: 20000, quantity: 400, notional: 4000, commission: 5 },
    { cash: 1e10, quantity: 249981200, notional: 2499812000, commission: 749943.6 },
  ])("retains safe executable quantity $quantity for cash $cash", ({ cash, quantity, notional, commission }) => {
    const child = boundedPlan(cash);
    expect(child.error?.message).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ cashReserveRatio: 0,
      buys: [{ quantity, execution: { fillPrice: 10, notional, commission, cashRequired: notional + commission } }] });
  }, 7000);
});
