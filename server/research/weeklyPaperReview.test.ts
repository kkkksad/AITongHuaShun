import { describe, expect, it } from "vitest";
import type { AccountSnapshot, AuditEvent, OrderRecord } from "../../shared/trading";
import { buildWeeklyPaperReview } from "./weeklyPaperReview";

function order(input: Partial<OrderRecord> & Pick<OrderRecord, "id" | "symbol" | "side" | "createdAt">): OrderRecord {
  const status = input.status ?? "filled";
  const quantity = input.quantity ?? 100;
  const price = input.filledPrice ?? input.requestedPrice ?? 10;
  return {
    id: input.id,
    symbol: input.symbol,
    side: input.side,
    type: "market",
    quantity,
    status,
    requestedPrice: input.requestedPrice ?? price,
    filledPrice: status === "rejected" ? undefined : price,
    filledQuantity: status === "filled" ? input.filledQuantity ?? quantity : 0,
    notional: status === "filled" ? input.notional ?? quantity * price : 0,
    commission: input.commission ?? (status === "filled" ? 5 : 0),
    rejectionReason: input.rejectionReason,
    clientOrderId: input.clientOrderId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

const account: Pick<AccountSnapshot, "equity" | "cash" | "marketValue"> = {
  equity: 80_000,
  cash: 68_000,
  marketValue: 12_000,
};

describe("buildWeeklyPaperReview", () => {
  it("separates weekly capital use from closed-fill win rate and reports blockers", () => {
    const orders = [
      order({
        id: "carry-buy",
        symbol: "600000",
        side: "buy",
        quantity: 100,
        filledPrice: 9,
        createdAt: "2026-08-20T02:00:00.000Z",
        clientOrderId: "kairos-auto-paper:2026-08-20:600000:paper-buy-plan:100",
      }),
      order({
        id: "weekly-buy-win",
        symbol: "600000",
        side: "buy",
        quantity: 1_000,
        filledPrice: 10,
        createdAt: "2026-08-24T02:00:00.000Z",
        clientOrderId: "kairos-auto-paper:2026-08-24:600000:paper-buy-plan:1000",
      }),
      order({
        id: "weekly-buy-loss",
        symbol: "600001",
        side: "buy",
        quantity: 100,
        filledPrice: 20,
        createdAt: "2026-08-26T02:00:00.000Z",
        clientOrderId: "kairos-auto-paper:2026-08-26:600001:paper-buy-plan:100",
      }),
      order({
        id: "weekly-sell-win",
        symbol: "600000",
        side: "sell",
        quantity: 1_000,
        filledPrice: 11,
        createdAt: "2026-08-27T02:00:00.000Z",
        clientOrderId: "kairos-auto-paper:2026-08-27:600000:paper-sell-plan:1000",
      }),
      order({
        id: "weekly-sell-loss",
        symbol: "600001",
        side: "sell",
        quantity: 100,
        filledPrice: 19,
        createdAt: "2026-08-28T02:00:00.000Z",
        clientOrderId: "kairos-auto-paper:2026-08-28:600001:paper-sell-plan:100",
      }),
      order({
        id: "cash-rejected",
        symbol: "600002",
        side: "buy",
        quantity: 100,
        requestedPrice: 30,
        status: "rejected",
        rejectionReason: "现金缓冲不足，未创建订单",
        createdAt: "2026-08-28T03:00:00.000Z",
      }),
    ];
    const audits: AuditEvent[] = [
      {
        id: "decision-carry-buy",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-20T02:00:01.000Z",
        data: {
          orderId: "carry-buy",
          strategyKey: "kairosLowVolTrend",
          strategy: "KAIROS低波趋势",
          status: "filled",
        },
      },
      {
        id: "decision-buy-win",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-24T02:00:01.000Z",
        data: {
          orderId: "weekly-buy-win",
          strategyKey: "kairosLowVolTrend",
          strategy: "KAIROS低波趋势",
          status: "filled",
        },
      },
      {
        id: "decision-sell-win",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-27T02:00:01.000Z",
        data: {
          orderId: "weekly-sell-win",
          strategyKey: "kairosLowVolTrend",
          strategy: "KAIROS低波趋势",
          status: "filled",
        },
      },
      {
        id: "decision-buy-loss",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-26T02:00:01.000Z",
        data: {
          orderId: "weekly-buy-loss",
          strategyKey: "rsi",
          strategy: "RSI区间回归",
          status: "filled",
        },
      },
      {
        id: "decision-sell-loss",
        category: "system",
        action: "paper-auto-execution.decision",
        message: "decision",
        timestamp: "2026-08-28T02:00:01.000Z",
        data: {
          orderId: "weekly-sell-loss",
          strategyKey: "rsi",
          strategy: "RSI区间回归",
          status: "filled",
        },
      },
      {
        id: "run",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run",
        timestamp: "2026-08-28T03:00:01.000Z",
        data: {
          skippedReasons: [{ reason: "阶段自动订单额度已用完" }],
        },
      },
    ];

    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      initialCapital: 100_000,
      account,
      orders,
      auditEvents: audits,
      maxDailyAutoOrders: 10,
    });

    expect(review.period).toMatchObject({
      startDate: "2026-08-24",
      endDate: "2026-08-29",
    });
    expect(review.period.tradingDays).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
    expect(review.sample).toMatchObject({
      orderCount: 5,
      filledOrderCount: 4,
      rejectedOrderCount: 1,
      activeDays: 4,
      daysWithFills: 4,
      planSnapshotDays: 0,
    });
    expect(review.capital).toMatchObject({
      grossBuyNotional: 12_000,
      grossSellNotional: 12_900,
      buyCapitalRatio: 0.12,
      utilization: "low",
      sizingConstraint: "cash-or-reserve",
    });
    expect(review.performance).toMatchObject({
      closedTrades: 3,
      winningTrades: 2,
      losingTrades: 1,
      winRate: 0.6667,
      realizedPnl: 975.5,
      evidence: "closed-fills-only",
    });
    expect(review.strategyBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({
        strategyKey: "kairosLowVolTrend",
        filledOrders: 2,
        closedTrades: 2,
        winningTrades: 2,
        winRate: 1,
      }),
      expect.objectContaining({
        strategyKey: "rsi",
        filledOrders: 2,
        closedTrades: 1,
        winningTrades: 0,
        winRate: 0,
      }),
    ]));
    expect(review.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "cash", count: 1, estimatedNotional: 3_000 }),
      expect.objectContaining({ code: "phase-budget", count: 1 }),
    ]));
    expect(review.diagnosis.findings.join(" ")).toContain("没有计划金额快照");
  });

  it("does not call an incomplete sample a zero-win strategy", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      initialCapital: 100_000,
      account,
      orders: [order({
        id: "open-buy",
        symbol: "600000",
        side: "buy",
        quantity: 100,
        filledPrice: 10,
        createdAt: "2026-08-25T02:00:00.000Z",
      })],
      auditEvents: [],
    });

    expect(review.performance.closedTrades).toBe(0);
    expect(review.performance.winRate).toBeNull();
    expect(review.performance.evidence).toBe("no-closed-trades");
    expect(review.diagnosis.grade).toBe("insufficient-sample");
  });

  it("reviews the previous complete trading week and explains the configured cap", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      period: "previous",
      initialCapital: 100_000,
      maxSingleOrderNotional: 2_500,
      historyRetentionDays: 30,
      account,
      orders: [order({
        id: "previous-week-buy",
        symbol: "600000",
        side: "buy",
        quantity: 300,
        filledPrice: 10,
        createdAt: "2026-08-18T02:00:00.000Z",
      })],
      auditEvents: [],
    });

    expect(review.period).toMatchObject({
      window: "previous",
      startDate: "2026-08-17",
      endDate: "2026-08-21",
    });
    expect(review.capital).toMatchObject({
      maxSingleOrderNotional: 2_500,
      maxOrderCapitalRatio: 0.025,
      sizingConstraint: "configured-cap",
    });
    expect(review.capital.summary).toContain("2,500.00");
    expect(review.capital.summary).toContain("10 万元");
    expect(review.capital.summary).toContain("上周");
    expect(review.performance.summary).toContain("上周");
    expect(review.diagnosis.summary).toContain("上周");
    expect(review.capital.summary).not.toContain("本周");
    expect(review.sample.historyCoverage).toMatchObject({
      retentionDays: 30,
      status: "within-retention",
    });
  });

  it("does not interpret an empty previous week as zero trading after retention pruning", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      period: "previous",
      initialCapital: 100_000,
      historyRetentionDays: 7,
      account,
      orders: [],
      auditEvents: [],
    });

    expect(review.sample.historyCoverage).toMatchObject({
      retentionDays: 7,
      status: "may-be-pruned",
    });
    expect(review.sample.historyCoverage.summary).toContain("可能已被清理");
    expect(review.diagnosis.findings.join(" ")).toContain("不能确认是否真的零交易");
    expect(review.diagnosis.nextActions.join(" ")).toContain("留存");
  });

  it("separates a phase budget blocker from signal quality when the order cap is not binding", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      initialCapital: 100_000,
      maxSingleOrderNotional: 100_000,
      historyRetentionDays: 30,
      account,
      orders: [],
      auditEvents: [{
        id: "phase-budget",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run",
        timestamp: "2026-08-28T03:00:00.000Z",
        data: {
          skippedReasons: [{ reason: "阶段自动订单额度已用完，保留额度给后续确认阶段" }],
        },
      }],
    });

    expect(review.capital.sizingConstraint).toBe("phase-budget");
  });

  it("uses the largest plan snapshot per day and compares it with automatic fills", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      initialCapital: 100_000,
      account,
      orders: [
        order({
          id: "auto-plan-fill",
          symbol: "600000",
          side: "buy",
          quantity: 100,
          filledPrice: 10,
          clientOrderId: "kairos-auto-paper:2026-08-24:600000:paper-buy-plan:100",
          createdAt: "2026-08-24T02:00:00.000Z",
        }),
        order({
          id: "manual-fill",
          symbol: "600001",
          side: "buy",
          quantity: 100,
          filledPrice: 20,
          clientOrderId: "manual:2026-08-24:600001",
          createdAt: "2026-08-24T03:00:00.000Z",
        }),
      ],
      auditEvents: [
        {
          id: "plan-small",
          category: "system",
          action: "paper-auto-execution.run",
          message: "run",
          timestamp: "2026-08-24T02:00:01.000Z",
          data: {
            planSnapshot: {
              operationCount: 1,
              buyPlanCount: 1,
              sellPlanCount: 0,
              buyNotional: 1_000,
              sellNotional: 0,
            },
          },
        },
        {
          id: "plan-large",
          category: "system",
          action: "paper-auto-execution.run",
          message: "run",
          timestamp: "2026-08-24T03:00:01.000Z",
          data: {
            planSnapshot: {
              operationCount: 1,
              buyPlanCount: 1,
              sellPlanCount: 0,
              buyNotional: 2_000,
              sellNotional: 0,
            },
          },
        },
        {
          id: "plan-next-day",
          category: "system",
          action: "paper-auto-execution.run",
          message: "run",
          timestamp: "2026-08-25T03:00:01.000Z",
          data: {
            planSnapshot: {
              operationCount: 1,
              buyPlanCount: 1,
              sellPlanCount: 0,
              buyNotional: 500,
              sellNotional: 0,
            },
          },
        },
      ],
    });

    expect(review.sample.planSnapshotDays).toBe(2);
    expect(review.capital).toMatchObject({
      plannedBuyNotional: 2_500,
      plannedBuyCapitalRatio: 0.025,
      automaticFilledBuyNotional: 1_000,
      planRealizationRatio: 0.4,
      maxDailyPlannedBuyNotional: 2_000,
    });
    expect(review.capital.summary).toContain("日峰值计划买入额最高 2000.00 元");
    expect(review.diagnosis.findings.join(" ")).toContain("计划金额明显高于最终成交");
    expect(review.diagnosis.nextActions.join(" ")).toContain("重复计划");
    expect(review.daily).toEqual(expect.arrayContaining([
      expect.objectContaining({
        date: "2026-08-24",
        plannedBuyNotional: 2_000,
        automaticFilledBuyNotional: 1_000,
        planRealizationRatio: 0.5,
      }),
      expect.objectContaining({
        date: "2026-08-25",
        plannedBuyNotional: 500,
        automaticFilledBuyNotional: 0,
        planRealizationRatio: 0,
      }),
    ]));
  });

  it("diagnoses a generated plan that has no automatic fill", () => {
    const review = buildWeeklyPaperReview({
      now: new Date("2026-08-29T10:00:00+08:00"),
      initialCapital: 100_000,
      account,
      orders: [],
      auditEvents: [{
        id: "plan-without-fill",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run",
        timestamp: "2026-08-28T03:00:01.000Z",
        data: {
          skippedReasons: [{
            symbol: "600000",
            action: "paper-buy-plan",
            reason: "现金缓冲不足",
            strategy: "验证篮子",
            strategyKey: "kairosValidationBasket",
            quantity: 100,
            price: 25,
            estimatedNotional: 2_500,
          }],
          planSnapshot: {
            operationCount: 1,
            buyPlanCount: 1,
            sellPlanCount: 0,
            buyNotional: 2_500,
            sellNotional: 0,
          },
        },
      }],
    });

    expect(review.sample.planSnapshotDays).toBe(1);
    expect(review.capital).toMatchObject({
      plannedBuyNotional: 2_500,
      automaticFilledBuyNotional: 0,
      planRealizationRatio: 0,
    });
    expect(review.diagnosis.findings.join(" ")).toContain("没有自动 Paper 买入成交");
    expect(review.diagnosis.nextActions.join(" ")).toContain("计划未落地");
    expect(review.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "cash",
        estimatedNotional: 2_500,
      }),
    ]));
  });
});
