import { describe, expect, it } from "vitest";
import type { AccountSnapshot, AuditEvent, MarketSnapshot, OrderRecord } from "../../shared/trading";
import { buildDailyMarketReview } from "./dailyMarketReview";

const now = new Date("2026-11-11T08:00:00.000Z");
const account: AccountSnapshot = {
  accountId: "PAPER-CN-01", mode: "paper", cash: 13_992, equity: 19_831,
  marketValue: 5_839, unrealizedPnl: -64, realizedPnl: -105,
  dailyPnl: -169, dailyPnlPercent: -0.00845, riskUtilization: 0.3,
  paused: false, updatedAt: "2026-11-11T07:00:00.000Z",
};
const snapshot: MarketSnapshot = {
  mode: "paper", sequence: 1, marketTime: "2026-11-11T07:00:00.000Z", quotes: [],
};
const funnel = {
  scope: "ranked-top-12", scannerCandidateCount: 59, consideredCandidateCount: 12,
  existingPositionCount: 1, newSymbolCount: 11, eligibleNewSymbolCount: 1,
  individuallySizedNewSymbolCount: 0, plannedBuyCount: 0, allowNewPositions: true,
};
const run = (data: Record<string, unknown> = {}): AuditEvent => ({
  id: "recorded-run", category: "system", action: "paper-auto-execution.run",
  message: "recorded", timestamp: "2026-11-11T06:50:00.000Z",
  data: {
    tradingDate: "2026-11-11", session: "open", regime: "range-high-volatility",
    planQuality: "blocked", sourceStatus: "live-read-only",
    strategyCoverage: { matchedCandidateCount: 3, newPositionFunnel: funnel },
    skippedReasons: [{ symbol: "601766", action: "blocked", reason: "单股金额不足一手" }],
    ...data,
  },
});
const review = (auditEvents = [run()], orders: OrderRecord[] = [], cash = account.cash) =>
  buildDailyMarketReview({
    snapshot, provider: "akshare", account: { ...account, cash }, positions: [],
    orders, auditEvents, now,
  });

describe("daily entry evidence", () => {
  it("reports an evaluated blocked plan and retains qualified-but-unsized evidence", () => {
    const result = review().entryReview;
    expect(result).toMatchObject({ status: "plan-blocked", planQuality: "blocked", cashWasConstraint: false });
    expect(result.summary).toContain("最新有效盘中计划已评估");
    expect(result.reasons.join(" ")).toContain("策略资格 1 个");
    expect(result.reasons.join(" ")).toContain("初始预算下独立可成整手 0 个");
    expect(result.reasons.join(" ")).toContain("单股金额不足一手");
    expect(result.reasons.join(" ")).not.toContain("没有通过逐股策略资格");
  });

  it.each([
    [{ eligibleNewSymbolCount: 0 }, "没有通过逐股策略资格"],
    [{ individuallySizedNewSymbolCount: 1 }, "最终没有形成买单"],
    [{ individuallySizedNewSymbolCount: 1, plannedBuyCount: 1 }, "不代表实际提交或成交"],
    [{ allowNewPositions: false }, "全局新增许可关闭"],
    [{ existingPositionCount: 12, newSymbolCount: 0, eligibleNewSymbolCount: 0 }, "候选池没有新标的"],
  ])("distinguishes recorded funnel stages: %j", (changes, text) => {
    const result = review([run({ strategyCoverage: { newPositionFunnel: { ...funnel, ...changes } } })]);
    expect(result.entryReview.status).toBe("plan-blocked");
    expect(result.entryReview.reasons.join(" ")).toContain(text);
    expect(result.entryReview.cashWasConstraint).toBe(false);
  });

  it.each([
    undefined, null, {}, { ...funnel, scope: "all-market" },
    { ...funnel, eligibleNewSymbolCount: -1 }, { ...funnel, eligibleNewSymbolCount: 12 },
    { ...funnel, individuallySizedNewSymbolCount: 2 },
    { ...funnel, newSymbolCount: 10 }, { ...funnel, scannerCandidateCount: 11 },
    { ...funnel, consideredCandidateCount: 13, existingPositionCount: 2 },
    { ...funnel, plannedBuyCount: 0.5 }, { ...funnel, allowNewPositions: "true" },
  ])("keeps invalid or missing funnel detail unknown: %j", value => {
    const result = review([run({ strategyCoverage: { newPositionFunnel: value } })]).entryReview;
    expect(result.status).toBe("plan-blocked");
    expect(result.reasons.join(" ")).toContain("单股金额不足一手");
    expect(result.reasons.join(" ")).not.toContain("策略资格 1 个");
    expect(result.reasons.join(" ")).toContain("漏斗细节缺失或无效");
  });

  it("does not borrow an older funnel or a future run when the latest blocked record lacks it", () => {
    const latest = run({ strategyCoverage: null, skippedReasons: [] });
    latest.id = "latest";
    latest.timestamp = "2026-11-11T06:59:00.000Z";
    const future = { ...run(), id: "future", timestamp: "2026-11-11T09:00:00.000Z" };
    const result = review([run(), latest, future]).entryReview;
    expect(result.status).toBe("plan-blocked");
    expect(result.reasons.join(" ")).not.toContain("策略资格 1 个");
    expect(result.reasons.join(" ")).toContain("漏斗细节缺失或无效");
  });

  it("uses the latest effective intraday run rather than a post-market not-run", () => {
    const post = run({ session: "post-market", planQuality: "not-run", strategyCoverage: null });
    post.id = "post";
    post.timestamp = "2026-11-11T07:20:00.000Z";
    expect(review([run(), post]).entryReview.status).toBe("plan-blocked");
  });

  it("uses only fixed funnel descriptions and keeps watch-only compatibility", () => {
    const result = review([run({ planQuality: "watch-only", strategyCoverage: {
      newPositionFunnel: { ...funnel, token: "PRIVATE_UNKNOWN" }, token: "PRIVATE_UNKNOWN",
    } })]).entryReview;
    expect(result.status).toBe("no-qualified-candidate");
    expect(result.reasons.join(" ")).toContain("策略资格 1 个");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_UNKNOWN");
  });

  it.each([1, 13_992])("does not infer cash adequacy from a risk-off balance of %s", cash => {
    const result = review([run({ regime: "risk-off" })], [], cash).entryReview;
    expect(result).toMatchObject({ status: "risk-blocked", cashWasConstraint: false });
    expect(JSON.stringify(result)).not.toContain("不是资金不足");
    expect(result.reasons.join(" ")).toContain("不推断一手可负担性");
  });

  it("retains explicit cash rejection and actual fill precedence", () => {
    const order: OrderRecord = {
      id: "buy", symbol: "601766", side: "buy", type: "market", quantity: 100,
      status: "rejected", requestedPrice: 6.41, filledQuantity: 0, notional: 0,
      commission: 0, rejectionReason: "可用资金不足",
      createdAt: "2026-11-11T02:00:00.000Z", updatedAt: "2026-11-11T02:00:00.000Z",
    };
    expect(review([run()], [order]).entryReview).toMatchObject({ status: "cash-constrained", cashWasConstraint: true });
    expect(review([run()], [{ ...order, status: "filled", filledQuantity: 100,
      filledPrice: 6.41, notional: 641, commission: 5, rejectionReason: undefined }]).entryReview.status).toBe("entered");
    expect(review([run({ sourceStatus: "degraded" })]).entryReview.status).toBe("data-unavailable");
  });
});
