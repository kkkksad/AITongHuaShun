import { describe, expect, it, vi } from "vitest";
import type {
  AccountSnapshot,
  PositionSnapshot,
} from "../../shared/trading";
import type { PaperTradingPlan } from "../research/paperTradingPlan";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import type { IntradayExecutionPolicy } from "../trading/intradayExecutionPolicy";
import {
  PaperPlanNotifier,
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
    },
    ...overrides,
  };
}

function createNotifier(input: {
  now?: Date;
  send?: ReturnType<typeof vi.fn>;
  dailyMessageLimit?: number;
  materialCooldownMs?: number;
} = {}) {
  let now = input.now ?? new Date("2026-07-17T09:35:00+08:00");
  const store = new InMemoryTradingStore(10_000, false);
  const sender = { send: input.send ?? vi.fn().mockResolvedValue({ accepted: true }) };
  const notifier = new PaperPlanNotifier({
    enabled: true,
    sender,
    store,
    dailyMessageLimit: input.dailyMessageLimit ?? 8,
    materialCooldownMs: input.materialCooldownMs ?? 20 * 60_000,
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
  it("sends a compact phase briefing with current and target paper positions", async () => {
    const plan = createPlan();
    const { notifier, sender, store } = createNotifier();

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
      messageKind: "phase-briefing",
    });

    const message = sender.send.mock.calls[0][0];
    expect(message.summary).toContain("开盘观察");
    expect(message.content).toContain("当前持仓：600519 Current Holding 100股");
    expect(message.content).toContain("本轮paper动作：买入 000001 Sample Bank 100股");
    expect(message.content).toContain("计划后持仓：");
    expect(message.content).toContain("000001 Sample Bank 100股");
    expect(message.content).toContain("现金5000.00");
    expect(message.content).toContain("仓位50.0%");
    expect(message.content).toContain("KAIROS 低波趋势");
    expect(message.content).toContain("银行+1.2%");
    expect(message.content).toContain("风险：注意板块宽度；新闻源暂时降级");
    expect(message.content.length).toBeLessThan(1_200);
    expect(store.listAudit(20)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "wxpusher.paper-plan.sent",
        data: expect.objectContaining({
          phase: "opening",
          attemptNumber: 1,
          messageKind: "phase-briefing",
        }),
      }),
    ]));
  });

  it("sends the first phase briefing even when there is no imminent paper action", async () => {
    const plan = createPlan("observe");
    const { notifier, sender } = createNotifier();

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "sent",
      messageKind: "phase-briefing",
    });
    expect(sender.send.mock.calls[0][0].content).toContain("本轮paper动作：无，继续观察");
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
      messageKind: "phase-briefing",
    });
    expect(sender.send.mock.calls[0][0].summary).toContain("市场不宜操作");
    expect(sender.send.mock.calls[0][0].content).toContain("市场不宜操作");
    expect(sender.send.mock.calls[0][0].content).toContain("暂停新增 paper 仓位");
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
      status: "duplicate",
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("sends one briefing for the next phase without waiting for cooldown", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
    await notifier.notify(plan, context(plan));
    setNow(new Date("2026-07-17T10:15:00+08:00"));

    await expect(notifier.notify(plan, context(plan, {
      policy: policy({
        phase: "morning-confirmation",
        phaseLabel: "上午确认",
        maxInvestedRatio: 0.7,
      }),
    }))).resolves.toMatchObject({
      status: "sent",
      messageKind: "phase-briefing",
    });
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("cools down same-phase material changes", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
    await notifier.notify(plan, context(plan));
    setNow(new Date("2026-07-17T09:40:00+08:00"));
    const changed = {
      ...plan,
      operations: plan.operations.map((operation) => ({ ...operation, quantity: 200 })),
    };

    await expect(notifier.notify(changed, context(changed))).resolves.toMatchObject({
      status: "cooldown",
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("bypasses cooldown when the read-only research sources degrade", async () => {
    const plan = createPlan();
    const { notifier, sender, setNow } = createNotifier();
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
      messageKind: "material-update",
    });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send.mock.calls[1][0].content).toContain("真实新闻源暂不可用");
  });

  it("counts failed provider requests against the daily attempt budget", async () => {
    const plan = createPlan();
    const failingSend = vi.fn().mockRejectedValue(new Error("secret SPT_testToken123"));
    const { notifier, store } = createNotifier({
      send: failingSend,
      dailyMessageLimit: 1,
    });

    await expect(notifier.notify(plan, context(plan))).resolves.toMatchObject({
      status: "failed",
    });
    await expect(notifier.notify(plan, context(plan))).resolves.toEqual({
      status: "daily-limit",
    });
    const auditText = JSON.stringify(store.listAudit(20));
    expect(auditText).toContain("wxpusher.paper-plan.failed");
    expect(auditText).not.toContain("SPT_testToken123");
  });
});
