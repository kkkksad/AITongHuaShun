import { describe, expect, it } from "vitest";
import type { PaperTradingOperation } from "../research/paperTradingPlan";
import {
  buildPaperActivityFunnel,
  classifyPaperActivityBlocker,
  withPaperActivityExecutionCounts,
} from "./paperActivityFunnel";

function operation(
  action: PaperTradingOperation["action"],
  ruleChecks: string[],
): PaperTradingOperation {
  return {
    timestamp: "2026-09-21T03:00:00.000Z",
    symbol: "600000",
    name: "测试标的",
    action,
    strategy: "测试策略",
    quantity: action === "paper-buy-plan" ? 100 : 0,
    price: 10,
    estimatedNotional: action === "paper-buy-plan" ? 1000 : 0,
    reason: "测试操作",
    ruleChecks,
  };
}

describe("paper activity funnel", () => {
  it("maps raw rule text to bounded blocker codes", () => {
    expect(classifyPaperActivityBlocker("entry-persistence: blocked (history-not-covered)"))
      .toBe("history");
    expect(classifyPaperActivityBlocker("round-trip-fee-ratio: blocked"))
      .toBe("fees");
    expect(classifyPaperActivityBlocker("phase budget reached"))
      .toBe("phase");
    expect(classifyPaperActivityBlocker("unrecognized explanation"))
      .toBe("other");
  });

  it("counts candidates and operations without inventing execution results", () => {
    const funnel = buildPaperActivityFunnel({
      candidatePoolSize: 4,
      affordableCandidateCount: 3,
      historyCoveredCandidateCount: 2,
      strategyQualifiedCandidateCount: 1,
      operations: [
        operation("paper-buy-plan", ["strategy-route: pass (momentum)"]),
        operation("blocked", ["cash-check: blocked"]),
      ],
    });

    expect(funnel).toMatchObject({
      observedCandidates: 4,
      affordableCandidates: 3,
      historyCoveredCandidates: 2,
      strategyQualifiedCandidates: 1,
      plannedOrders: 1,
      plannedBuyOrders: 1,
      plannedSellOrders: 0,
      submittedOrders: 0,
      filledOrders: 0,
      blockedCandidates: 1,
      blockerCounts: expect.objectContaining({ cash: 1 }),
    });
  });

  it("updates only submitted and filled counts after execution", () => {
    const planFunnel = buildPaperActivityFunnel({
      candidatePoolSize: 1,
      affordableCandidateCount: 1,
      historyCoveredCandidateCount: 1,
      strategyQualifiedCandidateCount: 1,
      operations: [operation("paper-buy-plan", ["strategy-route: pass (momentum)"])],
    });

    expect(withPaperActivityExecutionCounts(planFunnel, 1, 1)).toMatchObject({
      plannedOrders: 1,
      submittedOrders: 1,
      filledOrders: 1,
      observedCandidates: 1,
    });
  });
});
