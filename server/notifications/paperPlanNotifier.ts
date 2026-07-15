import { createHash } from "node:crypto";
import type { TradingStore } from "../contracts/TradingStore";
import type {
  PaperTradingOperation,
  PaperTradingPlan,
} from "../research/paperTradingPlan";
import type { WxPusherMessage } from "./wxPusherClient";

export interface PaperPlanMessageSender {
  send(message: WxPusherMessage): Promise<unknown>;
}

export interface PaperPlanNotifierOptions {
  enabled: boolean;
  sender?: PaperPlanMessageSender;
  store: TradingStore;
}

export type PaperPlanNotificationResult =
  | { status: "disabled" }
  | { status: "not-actionable" }
  | { status: "duplicate"; signature: string }
  | { status: "sent"; signature: string }
  | { status: "failed"; signature: string };

const ACTION_LABELS: Record<
  "paper-buy-plan" | "paper-sell-plan",
  string
> = {
  "paper-buy-plan": "模拟买入计划",
  "paper-sell-plan": "模拟卖出计划",
};

function actionableOperations(plan: PaperTradingPlan): PaperTradingOperation[] {
  return plan.operations.filter((operation) => (
    (operation.action === "paper-buy-plan" ||
      operation.action === "paper-sell-plan") &&
    operation.quantity > 0 &&
    /^\d{6}$/.test(operation.symbol)
  ));
}

function planSignature(
  tradingDate: string,
  operations: PaperTradingOperation[],
): string {
  const payload = operations.map((operation) => ({
    symbol: operation.symbol,
    action: operation.action,
    quantity: operation.quantity,
    price: operation.price,
  }));
  return createHash("sha256")
    .update(JSON.stringify({ tradingDate, operations: payload }))
    .digest("hex");
}

function formatOperation(operation: PaperTradingOperation): string {
  const action = ACTION_LABELS[operation.action as keyof typeof ACTION_LABELS];
  return [
    `[${action}] ${operation.symbol} ${operation.name}`,
    `${operation.quantity} 股，参考价 ${operation.price.toFixed(2)} 元`,
    `策略：${operation.strategy}`,
    `原因：${operation.reason}`,
  ].join("\n");
}

function formatMessage(
  plan: PaperTradingPlan,
  operations: PaperTradingOperation[],
): WxPusherMessage {
  return {
    summary: `KAIROS 模拟计划 ${plan.tradingDate}`,
    content: [
      "KAIROS 模拟交易研究提醒",
      `交易日：${plan.tradingDate}`,
      `数据源：${plan.provider}`,
      "",
      ...operations.flatMap((operation, index) => [
        formatOperation(operation),
        index === operations.length - 1 ? "" : "---",
      ]),
      "本消息仅用于本地模拟交易研究，不构成真实交易建议。",
      "系统不连接真实券商，请在同花顺中自行判断并人工操作。",
    ].join("\n"),
  };
}

export class PaperPlanNotifier {
  constructor(private readonly options: PaperPlanNotifierOptions) {}

  async notify(plan: PaperTradingPlan): Promise<PaperPlanNotificationResult> {
    if (!this.options.enabled || !this.options.sender) {
      return { status: "disabled" };
    }

    const operations = actionableOperations(plan);
    if (operations.length === 0) {
      return { status: "not-actionable" };
    }

    const signature = planSignature(plan.tradingDate, operations);
    const alreadySent = this.options.store.listAudit(5_000).some((event) => (
      event.action === "wxpusher.paper-plan.sent" &&
      event.data?.signature === signature
    ));
    if (alreadySent) {
      return { status: "duplicate", signature };
    }

    const auditData = {
      tradingDate: plan.tradingDate,
      signature,
      operationCount: operations.length,
      symbols: operations.map((operation) => operation.symbol),
      mode: "paper-research-only",
      liveTradingEnabled: false,
    };

    try {
      await this.options.sender.send(formatMessage(plan, operations));
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.sent",
        "WxPusher paper plan reminder accepted",
        auditData,
      );
      return { status: "sent", signature };
    } catch {
      this.options.store.appendAudit(
        "system",
        "wxpusher.paper-plan.failed",
        "WxPusher paper plan reminder failed",
        { ...auditData, reason: "provider-request-failed" },
      );
      return { status: "failed", signature };
    }
  }
}
