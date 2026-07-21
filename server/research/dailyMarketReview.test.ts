import { describe, expect, it } from "vitest";
import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  PositionSnapshot,
} from "../../shared/trading";
import {
  assessMarketSnapshot,
  buildDailyMarketReview,
} from "./dailyMarketReview";

const snapshot: MarketSnapshot = {
  mode: "paper",
  sequence: 10,
  marketTime: "2026-07-14T07:00:00.000Z",
  quotes: [
    {
      symbol: "600010",
      name: "包钢股份",
      tradable: true,
      price: 2.15,
      previousClose: 2.1,
      changePercent: 2.38,
      volume: 20_000_000,
      updatedAt: "2026-07-14T07:00:00.000Z",
    },
    {
      symbol: "601988",
      name: "中国银行",
      tradable: true,
      price: 5.8,
      previousClose: 5.84,
      changePercent: -0.68,
      volume: 20_000_000,
      updatedAt: "2026-07-14T07:00:00.000Z",
    },
    {
      symbol: "SH000001",
      name: "上证指数",
      tradable: false,
      price: 3_500,
      previousClose: 3_480,
      changePercent: 0.57,
      volume: 0,
      updatedAt: "2026-07-14T07:00:00.000Z",
    },
  ],
};

const account: AccountSnapshot = {
  accountId: "PAPER-CN-01",
  mode: "paper",
  cash: 412,
  equity: 9_900,
  marketValue: 9_488,
  unrealizedPnl: -63,
  realizedPnl: 0,
  dailyPnl: -100,
  dailyPnlPercent: -0.01,
  riskUtilization: 0.96,
  paused: false,
  updatedAt: "2026-07-14T07:00:00.000Z",
};

const positions: PositionSnapshot[] = [{
  symbol: "600010",
  name: "包钢股份",
  quantity: 400,
  availableQuantity: 0,
  t1LockedQuantity: 400,
  averagePrice: 2.12,
  currentPrice: 2.15,
  marketValue: 860,
  unrealizedPnl: 12,
  realizedPnl: 0,
  weight: 0.087,
}];

const orders: OrderRecord[] = [
  {
    id: "filled-order",
    symbol: "600010",
    side: "buy",
    type: "market",
    quantity: 400,
    status: "filled",
    requestedPrice: 2.12,
    filledPrice: 2.12,
    filledQuantity: 400,
    notional: 848,
    commission: 5,
    clientOrderId: "kairos-auto-paper:2026-07-14:600010:paper-buy-plan:400",
    createdAt: "2026-07-14T01:33:06.403Z",
    updatedAt: "2026-07-14T01:33:06.420Z",
  },
  {
    id: "rejected-order",
    symbol: "601988",
    side: "buy",
    type: "market",
    quantity: 100,
    status: "rejected",
    requestedPrice: 5.88,
    filledQuantity: 0,
    notional: 0,
    commission: 0,
    rejectionReason: "可用资金不足",
    clientOrderId: "kairos-auto-paper:2026-07-14:601988:paper-buy-plan:100",
    createdAt: "2026-07-14T01:33:06.445Z",
    updatedAt: "2026-07-14T01:33:06.466Z",
  },
];

const auditEvents: AuditEvent[] = [{
  id: "decision-1",
  category: "system",
  action: "paper-auto-execution.decision",
  message: "paper auto execution decision recorded",
  timestamp: "2026-07-14T01:33:06.420Z",
  data: {
    orderId: "filled-order",
    strategy: "每日优质股评分",
    reason: "流动性充足；波动受控",
    ruleChecks: ["cash-reservation: pass"],
  },
}];

describe("buildDailyMarketReview", () => {
  it("classifies broad current weakness only with a sufficient tradable sample", () => {
    const quote = snapshot.quotes[0];
    const broadWeakSnapshot: MarketSnapshot = {
      ...snapshot,
      quotes: Array.from({ length: 10 }, (_, index) => ({
        ...quote,
        symbol: String(600000 + index),
        changePercent: index < 2 ? 0.2 : -1.5,
      })),
    };
    const tinyWeakSnapshot: MarketSnapshot = {
      ...broadWeakSnapshot,
      quotes: broadWeakSnapshot.quotes.slice(0, 9),
    };

    expect(assessMarketSnapshot(broadWeakSnapshot)).toMatchObject({
      tone: "risk-off",
      breadth: {
        total: 10,
        advancers: 2,
        decliners: 8,
      },
    });
    expect(assessMarketSnapshot(tinyWeakSnapshot).tone).toBe("insufficient-data");
  });

  it("summarizes market breadth, trades, reasons, and strategy issues", () => {
    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account,
      positions,
      orders,
      auditEvents,
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.market.breadth).toMatchObject({
      total: 2,
      advancers: 1,
      decliners: 1,
    });
    expect(report.market.indices[0]).toMatchObject({ symbol: "SH000001" });
    expect(report.trades.items.find((item) => item.orderId === "filled-order")).toMatchObject({
      strategy: "每日优质股评分",
      reason: "流动性充足；波动受控",
      reasonSource: "decision-audit",
    });
    expect(report.trades.items.find((item) => item.orderId === "rejected-order")?.reason)
      .toContain("资金不足");
    expect(report.strategyReview.issues.join(" ")).toContain("资金不足");
    expect(report.strategyReview.issues.join(" ")).toContain("开盘");
    expect(report.entryReview).toMatchObject({
      status: "entered",
      cashWasConstraint: true,
    });
  });

  it("explains that available cash stayed idle because the medium-term route blocked entry", () => {
    const strongSnapshot: MarketSnapshot = {
      ...snapshot,
      quotes: Array.from({ length: 10 }, (_, index) => ({
        ...snapshot.quotes[0],
        symbol: String(600100 + index),
        changePercent: 2.2,
      })),
    };
    const reviewAccount: AccountSnapshot = {
      ...account,
      cash: 5_935,
      equity: 10_262,
      marketValue: 4_327,
    };
    const routeAudits: AuditEvent[] = [
      {
        id: "route-notification",
        category: "system",
        action: "wxpusher.paper-plan.sent",
        message: "briefing accepted",
        timestamp: "2026-07-14T06:50:00.000Z",
        data: {
          tradingDate: "2026-07-14",
          regime: "risk-off",
          sourceStatus: "live-read-only",
        },
      },
      {
        id: "watch-only-run",
        category: "system",
        action: "paper-auto-execution.run",
        message: "run recorded",
        timestamp: "2026-07-14T07:01:00.000Z",
        data: {
          tradingDate: "2026-07-14",
          planQuality: "watch-only",
          skippedReasons: [{
            symbol: "CASH",
            reason: "operation is not an executable paper auto action",
          }],
        },
      },
    ];

    const report = buildDailyMarketReview({
      snapshot: strongSnapshot,
      provider: "akshare",
      account: reviewAccount,
      positions: [],
      orders: [],
      auditEvents: routeAudits,
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.entryReview).toMatchObject({
      status: "risk-blocked",
      marketRegime: "risk-off",
      planQuality: "watch-only",
      cashWasConstraint: false,
    });
    expect(report.entryReview.summary).toContain("不是资金不足");
    expect(report.entryReview.reasons.join(" ")).toContain("单日反弹");
    expect(report.strategyReview.issues.join(" ")).toContain("中期路由");
    expect(report.strategyReview.nextActions.join(" ")).toContain("连续确认");
  });

  it("keeps the last intraday plan decision when a newer post-market startup did not run", () => {
    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account: { ...account, cash: 5_935 },
      positions: [],
      orders: [],
      auditEvents: [
        {
          id: "intraday-watch-only",
          category: "system",
          action: "paper-auto-execution.run",
          message: "intraday decision recorded",
          timestamp: "2026-07-14T07:01:00.000Z",
          data: {
            tradingDate: "2026-07-14",
            session: "open",
            regime: "risk-off",
            sourceStatus: "live-read-only",
            planQuality: "watch-only",
            skippedReasons: [{
              symbol: "CASH",
              reason: "中期风险收缩，正常观望，不新增 Paper 仓位",
            }],
          },
        },
        {
          id: "post-market-startup",
          category: "system",
          action: "paper-auto-execution.run",
          message: "startup outside trading session",
          timestamp: "2026-07-14T11:52:00.000Z",
          data: {
            tradingDate: "2026-07-14",
            session: "post-market",
            planQuality: "not-run",
            skippedReasons: [{
              symbol: "SYSTEM",
              reason: "outside A-share trading session: post-market",
            }],
          },
        },
      ],
      now: new Date("2026-07-14T12:00:00.000Z"),
    });

    expect(report.entryReview).toMatchObject({
      status: "risk-blocked",
      marketRegime: "risk-off",
      planQuality: "watch-only",
    });
    expect(report.entryReview.reasons.join(" ")).not.toContain("outside A-share trading session");
  });

  it("distinguishes no qualified candidate from unavailable research input", () => {
    const runAudit = (
      planQuality: "watch-only" | "not-run",
      reason: string,
    ): AuditEvent => ({
      id: `${planQuality}-run`,
      category: "system",
      action: "paper-auto-execution.run",
      message: "run recorded",
      timestamp: "2026-07-14T07:01:00.000Z",
      data: {
        tradingDate: "2026-07-14",
        planQuality,
        skippedReasons: [{ symbol: "SYSTEM", reason }],
      },
    });

    const noCandidate = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account: { ...account, cash: 5_000 },
      positions: [],
      orders: [],
      auditEvents: [runAudit("watch-only", "no qualified candidate")],
      now: new Date("2026-07-14T08:00:00.000Z"),
    });
    const unavailable = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account: { ...account, cash: 5_000 },
      positions: [],
      orders: [],
      auditEvents: [runAudit(
        "not-run",
        "paper auto execution input is temporarily unavailable: history timeout",
      )],
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(noCandidate.entryReview.status).toBe("no-qualified-candidate");
    expect(unavailable.entryReview.status).toBe("data-unavailable");
  });

  it("does not invent reasons for historical orders without decision audit", () => {
    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account,
      positions,
      orders: [orders[0]],
      auditEvents: [],
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.trades.items[0]).toMatchObject({
      reasonSource: "historical-fallback",
    });
    expect(report.trades.items[0].reason).toContain("历史版本未持久化逐笔策略理由");
  });

  it("flags repeated ordinary adaptive reductions for the same symbol", () => {
    const repeatedSellOrders: OrderRecord[] = [
      {
        ...orders[0],
        id: "adaptive-sell-1",
        side: "sell",
        quantity: 200,
        filledQuantity: 200,
        notional: 430,
        clientOrderId: "kairos-auto-paper:2026-07-14:600010:paper-sell-plan:200",
        createdAt: "2026-07-14T01:46:00.000Z",
        updatedAt: "2026-07-14T01:46:00.000Z",
      },
      {
        ...orders[0],
        id: "adaptive-sell-2",
        side: "sell",
        quantity: 100,
        filledQuantity: 100,
        notional: 215,
        clientOrderId: "kairos-auto-paper:2026-07-14:600010:paper-sell-plan:100",
        createdAt: "2026-07-14T05:17:00.000Z",
        updatedAt: "2026-07-14T05:17:00.000Z",
      },
    ];
    const repeatedSellAudits: AuditEvent[] = repeatedSellOrders.map((order, index) => ({
      id: `adaptive-decision-${index + 1}`,
      category: "system",
      action: "paper-auto-execution.decision",
      message: "paper auto execution decision recorded",
      timestamp: order.updatedAt,
      data: {
        orderId: order.id,
        strategy: "市场状态减仓",
        reason: "趋势恶化减半仓位",
        ruleChecks: ["adaptive-position-reduction: 50%"],
      },
    }));

    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account,
      positions,
      orders: repeatedSellOrders,
      auditEvents: repeatedSellAudits,
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.strategyReview.issues.join(" ")).toContain("同一标的");
    expect(report.strategyReview.issues.join(" ")).toContain("重复");
    expect(report.strategyReview.nextActions.join(" ")).toContain("每天最多一次");
    expect(report.strategyReview.nextActions.join(" ")).toContain("硬止损");
  });

  it("reviews the previous Friday on a weekend and separates daily from cumulative pnl", () => {
    const fridaySnapshot: MarketSnapshot = {
      mode: "paper",
      sequence: 20,
      marketTime: "2026-07-17T07:00:00.000Z",
      quotes: [{
        symbol: "600010",
        name: "包钢股份",
        tradable: true,
        price: 11,
        previousClose: 10,
        changePercent: 10,
        volume: 1_000_000,
        updatedAt: "2026-07-17T07:00:00.000Z",
      }],
    };
    const weekendAccount: AccountSnapshot = {
      ...account,
      cash: 2_095,
      equity: 2_095,
      marketValue: 0,
      dailyPnl: 295,
      dailyPnlPercent: 0.1639,
    };
    const fridaySell: OrderRecord = {
      ...orders[0],
      id: "friday-sell",
      side: "sell",
      quantity: 100,
      filledQuantity: 100,
      filledPrice: 11,
      requestedPrice: 11,
      notional: 1_100,
      commission: 5,
      createdAt: "2026-07-17T01:31:00.000Z",
      updatedAt: "2026-07-17T01:31:00.000Z",
    };

    const report = buildDailyMarketReview({
      snapshot: fridaySnapshot,
      provider: "akshare",
      account: weekendAccount,
      positions: [],
      orders: [fridaySell],
      auditEvents: [],
      now: new Date("2026-07-18T02:00:00.000Z"),
    });

    expect(report).toMatchObject({
      tradingDate: "2026-07-17",
      dateBasis: "weekend-previous-weekday",
      account: {
        dailyPnl: 95,
        dailyPnlPercent: 0.0475,
        cumulativePnl: 295,
        cumulativePnlPercent: 0.1639,
        performanceBasis: "mark-to-market",
        missingPreviousCloseSymbols: [],
      },
      trades: {
        submitted: 1,
        filledSells: 1,
      },
    });
    expect(report.strategyReview.summary).toContain("2026-07-17");
    expect(report.strategyReview.summary).not.toContain("今日");
  });

  it("does not substitute cumulative pnl when previous-close inputs are missing", () => {
    const report = buildDailyMarketReview({
      snapshot: { ...snapshot, quotes: [] },
      provider: "akshare",
      account,
      positions,
      orders: [],
      auditEvents: [],
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.account).toMatchObject({
      dailyPnl: null,
      dailyPnlPercent: null,
      cumulativePnl: account.dailyPnl,
      cumulativePnlPercent: account.dailyPnlPercent,
      performanceBasis: "unavailable",
      missingPreviousCloseSymbols: ["600010"],
    });
  });

  it("keeps the previous Friday review before the Monday open", () => {
    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account,
      positions,
      orders: [],
      auditEvents: [],
      now: new Date("2026-07-20T00:30:00.000Z"),
    });

    expect(report).toMatchObject({
      tradingDate: "2026-07-17",
      dateBasis: "pre-market-previous-weekday",
    });
  });

  it("flags an opening phase that consumes the full automatic daily order budget", () => {
    const openingSells = Array.from({ length: 4 }, (_, index): OrderRecord => ({
      ...orders[0],
      id: `opening-sell-${index}`,
      symbol: String(600010 + index),
      side: "sell",
      quantity: 100,
      filledQuantity: 100,
      notional: 215,
      commission: 5,
      clientOrderId: `kairos-auto-paper:2026-07-14:${600010 + index}:paper-sell-plan:100`,
      createdAt: `2026-07-14T01:3${index + 1}:00.000Z`,
      updatedAt: `2026-07-14T01:3${index + 1}:00.000Z`,
    }));

    const report = buildDailyMarketReview({
      snapshot,
      provider: "akshare",
      account,
      positions,
      orders: openingSells,
      auditEvents: [],
      maxDailyAutoOrders: 4,
      now: new Date("2026-07-14T08:00:00.000Z"),
    });

    expect(report.strategyReview.issues.join(" ")).toContain("开盘阶段");
    expect(report.strategyReview.issues.join(" ")).toContain("全天 4 笔");
    expect(report.strategyReview.nextActions.join(" ")).toContain("后续确认阶段");
  });
});
