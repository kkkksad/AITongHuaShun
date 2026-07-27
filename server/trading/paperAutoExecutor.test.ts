import { describe, expect, it } from "vitest";
import {
  SequentialTaskScheduler,
  paperAutoExecutionAuditSignature,
  paperNonExecutableReason,
  resolveNotificationSourceStatus,
  isPaperOperationBlockedByPhaseBudget,
  shouldPersistPaperAutoExecutionRun,
  shouldRunScheduledPaperAutoExecution,
  type PaperAutoExecutionRun,
} from "./paperAutoExecutor";

function run(overrides: Partial<PaperAutoExecutionRun> = {}): PaperAutoExecutionRun {
  return {
    id: "paper-auto-2026-07-17-0001",
    trigger: "timer",
    startedAt: "2026-07-17T01:40:00.000Z",
    finishedAt: "2026-07-17T01:40:01.000Z",
    tradingDate: "2026-07-17",
    session: "open",
    phase: "opening",
    phaseMaxInvestedRatio: 0.35,
    planQuality: "watch-only",
    submittedOrders: [],
    skippedOperations: [{
      symbol: "CASH",
      action: "observe",
      reason: "operation is not an executable paper auto action",
    }],
    guardrails: [],
    ...overrides,
  };
}

describe("shouldRunScheduledPaperAutoExecution", () => {
  it("schedules the next timer only after the current async task completes", async () => {
    const callbacks: Array<() => void> = [];
    let resolveCurrent: () => void = () => undefined;
    let taskCalls = 0;
    const scheduler = new SequentialTaskScheduler({
      intervalMs: 60_000,
      task: () => {
        taskCalls += 1;
        return new Promise<void>((resolve) => {
          resolveCurrent = resolve;
        });
      },
      timers: {
        setTimeout(callback) {
          callbacks.push(callback);
          return callback;
        },
        clearTimeout(handle) {
          const index = callbacks.indexOf(handle as () => void);
          if (index >= 0) callbacks.splice(index, 1);
        },
      },
    });

    scheduler.start();
    await Promise.resolve();
    expect(taskCalls).toBe(1);
    expect(callbacks).toHaveLength(0);

    resolveCurrent();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.();
    await Promise.resolve();
    expect(taskCalls).toBe(2);
    expect(callbacks).toHaveLength(0);

    scheduler.stop();
    resolveCurrent();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks).toHaveLength(0);
  });

  it("keeps hold and observe reasons readable in automatic-run audit", () => {
    expect(paperNonExecutableReason({
      timestamp: "2026-07-21T07:00:00.000Z",
      symbol: "601398",
      name: "工商银行",
      action: "hold",
      strategy: "趋势健康持仓",
      quantity: 0,
      price: 7.56,
      estimatedNotional: 0,
      reason: "真实历史形态仍处于健康趋势，保持原仓位。",
      ruleChecks: ["paper-only"],
    })).toBe("正常观望：真实历史形态仍处于健康趋势，保持原仓位。");
  });

  it("does not disable sector pulse tracking for auxiliary news degradation", () => {
    expect(resolveNotificationSourceStatus({
      marketRegime: "live-read-only",
      auxiliaryResearch: "degraded",
    })).toBe("live-read-only");
    expect(resolveNotificationSourceStatus({
      marketRegime: "degraded",
      auxiliaryResearch: "live-read-only",
    })).toBe("degraded");
  });

  it.each([
    ["pre-market", "2026-07-16T09:00:00+08:00"],
    ["lunch break", "2026-07-16T12:00:00+08:00"],
    ["after hours", "2026-07-16T16:00:00+08:00"],
    ["weekend", "2026-07-18T10:00:00+08:00"],
  ])("skips %s timer runs when trade-window-only is enabled", (_label, value) => {
    expect(
      shouldRunScheduledPaperAutoExecution(new Date(value), true),
    ).toBe(false);
  });

  it("runs the timer during the A-share session", () => {
    expect(
      shouldRunScheduledPaperAutoExecution(
        new Date("2026-07-16T10:00:00+08:00"),
        true,
      ),
    ).toBe(true);
  });

  it("allows scheduled runs in all sessions when the restriction is disabled", () => {
    expect(
      shouldRunScheduledPaperAutoExecution(
        new Date("2026-07-16T16:00:00+08:00"),
        false,
      ),
    ).toBe(true);
  });

  it("coalesces unchanged timer audits until the heartbeat interval", () => {
    const previous = run();
    const current = run({
      id: "paper-auto-2026-07-17-0002",
      startedAt: "2026-07-17T01:41:00.000Z",
      finishedAt: "2026-07-17T01:41:01.000Z",
    });

    expect(shouldPersistPaperAutoExecutionRun({
      run: current,
      previousSignature: paperAutoExecutionAuditSignature(previous),
      previousPersistedAt: Date.parse(previous.finishedAt),
    })).toBe(false);
    expect(shouldPersistPaperAutoExecutionRun({
      run: { ...current, finishedAt: "2026-07-17T01:55:01.000Z" },
      previousSignature: paperAutoExecutionAuditSignature(previous),
      previousPersistedAt: Date.parse(previous.finishedAt),
    })).toBe(true);
  });

  it("persists changed, submitted, manual, and startup runs immediately", () => {
    const previous = run();
    const previousSignature = paperAutoExecutionAuditSignature(previous);
    const previousPersistedAt = Date.parse(previous.finishedAt);
    const base = { previousSignature, previousPersistedAt };

    expect(shouldPersistPaperAutoExecutionRun({
      ...base,
      run: run({ planQuality: "actionable" }),
    })).toBe(true);
    expect(shouldPersistPaperAutoExecutionRun({
      ...base,
      run: run({
        submittedOrders: [{
          symbol: "600010",
          side: "sell",
          quantity: 100,
          clientOrderId: "paper-order",
          status: "filled",
          orderId: "order-1",
          strategy: "市场状态减仓",
          reason: "risk-off",
          ruleChecks: ["paper-only"],
          estimatedNotional: 215,
        }],
      }),
    })).toBe(true);
    expect(shouldPersistPaperAutoExecutionRun({
      ...base,
      run: run({ trigger: "manual" }),
    })).toBe(true);
    expect(shouldPersistPaperAutoExecutionRun({
      ...base,
      run: run({ trigger: "startup" }),
    })).toBe(true);
  });

  it("treats a market-route transition as a material audit change", () => {
    const defensive = run({
      researchContext: {
        regime: "risk-off",
        observedRegime: "risk-off",
        routingStability: "direct",
        previousConfirmedRegime: null,
        previousConfirmedAt: null,
        sourceStatus: "live-read-only",
        allowNewPositions: false,
        candidatePoolSize: 12,
        affordableCandidateCount: 0,
      },
    });
    const recovery = run({
      researchContext: {
        ...defensive.researchContext!,
        regime: "risk-off-recovery",
      },
    });

    expect(paperAutoExecutionAuditSignature(defensive)).not.toBe(
      paperAutoExecutionAuditSignature(recovery),
    );
  });

  it("reserves exhausted phase capacity except for hard-stop reductions", () => {
    const ordinaryOperation = {
      timestamp: "2026-07-17T01:35:00.000Z",
      symbol: "600010",
      name: "包钢股份",
      action: "paper-sell-plan" as const,
      strategy: "市场状态减仓",
      quantity: 100,
      price: 2.15,
      estimatedNotional: 215,
      reason: "risk-off",
      ruleChecks: ["paper-only"],
    };

    expect(isPaperOperationBlockedByPhaseBudget(ordinaryOperation, 0)).toBe(true);
    expect(isPaperOperationBlockedByPhaseBudget({
      ...ordinaryOperation,
      strategy: "回撤控制",
    }, 0)).toBe(false);
  });
});
