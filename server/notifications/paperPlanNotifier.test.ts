import { describe, expect, it, vi } from "vitest";
import type { PaperTradingPlan } from "../research/paperTradingPlan";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { PaperPlanNotifier } from "./paperPlanNotifier";

function createPlan(
  action: PaperTradingPlan["operations"][number]["action"] = "paper-buy-plan",
): PaperTradingPlan {
  return {
    generatedAt: "2026-07-16T01:25:00.000Z",
    tradingDate: "2026-07-16",
    mode: "paper",
    provider: "akshare",
    account: {
      accountId: "paper-account",
      cash: 10_000,
      equity: 10_000,
      marketValue: 0,
    },
    capitalPlan: {
      initialCapital: 10_000,
      maxPositionWeight: 0.5,
      maxSingleOrderNotional: 5_000,
      lotSize: 100,
      cashReserveRatio: 0.1,
      cashReserveAmount: 1_000,
    },
    rules: ["paper only"],
    topStrategy: {
      strategyKey: "defensive-trend",
      strategyName: "Defensive Trend",
      winRate: 0.6,
      totalTrades: 20,
      qualityGate: "research-only",
    },
    adaptiveRouting: null,
    qualitySummary: {
      candidatePoolSize: 1,
      affordableCandidateCount: 1,
      positionConflictCount: 0,
      actionCounts: {
        observe: action === "observe" ? 1 : 0,
        "paper-buy-plan": action === "paper-buy-plan" ? 1 : 0,
        "paper-sell-plan": action === "paper-sell-plan" ? 1 : 0,
        blocked: 0,
        hold: 0,
      },
      blockedReasons: {},
      plannedBuyNotional: action === "paper-buy-plan" ? 1_050 : 0,
      plannedBuyFees: action === "paper-buy-plan" ? 5 : 0,
      plannedCashRequired: action === "paper-buy-plan" ? 1_055 : 0,
      plannedSellNotional: action === "paper-sell-plan" ? 1_050 : 0,
      cashDeploymentPercent: action === "paper-buy-plan" ? 10.5 : 0,
      remainingCashAfterPlan: action === "paper-buy-plan" ? 8_950 : 10_000,
      planQuality: action === "observe" ? "watch-only" : "actionable",
      summary: "deterministic paper plan",
    },
    operations: [{
      timestamp: "2026-07-16T01:25:00.000Z",
      symbol: "000001",
      name: "Sample Bank",
      action,
      strategy: "Defensive Trend",
      quantity: action === "observe" ? 0 : 100,
      price: 10.5,
      estimatedNotional: action === "observe" ? 0 : 1_050,
      reason: "deterministic research signal",
      ruleChecks: ["100-share lot", "paper only"],
    }],
    guardrails: ["No real broker execution"],
  };
}

describe("PaperPlanNotifier", () => {
  it("does not send watch-only plans", async () => {
    const store = new InMemoryTradingStore(10_000, false);
    const sender = { send: vi.fn() };
    const notifier = new PaperPlanNotifier({ enabled: true, sender, store });

    await expect(notifier.notify(createPlan("observe"))).resolves.toEqual({
      status: "not-actionable",
    });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("formats actionable plans as simulation-only reminders", async () => {
    const store = new InMemoryTradingStore(10_000, false);
    const sender = { send: vi.fn().mockResolvedValue({ accepted: true }) };
    const notifier = new PaperPlanNotifier({ enabled: true, sender, store });

    const result = await notifier.notify(createPlan());

    expect(result).toMatchObject({ status: "sent" });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining("2026-07-16"),
      content: expect.stringContaining("模拟交易研究提醒"),
    }));
    const content = sender.send.mock.calls[0][0].content as string;
    expect(content).toContain("000001 Sample Bank");
    expect(content).toContain("100 股");
    expect(content).toContain("不连接真实券商");
    expect(store.listAudit(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "wxpusher.paper-plan.sent",
        data: expect.objectContaining({
          tradingDate: "2026-07-16",
          operationCount: 1,
          symbols: ["000001"],
        }),
      }),
    ]));
  });

  it("does not resend an already delivered plan signature", async () => {
    const store = new InMemoryTradingStore(10_000, false);
    const sender = { send: vi.fn().mockResolvedValue({ accepted: true }) };
    const notifier = new PaperPlanNotifier({ enabled: true, sender, store });
    const plan = createPlan();

    await notifier.notify(plan);
    await expect(notifier.notify(plan)).resolves.toMatchObject({
      status: "duplicate",
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("audits provider failures without credentials and resolves safely", async () => {
    const store = new InMemoryTradingStore(10_000, false);
    const sender = {
      send: vi.fn().mockRejectedValue(new Error("secret SPT_testToken123")),
    };
    const notifier = new PaperPlanNotifier({ enabled: true, sender, store });

    await expect(notifier.notify(createPlan())).resolves.toMatchObject({
      status: "failed",
    });

    const auditText = JSON.stringify(store.listAudit(20));
    expect(auditText).toContain("wxpusher.paper-plan.failed");
    expect(auditText).not.toContain("SPT_testToken123");
  });
});
