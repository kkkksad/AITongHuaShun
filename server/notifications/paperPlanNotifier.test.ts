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
  formatPaperPlanMessage,
  getPaperPlanBriefingSlot,
  summarizePaperOrders,
  type PaperPlanNotificationContext,
} from "./paperPlanNotifier";

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
    rules: ["paper only"],
    topStrategy: {
      strategyKey: "kairosLowVolTrend",
      strategyName: "KAIROS 低波趋势",
      winRate: 0.6,
      totalTrades: 20,
      qualityGate: "research-only",
    },
    adaptiveRouting: {
      version: "1.1.0",
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
  it.each([
    ["2026-07-17T09:34:00+08:00", "opening", null],
    ["2026-07-17T09:35:00+08:00", "opening", 1],
    ["2026-07-17T10:29:00+08:00", "morning-confirmation", null],
    ["2026-07-17T10:30:00+08:00", "morning-confirmation", 2],
    ["2026-07-17T13:30:00+08:00", "afternoon-confirmation", 3],
    ["2026-07-17T14:50:00+08:00", "closing-risk-review", 4],
  ] as const)("opens the planned briefing slot at %s", (value, phase, sequence) => {
    expect(getPaperPlanBriefingSlot(new Date(value), phase)?.sequence ?? null).toBe(sequence);
  });

  it("summarizes only the current trading date paper orders", () => {
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
      order({ id: "buy" }),
      order({ id: "sell", side: "sell", notional: 500, commission: 5 }),
      order({ id: "rejected", status: "rejected", notional: 0, commission: 0 }),
      order({ id: "pending", status: "accepted", notional: 0, commission: 0 }),
      order({
        id: "previous-day",
        createdAt: "2026-07-16T01:40:00.000Z",
        updatedAt: "2026-07-16T01:40:00.000Z",
      }),
    ], "2026-07-17");

    expect(result).toEqual({
      filledOrders: 2,
      rejectedOrders: 1,
      pendingOrders: 1,
      cancelledOrders: 0,
      buyNotional: 1_000,
      sellNotional: 500,
      commission: 10,
    });
  });

  it("sends a layered HTML briefing with precise actions and isolated data quality", async () => {
    const plan = createPlan();
    const { notifier, sender, store } = createNotifier();

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
      messageKind: "scheduled-briefing",
    });

    const message = sender.send.mock.calls[0][0];
    expect(message.summary).toContain("1/10 固定简报 1/4");
    expect(message.content).toContain("今日第 1/10 条 · 固定简报 1/4");
    expect(message.content).toContain("<h3>一眼结论</h3>");
    expect(message.content).toContain("<h3>本时段动作</h3>");
    expect(message.content).toContain("买入 000001 Sample Bank 100股");
    expect(message.content).toContain("参考价 10.50 元");
    expect(message.content).toContain("预计金额 1050.00 元");
    expect(message.content).toContain("deterministic research signal");
    expect(message.content).toContain("<h3>当前与计划后持仓</h3>");
    expect(message.content).toContain("当前：600519 Current Holding 100股");
    expect(message.content).toContain("计划后：");
    expect(message.content).toContain("000001 Sample Bank 100股");
    expect(message.content).toContain("现金 5000.00 元");
    expect(message.content).toContain("当前仓位 50.0%");
    expect(message.content).toContain("KAIROS 低波趋势");
    expect(message.content).toContain("银行+1.2%");
    expect(message.content).toContain("外围：外围市场信号中性");
    expect(message.content).toContain("东方财富：政策支持长期资金入市");
    expect(message.content).toContain("<h3>今日模拟执行</h3>");
    expect(message.content).toContain("成交 2 笔");
    expect(message.content).toContain("买入 1050.00 元");
    expect(message.content).toContain("<h3>风险与数据</h3>");
    expect(message.content).toContain("策略风险：注意板块宽度");
    expect(message.content).toContain("数据质量：新闻源暂时降级");
    expect(message.content).toContain("下一条：10:30 上午确认");
    expect(message.content.length).toBeLessThan(3_200);
    expect(store.listAudit(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "wxpusher.paper-plan.sent",
        data: expect.objectContaining({
          phase: "opening",
          attemptNumber: 1,
          messageKind: "scheduled-briefing",
          slotSequence: 1,
          scheduledAt: "09:35",
        }),
      }),
    ]));
  });

  it("sends the first phase briefing even when there is no imminent paper action", async () => {
    const plan = createPlan("observe");
    const { notifier, sender } = createNotifier();

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
      messageKind: "scheduled-briefing",
    });
    expect(sender.send.mock.calls[0][0].content).toContain("本阶段无可执行 paper 动作");
  });

  it("labels broad risk-off conditions as unsuitable for operation without requiring an order", async () => {
    const plan = createPlan("observe");
    plan.adaptiveRouting = {
      ...plan.adaptiveRouting!,
      regime: "risk-off",
      positionPosture: "reduce",
      allowNewPositions: false,
      cashReserveRatio: 0.55,
      newPositionScale: 0,
    };
    const { notifier, sender } = createNotifier();
    const riskOffContext = context(plan, {
      marketContext: {
        sourceStatus: "live-read-only",
        sectors: [],
        warnings: [],
        tone: "risk-off",
        summary: "当前观察池盘面偏弱：上涨 20 只、下跌 80 只。",
      } as unknown as PaperPlanNotificationContext["marketContext"],
    });

    await expect(notifier.notify(plan, riskOffContext)).resolves.toMatchObject({
      status: "sent",
      messageKind: "urgent-update",
    });
    expect(sender.send.mock.calls[0][0].summary).toContain("市场不宜操作");
    expect(sender.send.mock.calls[0][0].content).toContain("市场不宜操作");
    expect(sender.send.mock.calls[0][0].content).toContain("暂停新增 paper 仓位");
  });

  it("escapes provider text and removes unusable sectors from core evidence", () => {
    const plan = createPlan();
    const message = formatPaperPlanMessage(plan, context(plan, {
      marketContext: {
        sourceStatus: "degraded",
        tone: "balanced",
        summary: "<script>alert('x')</script> 暂不可用",
        sectors: [
          { name: "暂不可用", direction: "neutral", score: 0, changePercent: 0 },
          { name: "银行<script>", direction: "constructive", score: 78, changePercent: 1.2 },
        ],
        warnings: ["新闻源暂不可用", "新闻源暂不可用", "  "],
      },
    }));

    expect(message.content).not.toContain("<script>");
    expect(message.content).toContain("银行&lt;script&gt;+1.2%");
    expect(message.content).not.toContain("板块：暂不可用");
    expect(message.content.match(/新闻源暂不可用/g)).toHaveLength(1);
    expect(message.content).toContain("数据处于降级状态，本轮不依据缺失项增加风险暴露");
  });

  it("does not treat a reference price change as a material update", async () => {
    const plan = createPlan();
    const { notifier, sender } = createNotifier();
    await notifier.notify(plan, context(plan));
    const repriced = {
      ...plan,
      operations: plan.operations.map((operation) => ({ ...operation, price: 10.8 })),
    };

    await expect(notifier.notify(repriced, context(repriced))).resolves.toMatchObject({
      status: "phase-used",
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("sends one briefing for the next phase without waiting for cooldown", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
    await notifier.notify(plan, context(plan));
    setNow(new Date("2026-07-17T10:30:00+08:00"));

    await expect(notifier.notify(plan, context(plan, {
      policy: policy({
        phase: "morning-confirmation",
        phaseLabel: "上午确认",
        maxInvestedRatio: 0.7,
      }),
    }))).resolves.toMatchObject({
      status: "sent",
      messageKind: "scheduled-briefing",
    });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("waits for the planned time instead of sending at phase start", async () => {
    const plan = createPlan();
    const { notifier, sender } = createNotifier({
      now: new Date("2026-07-17T09:31:00+08:00"),
    });

    await expect(notifier.notify(plan, context(plan))).resolves.toEqual({
      status: "scheduled-wait",
      scheduledAt: "09:35",
    });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("uses the reserve budget once when conditions materially degrade", async () => {
    const plan = createPlan();
    const { notifier, sender, store, setNow } = createNotifier();
    await notifier.notify(plan, context(plan));
    setNow(new Date("2026-07-17T09:40:00+08:00"));

    await expect(notifier.notify(plan, context(plan, {
      marketContext: {
        sourceStatus: "degraded",
        tone: "balanced",
        summary: "当前观察池盘面分化。",
        sectors: [],
        warnings: ["真实新闻源暂不可用"],
      },
    }))).resolves.toMatchObject({
      status: "sent",
      messageKind: "urgent-update",
    });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send.mock.calls[1][0].content).toContain("重要事件快报");
    expect(sender.send.mock.calls[1][0].content).toContain("真实数据源降级");
    expect(store.listAudit(20)[0]?.data?.urgentEvents).toEqual(["data-degraded"]);

    await expect(notifier.notify(plan, context(plan, {
      marketContext: {
        sourceStatus: "degraded",
        tone: "balanced",
        summary: "当前观察池盘面分化。",
        sectors: [],
        warnings: ["真实新闻源暂不可用"],
      },
    }))).resolves.toMatchObject({ status: "phase-used" });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("hard stops at ten attempts even when a larger limit is injected", async () => {
    const plan = createPlan();
    const { notifier, sender, store } = createNotifier({ dailyMessageLimit: 20 });
    for (let index = 0; index < 10; index += 1) {
      store.appendAudit(
        "system",
        "wxpusher.paper-plan.sent",
        "existing provider attempt",
        {
          tradingDate: plan.tradingDate,
          phase: `reserve-${index}`,
          attemptedAt: `2026-07-17T0${index}:00:00.000Z`,
        },
      );
    }

    await expect(notifier.notify(plan, context(plan))).resolves.toEqual({
      status: "daily-limit",
    });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("counts a failed provider request as the phase attempt without retrying", async () => {
    const plan = createPlan();
    const failingSend = vi.fn().mockRejectedValue(new Error("secret SPT_testToken123"));
    const { notifier, store } = createNotifier({
      send: failingSend,
      dailyMessageLimit: 4,
    });

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "failed",
    });
    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({ status: "phase-used" });
    const auditText = JSON.stringify(store.listAudit(20));
    expect(auditText).toContain("wxpusher.paper-plan.failed");
    expect(auditText).not.toContain("SPT_testToken123");
  });

  it("reserves the daily budget for later scheduled phases", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier({ dailyMessageLimit: 2 });
    await notifier.notify(plan, context(plan));
    setNow(new Date("2026-07-17T10:30:00+08:00"));
    await notifier.notify(plan, context(plan, {
      policy: policy({
        phase: "morning-confirmation",
        phaseLabel: "上午确认",
        maxInvestedRatio: 0.7,
      }),
    }));
    setNow(new Date("2026-07-17T13:30:00+08:00"));

    await expect(notifier.notify(plan, context(plan, {
      policy: policy({
        phase: "afternoon-confirmation",
        phaseLabel: "下午确认",
        maxInvestedRatio: 0.82,
      }),
    }))).resolves.toEqual({ status: "daily-limit" });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });
});
