import { describe, expect, it, vi } from "vitest";
import type {
  AccountSnapshot,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";
import type { PaperTradingPlan } from "../research/paperTradingPlan";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import type { IntradayExecutionPolicy } from "../trading/intradayExecutionPolicy";
import {
  PaperPlanNotifier,
  buildExternalMarketNotificationImpact,
  formatPaperPlanMessage,
  getPaperPlanBriefingSlot,
  summarizePaperOrders,
  type PaperPlanNotificationContext,
} from "./paperPlanNotifier";

describe("paper notification fill dates", () => {
  const order = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
    id: "carry-fill", symbol: "600010", side: "buy", type: "limit", quantity: 100,
    status: "filled", requestedPrice: 10, filledPrice: 10, filledQuantity: 100,
    notional: 1000, commission: 5, createdAt: "2026-07-16T02:00:00.000Z",
    updatedAt: "2026-07-17T02:00:00.000Z", ...overrides,
  });

  it.each([true, false])("counts carried fills on their fill date, explicit=%s", (explicit) => {
    const record = order(explicit ? { filledAt: "2026-07-17T02:00:00.000Z" } : {});
    const result = summarizePaperOrders([record], "2026-07-17");
    expect(result).toMatchObject({ filledOrders: 1, buyNotional: 1000, commission: 5 });
    expect(result.executedOrders.map((item) => item.orderId)).toEqual([record.id]);
    expect(summarizePaperOrders([record], "2026-07-16").filledOrders).toBe(0);
  });

  it("does not assign a next-day fill to its submission date", () => {
    const result = summarizePaperOrders([order({
      createdAt: "2026-07-17T02:00:00.000Z", filledAt: "2026-07-20T02:00:00.000Z",
    })], "2026-07-17");
    expect(result).toMatchObject({ filledOrders: 0, buyNotional: 0, commission: 0 });
    expect(result.executedOrders).toEqual([]);
  });

  it("uses explicit fill time across later metadata updates and Beijing midnight", () => {
    const result = summarizePaperOrders([
      order({ id: "before", filledAt: "2026-07-16T15:59:59.999Z" }),
      order({ id: "after", filledAt: "2026-07-16T16:00:00.000Z", updatedAt: "2026-07-20T02:00:00Z" }),
    ], "2026-07-17");
    expect(result.filledOrders).toBe(1);
    expect(result.executedOrders.map((item) => item.orderId)).toEqual(["after"]);
  });

  it("reports invalid fill-time evidence without assigning it to a day", () => {
    const result = summarizePaperOrders([order({
      createdAt: "2026-07-17T02:00:00.000Z", filledAt: "broken",
    })], "2026-07-17");
    expect(result).toMatchObject({ filledOrders: 0, commission: 0, unresolvedFillTimes: 1 });
    expect(result.executedOrders).toEqual([]);
  });
});

function createPlan(
  action: PaperTradingPlan["operations"][number]["action"] = "paper-buy-plan",
): PaperTradingPlan {
  return {
    generatedAt: "2026-07-17T01:35:00.000Z",
    tradingDate: "2026-07-17",
    mode: "paper",
    provider: "akshare",
    account: {
      accountId: "paper-account",
      cash: 5_000,
      equity: 10_000,
      marketValue: 5_000,
    },
    capitalPlan: {
      initialCapital: 10_000,
      maxPositionWeight: 0.5,
      maxSingleOrderNotional: 2_000,
      lotSize: 100,
      cashReserveRatio: 0.1,
      cashReserveAmount: 1_000,
    },
    strategyProfile: {
      key: "balanced",
      label: "均衡",
      summary: "在现金防守和机会参与之间保持中等节奏。",
      cashReserveFloor: 0.5,
      minDefensiveScore: 62,
      maxNewPositionsPerPlan: 2,
      allowNewPositions: true,
      effectiveCashReserveRatio: 0.5,
      effectiveNewPositionScale: 0.85,
    },
    executionStrategy: {
      key: "auto",
      label: "自动选择（跟随市场）",
      mode: "auto",
      selectedStrategyMatched: false,
      matchedCandidateCount: 0,
    },
    rules: ["paper only"],
    topStrategy: {
      strategyKey: "kairosLowVolTrend",
      strategyName: "KAIROS 低波趋势",
      winRate: 0.6,
      totalTrades: 20,
      qualityGate: "research-only",
    },
    adaptiveRouting: {
      version: "1.4.0",
      generatedAt: "2026-07-17T01:35:00.000Z",
      regime: "trend-up-low-volatility",
      confidence: 0.72,
      positionPosture: "accumulate",
      allowNewPositions: true,
      cashReserveRatio: 0.1,
      newPositionScale: 1,
      eligibleStrategyKeys: ["kairosLowVolTrend"],
      disabledStrategyKeys: ["rsi"],
      strategyPlaybook: {
        primaryStrategyKeys: ["kairosLowVolTrend", "kairosTrendHealth"],
        useWhen: "趋势与上涨宽度同步确认",
        avoidWhen: "宽度转弱时停止新增",
        recheckTriggers: ["上涨宽度低于 50%"],
      },
      capitalPacing: {
        openingMaxInvestedRatio: 0.55,
        morningMaxInvestedRatio: 0.7,
        afternoonMaxInvestedRatio: 0.82,
        closingMaxInvestedRatio: 0.9,
      },
      stability: {
        status: "direct",
        observedRegime: "trend-up-low-volatility",
        previousConfirmedRegime: null,
        previousConfirmedAt: null,
        rationale: "test fixture",
      },
      evidence: ["趋势向上"],
      riskFlags: ["注意板块宽度"],
      metrics: {
        constructiveSectorRatio: 0.7,
        cautiousSectorRatio: 0.1,
        averageReturn20d: 0.08,
        averageReturn60d: 0.16,
        averageMa20Slope5d: 0.02,
        averageVolatility20d: 0.22,
        averageBreadthRatio: 0.65,
        averageCurrentChangePercent: 1.2,
        healthyStockRatio: 0.6,
        deterioratingStockRatio: 0.1,
      },
    },
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
      cashDeploymentPercent: action === "paper-buy-plan" ? 21.1 : 0,
      remainingCashAfterPlan: action === "paper-buy-plan" ? 3_945 : 5_000,
      strategyCoverage: {
        eligibleKeys: ["kairosLowVolTrend"],
        matchedKeys: action === "observe" ? [] : ["kairosLowVolTrend"],
        matchedCandidateCount: action === "observe" ? 0 : 1,
        unmatchedCandidateCount: action === "observe" ? 1 : 0,
        dominantStrategyKey: action === "observe" ? null : "kairosLowVolTrend",
        dominantBlocker: null,
        summary: "test strategy coverage",
      },
      planQuality: action === "observe" ? "watch-only" : "actionable",
      summary: "deterministic paper plan",
    },
    operations: [{
      timestamp: "2026-07-17T01:35:00.000Z",
      symbol: action === "observe" ? "CASH" : "000001",
      name: action === "observe" ? "现金观察" : "Sample Bank",
      action,
      strategy: "KAIROS 低波趋势",
      quantity: action === "observe" ? 0 : 100,
      price: action === "observe" ? 1 : 10.5,
      estimatedNotional: action === "observe" ? 0 : 1_050,
      reason: "deterministic research signal",
      ruleChecks: ["100-share lot", "paper only"],
    }],
    guardrails: ["No real broker execution"],
  };
}

function account(): AccountSnapshot {
  return {
    accountId: "paper-account",
    mode: "paper",
    cash: 5_000,
    equity: 10_000,
    marketValue: 5_000,
    unrealizedPnl: 120,
    realizedPnl: 0,
    dailyPnl: 50,
    dailyPnlPercent: 0.005,
    riskUtilization: 0.5,
    paused: false,
    updatedAt: "2026-07-17T01:35:00.000Z",
  };
}

function positions(): PositionSnapshot[] {
  return [{
    symbol: "600519",
    name: "Current Holding",
    quantity: 100,
    availableQuantity: 100,
    t1LockedQuantity: 0,
    averagePrice: 48.8,
    currentPrice: 50,
    marketValue: 5_000,
    unrealizedPnl: 120,
    realizedPnl: 0,
    weight: 0.5,
  }];
}

function policy(
  overrides: Partial<IntradayExecutionPolicy> = {},
): IntradayExecutionPolicy {
  return {
    phase: "opening",
    phaseLabel: "开盘观察",
    maxInvestedRatio: 0.55,
    source: "adaptive-routing",
    ...overrides,
  };
}

function context(
  plan: PaperTradingPlan,
  overrides: Partial<PaperPlanNotificationContext> = {},
): PaperPlanNotificationContext {
  return {
    account: account(),
    positions: positions(),
    executableOperations: plan.operations.filter((operation) =>
      operation.action === "paper-buy-plan" || operation.action === "paper-sell-plan"
    ),
    executionSummary: {
      filledOrders: 2,
      rejectedOrders: 0,
      pendingOrders: 0,
      cancelledOrders: 0,
      buyNotional: 1_050,
      sellNotional: 500,
      commission: 10,
      executedOrders: [
        {
          orderId: "filled-buy",
          symbol: "000001",
          name: "Sample Bank",
          side: "buy",
          quantity: 100,
          filledPrice: 10.48,
          notional: 1_048,
          commission: 5,
          strategy: "KAIROS 低波趋势",
          reason: "趋势与流动性通过本地 Paper 检查。",
          reasonSource: "decision-audit",
        },
      ],
      unfilledOrders: [],
    },
    policy: policy(),
    marketContext: {
      sourceStatus: "live-read-only",
      tone: "balanced",
      summary: "当前观察池盘面分化。",
      sectors: [
        { name: "银行", direction: "constructive", score: 78, changePercent: 1.2 },
        { name: "建筑", direction: "constructive", score: 72, changePercent: 0.8 },
        { name: "消费", direction: "neutral", score: 58, changePercent: -0.1 },
      ],
      warnings: ["新闻源暂时降级"],
      newsHighlights: [
        { source: "东方财富", title: "政策支持长期资金入市" },
        { source: "证券时报", title: "制造业景气度边际改善" },
      ],
      globalImpact: {
        direction: "neutral",
        summary: "外围市场信号中性，A 股主要参考本地行情。",
        drivers: ["恒生指数+0.8%", "纳斯达克-0.2%"],
      },
    },
    ...overrides,
  };
}

function createNotifier(input: {
  now?: Date;
  send?: ReturnType<typeof vi.fn>;
  dailyMessageLimit?: number;
} = {}) {
  let now = input.now ?? new Date("2026-07-17T09:35:00+08:00");
  const store = new InMemoryTradingStore(10_000, false);
  const sender = { send: input.send ?? vi.fn().mockResolvedValue({ accepted: true }) };
  const notifier = new PaperPlanNotifier({
    enabled: true,
    sender,
    store,
    dailyMessageLimit: input.dailyMessageLimit ?? 10,
    clock: () => now,
  });
  return {
    notifier,
    sender,
    store,
    setNow(value: Date) {
      now = value;
    },
  };
}

describe("PaperPlanNotifier", () => {
  it("compresses external markets into one precise fixed-briefing line", () => {
    const impact = buildExternalMarketNotificationImpact({
      bias: "restrictive",
      evidenceGrade: "historically-observed",
      samples: 126,
      groups: [
        { key: "us-overnight", tone: "negative" },
        { key: "asia", tone: "neutral" },
        { key: "crypto", tone: "positive" },
      ],
      rationale: ["美股隔夜偏弱，亚洲市场中性。"],
    });

    expect(impact.direction).toBe("risk-off");
    expect(impact.summary).toBe(
      "美股隔夜偏弱；亚洲中性；BTC/ETH偏强｜对A股：偏约束（历史观察，样本126）",
    );
    expect(impact.drivers).toEqual(["美股隔夜偏弱，亚洲市场中性。"]);
  });

  it.each([
    ["2026-07-17T09:34:00+08:00", null],
    ["2026-07-17T09:35:00+08:00", 1],
    ["2026-07-17T10:14:59+08:00", 1],
    ["2026-07-17T10:15:00+08:00", 2],
    ["2026-07-17T11:00:00+08:00", 3],
    ["2026-07-17T12:00:00+08:00", null],
    ["2026-07-17T13:30:00+08:00", 4],
    ["2026-07-17T14:15:00+08:00", 5],
    ["2026-07-17T14:50:00+08:00", 6],
    ["2026-07-17T15:00:00+08:00", null],
    ["2026-07-18T09:35:00+08:00", null],
    ["2026-10-01T09:35:00+08:00", null],
  ] as const)("selects the latest due briefing slot at %s", (value, sequence) => {
    expect(getPaperPlanBriefingSlot(new Date(value))?.sequence ?? null).toBe(sequence);
  });

  it("summarizes only the current trading date and prefers the order strategy", () => {
    const order = (
      overrides: Partial<OrderRecord>,
    ): OrderRecord => ({
      id: "order-1",
      symbol: "000001",
      name: "Sample Bank",
      side: "buy",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10,
      filledPrice: 10,
      filledQuantity: 100,
      notional: 1_000,
      commission: 5,
      createdAt: "2026-07-17T01:40:00.000Z",
      updatedAt: "2026-07-17T01:40:00.000Z",
      ...overrides,
    });
    const result = summarizePaperOrders([
      order({ id: "buy", strategy: "订单内固定策略" }),
      order({ id: "sell", side: "sell", notional: 500, commission: 5 }),
      order({
        id: "rejected",
        status: "rejected",
        notional: 0,
        commission: 0,
        rejectionReason: "可用资金不足",
      }),
      order({ id: "pending", status: "accepted", notional: 0, commission: 0 }),
      order({
        id: "previous-day",
        createdAt: "2026-07-16T01:40:00.000Z",
        updatedAt: "2026-07-16T01:40:00.000Z",
      }),
    ], "2026-07-17", [{
      id: "audit-buy",
      category: "system",
      action: "paper-auto-execution.decision",
      message: "decision",
      timestamp: "2026-07-17T01:40:00.000Z",
      data: {
        orderId: "buy",
        strategy: "审计策略不应覆盖订单策略",
        reason: "趋势确认后执行。",
      },
    }]);

    expect(result).toEqual({
      filledOrders: 2,
      rejectedOrders: 1,
      pendingOrders: 1,
      cancelledOrders: 0,
      buyNotional: 1_000,
      sellNotional: 500,
      commission: 10,
      executedOrders: [
        expect.objectContaining({
          orderId: "buy",
          name: "Sample Bank",
          side: "buy",
          strategy: "订单内固定策略",
          reason: "趋势确认后执行。",
          reasonSource: "decision-audit",
        }),
        expect.objectContaining({
          orderId: "sell",
          side: "sell",
          strategy: "历史订单未记录策略",
          reason: "历史订单未保存决策理由",
          reasonSource: "historical-fallback",
        }),
      ],
      unfilledOrders: [
        expect.objectContaining({
          orderId: "rejected",
          status: "rejected",
          reason: "可用资金不足",
          reasonSource: "order-record",
        }),
        expect.objectContaining({
          orderId: "pending",
          status: "accepted",
        }),
      ],
    });
  });

  it("waits before 09:35 instead of sending an early briefing", async () => {
    const plan = createPlan();
    const { notifier, sender } = createNotifier({
      now: new Date("2026-07-17T09:34:00+08:00"),
    });

    await expect(notifier.notify(plan, context(plan))).resolves.toEqual({
      status: "scheduled-wait",
      scheduledAt: "09:35",
    });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("sends once at each fixed checkpoint and deduplicates the same checkpoint", async () => {
    const plan = createPlan();
    const { notifier, sender, store, setNow } = createNotifier();

    for (const scheduledAt of ["09:35", "10:15", "11:00", "13:30", "14:15", "14:50"]) {
      setNow(new Date(`2026-07-17T${scheduledAt}:00+08:00`));
      await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
        status: "sent",
        messageKind: "scheduled-briefing",
      });
    }

    setNow(new Date("2026-07-17T09:41:00+08:00"));
    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "phase-used",
    });

    expect(sender.send).toHaveBeenCalledTimes(6);
    expect(store.listAudit(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "wxpusher.paper-plan.sent",
        data: expect.objectContaining({
          tradingDate: plan.tradingDate,
          scheduledAt: "09:35",
          sequence: 1,
          totalBriefings: 6,
          mode: "paper-research-only",
          liveTradingEnabled: false,
        }),
      }),
    ]));
    expect(store.listAudit(20).filter((event) =>
      event.action === "wxpusher.paper-plan.sent"
    )).toHaveLength(6);
  });

  it("does not reuse the 10:15 briefing later in the same slot window", async () => {
    const plan = createPlan();
    const notifier = createNotifier({
      now: new Date("2026-07-17T10:15:00+08:00"),
    });
    await expect(notifier.notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
    });

    notifier.setNow(new Date("2026-07-17T10:29:00+08:00"));
    await expect(notifier.notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "phase-used",
    });
    expect(notifier.sender.send).toHaveBeenCalledTimes(1);
  });

  it("does not send on a weekend, a legal holiday, at lunch or after the close", async () => {
    const weekendPlan = createPlan();
    const weekend = createNotifier({
      now: new Date("2026-07-18T09:35:00+08:00"),
    });
    await expect(weekend.notifier.notify(weekendPlan, context(weekendPlan))).resolves.toEqual({
      status: "not-actionable",
    });

    const holidayPlan = { ...createPlan(), tradingDate: "2026-10-01" };
    const holiday = createNotifier({
      now: new Date("2026-10-01T09:35:00+08:00"),
    });
    await expect(holiday.notifier.notify(holidayPlan, context(holidayPlan))).resolves.toEqual({
      status: "not-actionable",
    });

    const lunchPlan = createPlan();
    const lunch = createNotifier({
      now: new Date("2026-07-17T12:00:00+08:00"),
    });
    await expect(lunch.notifier.notify(lunchPlan, context(lunchPlan))).resolves.toEqual({
      status: "outside-session",
    });

    const afterClosePlan = createPlan();
    const afterClose = createNotifier({
      now: new Date("2026-07-17T15:00:00+08:00"),
    });
    await expect(afterClose.notifier.notify(
      afterClosePlan,
      context(afterClosePlan),
    )).resolves.toEqual({ status: "outside-session" });
    expect(weekend.sender.send).not.toHaveBeenCalled();
    expect(holiday.sender.send).not.toHaveBeenCalled();
    expect(lunch.sender.send).not.toHaveBeenCalled();
    expect(afterClose.sender.send).not.toHaveBeenCalled();
  });

  it("still sends an honest briefing on risky or degraded days", async () => {
    const plan = createPlan();
    const { notifier, sender, store } = createNotifier();
    const risky = context(plan, {
      marketContext: {
        ...context(plan).marketContext,
        sourceStatus: "degraded",
        tone: "risk-off",
        summary: "行情源超时，风险偏好转弱。",
      },
    });

    await expect(notifier.notify(plan, risky)).resolves.toMatchObject({
      status: "sent",
      messageKind: "scheduled-briefing",
    });
    await expect(notifier.notify(plan, risky)).resolves.toMatchObject({
      status: "phase-used",
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].content).toContain("数据降级");
    expect(sender.send.mock.calls[0][0].content).toContain("观察池盘面处于风险偏高状态");
    expect(store.listAudit(50)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "wxpusher.paper-plan.sent",
        data: expect.objectContaining({
          sourceStatus: "degraded",
          marketTone: "risk-off",
          riskEvents: expect.arrayContaining([
            "market-data-not-live",
            "market-risk-off",
          ]),
        }),
      }),
    ]));
  });

  it("records a failed provider request without retrying or leaking credentials", async () => {
    const plan = createPlan();
    const send = vi.fn().mockRejectedValue(new Error("secret SPT_testToken123"));
    const { notifier, sender, store, setNow } = createNotifier({ send });

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "failed",
      messageKind: "scheduled-briefing",
    });
    setNow(new Date("2026-07-17T09:36:00+08:00"));
    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "phase-used",
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
    const auditText = JSON.stringify(store.listAudit(50));
    expect(auditText).toContain("wxpusher.paper-plan.failed");
    expect(auditText).toContain("provider-request-failed");
    expect(auditText).not.toContain("SPT_testToken123");
  });

  it("builds a concise six-part briefing with actions, sizing and execution evidence", async () => {
    const plan = createPlan();
    plan.executionStrategy = {
      key: "kairosVolumePriceBreakout",
      label: "KAIROS 量价突破确认",
      mode: "manual",
      selectedStrategyMatched: true,
      matchedCandidateCount: 1,
    };
    plan.capitalPlan.sizingDiagnostics = {
      riskOrderCapBeforeScale: 2_000,
      riskOrderCapAfterScale: 1_600,
      positionWeightCapAfterScale: 2_500,
      cashReserveAmount: 1_000,
      plannedCashBudget: 4_000,
      effectiveOrderCap: 1_600,
      minimumFeeEfficientNotional: 500,
      plannedBuyOrderCount: 1,
      plannedBuyNotional: 1_050,
      averagePlannedBuyNotional: 1_050,
      largestPlannedBuyNotional: 1_050,
      limitingConstraint: "strategy-profile-scale",
      summary: "策略档位把 2000 元单笔上限缩放为 1600 元。",
    };
    const { notifier, sender } = createNotifier();

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
    });

    const message = sender.send.mock.calls[0][0];
    expect(message.summary).toBe(
      "KAIROS 简报 1/6｜可操作｜持仓 1 只｜2026-07-17",
    );
    expect(message.content).toContain("第 1/6 次定时简报");
    expect(message.content).toContain("今日结论：可操作");
    expect(message.content).toContain("<h3>当前持仓与盈亏</h3>");
    expect(message.content).toContain("Current Holding");
    expect(message.content).toContain("<h3>账户与累计收益</h3>");
    expect(message.content).toContain("权益 10000.00 元");
    expect(message.content).toContain("自 Paper 重置累计盈亏");
    expect(message.content).toContain("<h3>打算交易什么</h3>");
    expect(message.content).toContain("买入 000001 Sample Bank");
    expect(message.content).toContain("KAIROS 低波趋势");
    expect(message.content).toContain("最强证据");
    expect(message.content).toContain("主要阻塞");
    expect(message.content).toContain("实际单笔上限 1600.00 元");
    expect(message.content).toContain("新增仓位缩放");
    expect(message.content).toContain("计划后约 100 股");
    expect(message.content).toContain("策略与档位：");
    expect(message.content).toContain("<h3>今日成交与拒单</h3>");
    expect(message.content).toContain("成交 2 笔");
    expect(message.content).toContain("手续费 10.00 元");
    expect(message.content).toContain("<h3>市场与风险</h3>");
    expect(message.content).toContain("<h3>边界</h3>");
    expect(message.content).toContain("仅 Paper 模拟研究");
    expect(message.content).toContain("每个真实交易日发送 6 条定时简报");
  });

  it("prefers the precise sizing label and escapes it in notification HTML", () => {
    const plan = createPlan();
    plan.capitalPlan.sizingDiagnostics = {
      profileNewPositionScale: 1,
      riskOrderCapBeforeScale: 2_000,
      riskOrderCapAfterScale: 1_000,
      positionWeightCapAfterScale: 2_500,
      cashReserveAmount: 0,
      plannedCashBudget: 5_000,
      effectiveOrderCap: 1_000,
      minimumFeeEfficientNotional: 1_000,
      plannedBuyOrderCount: 0,
      plannedBuyNotional: 0,
      averagePlannedBuyNotional: 0,
      largestPlannedBuyNotional: 0,
      limitingConstraint: "strategy-profile-scale",
      limitingConstraintLabel: "市场路由缩放 <研究&观察>",
      summary: "市场路由调整额度。",
    };

    const message = formatPaperPlanMessage(plan, context(plan));

    expect(message.content).toContain("市场路由缩放 &lt;研究&amp;观察&gt;");
    expect(message.content).not.toContain("市场路由缩放 <研究&观察>");
    expect(message.content).not.toContain("新增仓位缩放");
  });

  it("labels a plan-sizing blocker without calling it an account cash shortage", () => {
    const plan = createPlan("observe");
    plan.qualitySummary.blockedReasons = { "plan-sizing-constrained": 1 };
    const message = formatPaperPlanMessage(plan, context(plan));

    expect(message.content).toContain("本轮预算、金额上限、整手或费用效率约束（1 次）");
    expect(message.content).not.toContain("plan-sizing-constrained");
  });

  it("does not present unknown fill dates as verified zero trading", () => {
    const plan = createPlan("observe");
    const input = context(plan);
    input.executionSummary = {
      ...input.executionSummary, filledOrders: 0, executedOrders: [],
      unresolvedFillTimes: 2,
    };
    const message = formatPaperPlanMessage(plan, input);
    expect(message.content).toContain("2 笔保留成交记录的时间无法确认");
    expect(message.content).toContain("不能据此确认零成交");
    expect(message.content).not.toContain("<p>今日暂无 Paper 成交。</p>");
  });

  it("sends an observation briefing without inventing trades", async () => {
    const plan = createPlan("observe");
    const { notifier, sender } = createNotifier();

    const current = context(plan);
    await expect(notifier.notify(plan, {
      ...current,
      executionSummary: {
        filledOrders: 0,
        rejectedOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
        buyNotional: 0,
        sellNotional: 0,
        commission: 0,
        executedOrders: [],
        unfilledOrders: [],
      },
    })).resolves.toMatchObject({
      status: "sent",
    });
    const message = sender.send.mock.calls[0][0];
    expect(message.summary).toContain("简报 1/6");
    expect(message.summary).toContain("观察");
    expect(message.content).toContain("今日结论：观察");
    expect(message.content).toContain("本轮没有满足条件的买卖动作");
    expect(message.content).toContain("今日暂无 Paper 成交");
  });

  it("deduplicates order receipts and uses recorded decision reasons", async () => {
    const plan = createPlan();
    const { notifier, sender, store } = createNotifier();
    const order: OrderRecord = {
      id: "order-receipt-1",
      symbol: "000001",
      name: "Sample Bank",
      side: "buy",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10.5,
      filledPrice: 10.5,
      filledQuantity: 100,
      notional: 1_050,
      commission: 5,
      createdAt: "2026-07-17T01:35:30.000Z",
      updatedAt: "2026-07-17T01:35:31.000Z",
      strategy: "KAIROS 量价突破确认",
    };
    store.appendAudit(
      "system",
      "paper-auto-execution.decision",
      "decision",
      {
        orderId: order.id,
        strategy: "KAIROS 量价突破确认",
        reason: "突破与成交量同时确认后执行。",
      },
    );
    const current = context(plan);
    const executionSummary = summarizePaperOrders(
      [order],
      plan.tradingDate,
      store.listAudit(50),
    );

    await expect(notifier.notifyOrderEvents(plan, {
      ...current,
      executionSummary,
    }, [order])).resolves.toMatchObject({
      status: "sent",
      messageKind: "order-event",
    });
    await expect(notifier.notifyOrderEvents(plan, {
      ...current,
      executionSummary,
    }, [order])).resolves.toMatchObject({
      status: "duplicate",
      eventKey: `orders:${order.id}`,
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].content).toContain("策略：KAIROS 量价突破确认");
    expect(sender.send.mock.calls[0][0].content).toContain("突破与成交量同时确认后执行");
  });

  it("reserves all future fixed briefings before spending event capacity", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
    const current = context(plan);
    const order = (id: string): OrderRecord => ({
      id,
      symbol: "000001",
      name: "Sample Bank",
      side: "buy",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10.5,
      filledPrice: 10.5,
      filledQuantity: 100,
      notional: 1_050,
      commission: 5,
      createdAt: "2026-07-17T01:35:30.000Z",
      updatedAt: "2026-07-17T01:35:31.000Z",
    });

    setNow(new Date("2026-07-17T09:35:00+08:00"));
    for (const id of ["event-1", "event-2", "event-3", "event-4"]) {
      await expect(notifier.notifyOrderEvents(plan, current, [order(id)]))
        .resolves.toMatchObject({ status: "sent", messageKind: "order-event" });
    }

    for (const scheduledAt of ["09:35", "10:15", "11:00", "13:30", "14:15", "14:50"]) {
      setNow(new Date(`2026-07-17T${scheduledAt}:00+08:00`));
      await expect(notifier.notify(plan, current)).resolves.toMatchObject({
        status: "sent",
        messageKind: "scheduled-briefing",
      });
    }

    expect(sender.send).toHaveBeenCalledTimes(10);
  });

  it("counts failed provider attempts against the daily cap", async () => {
    const plan = createPlan();
    const send = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const { notifier, sender, setNow } = createNotifier({
      send,
      dailyMessageLimit: 6,
    });

    for (const scheduledAt of ["09:35", "10:15", "11:00", "13:30", "14:15", "14:50"]) {
      setNow(new Date(`2026-07-17T${scheduledAt}:00+08:00`));
      await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
        status: "failed",
        messageKind: "scheduled-briefing",
      });
    }

    const order: OrderRecord = {
      id: "daily-cap-order",
      symbol: "000001",
      name: "Sample Bank",
      side: "buy",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10.5,
      filledPrice: 10.5,
      filledQuantity: 100,
      notional: 1_050,
      commission: 5,
      createdAt: "2026-07-17T06:50:30.000Z",
      updatedAt: "2026-07-17T06:50:31.000Z",
    };
    await expect(notifier.notifyOrderEvents(plan, context(plan), [order]))
      .resolves.toEqual({ status: "daily-limit" });
    expect(sender.send).toHaveBeenCalledTimes(6);
  });

  it("limits event attempts to four even when the provider fails", async () => {
    const plan = createPlan();
    const send = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const { notifier, sender } = createNotifier({ send });
    const current = context(plan);
    const order = (id: string): OrderRecord => ({
      id,
      symbol: "000001",
      name: "Sample Bank",
      side: "buy",
      type: "market",
      quantity: 100,
      status: "filled",
      requestedPrice: 10.5,
      filledPrice: 10.5,
      filledQuantity: 100,
      notional: 1_050,
      commission: 5,
      createdAt: "2026-07-17T01:35:30.000Z",
      updatedAt: "2026-07-17T01:35:31.000Z",
    });

    for (const id of ["failed-1", "failed-2", "failed-3", "failed-4"]) {
      await expect(notifier.notifyOrderEvents(plan, current, [order(id)]))
        .resolves.toMatchObject({ status: "failed", messageKind: "order-event" });
    }
    await expect(notifier.notifyOrderEvents(plan, current, [order("failed-5")]))
      .resolves.toEqual({ status: "event-limit" });
    expect(sender.send).toHaveBeenCalledTimes(4);
  });

  it("detects market moves with a threshold and twenty-minute cooldown", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
    const breadth = (averageChangePercent: number, advancers = 1) => ({
      total: 3,
      advancers,
      decliners: 1,
      flat: 1,
      averageChangePercent,
      advanceDeclineRatio: advancers,
      holdingQuotes: [{ symbol: "600519", name: "Current Holding", changePercent: averageChangePercent }],
    });

    await expect(notifier.observeMarket(plan, context(plan, {
      marketContext: { ...context(plan).marketContext, breadth: breadth(0.1) },
    }))).resolves.toEqual({ status: "no-event" });

    setNow(new Date("2026-07-17T09:40:00+08:00"));
    await expect(notifier.observeMarket(plan, context(plan, {
      marketContext: { ...context(plan).marketContext, breadth: breadth(1.0) },
    }))).resolves.toEqual({ status: "no-event" });

    setNow(new Date("2026-07-17T09:45:00+08:00"));
    await expect(notifier.observeMarket(plan, context(plan, {
      marketContext: { ...context(plan).marketContext, breadth: breadth(2.3, 2) },
    }))).resolves.toMatchObject({
      status: "sent",
      messageKind: "market-anomaly",
    });

    setNow(new Date("2026-07-17T09:50:00+08:00"));
    await expect(notifier.observeMarket(plan, context(plan, {
      marketContext: { ...context(plan).marketContext, breadth: breadth(4.0, 3) },
    }))).resolves.toEqual({ status: "event-limit" });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].summary).toContain("市场异动");
  });

  it("does not backfill missed checkpoints after a restart", async () => {
    const plan = createPlan();
    const { notifier, sender } = createNotifier({
      now: new Date("2026-07-17T14:50:00+08:00"),
    });

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
      messageKind: "scheduled-briefing",
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].summary).toContain("简报 6/6");
    expect(sender.send.mock.calls[0][0].content).toContain("14:50");
  });

  it("escapes operation and unfilled-order text exactly once", async () => {
    const plan = createPlan();
    plan.operations[0] = {
      ...plan.operations[0],
      name: "<script>alert(1)</script>",
      reason: "突破 <b>确认</b>",
    };
    const current = context(plan);
    const { notifier, sender } = createNotifier();

    await expect(notifier.notify(plan, {
      ...current,
      executionSummary: {
        ...current.executionSummary,
        unfilledOrders: [{
          orderId: "rejected-html",
          symbol: "000002",
          name: "<img src=x onerror=alert(1)>",
          side: "buy",
          quantity: 100,
          status: "rejected",
          strategy: "固定策略",
          reason: "资金 <不足>",
          reasonSource: "order-record",
        }],
      },
    })).resolves.toMatchObject({ status: "sent" });

    const content = sender.send.mock.calls[0][0].content;
    expect(content).not.toContain("<script>");
    expect(content).not.toContain("<img src=x");
    expect(content).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(content).toContain("资金 &lt;不足&gt;");
    expect(content).not.toContain("&amp;lt;");
  });
});
