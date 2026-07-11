import type { PaperTradingOperation, PaperTradingPlan } from "./paperTradingPlan";

export type SuperMindSignalAction = "buy" | "sell" | "hold";

export interface SuperMindSignalRow {
  signalId: string;
  tradingDate: string;
  symbol: string;
  name: string;
  action: SuperMindSignalAction;
  quantity: number;
  price: number;
  notional: number;
  strategy: string;
  reason: string;
  sourceAction: PaperTradingOperation["action"];
  manualApprovalRequired: true;
}

export interface SuperMindSignalPackage {
  generatedAt: string;
  bridge: {
    provider: "supermind";
    mode: "signal-file-only";
    execution: "manual-upload-or-review";
    liveTradingEnabled: false;
  };
  sourcePlan: {
    generatedAt: string;
    tradingDate: string;
    provider: string;
    planQuality: PaperTradingPlan["qualitySummary"]["planQuality"];
    operationCount: number;
  };
  signals: SuperMindSignalRow[];
  csv: string;
  supermindTemplate: string;
  nextSteps: string[];
  guardrails: string[];
}

function toSuperMindSymbol(symbol: string): string {
  if (symbol.startsWith("6")) return `${symbol}.SH`;
  if (symbol.startsWith("0") || symbol.startsWith("3")) return `${symbol}.SZ`;
  if (symbol.startsWith("8") || symbol.startsWith("4")) return `${symbol}.BJ`;
  return symbol;
}

function toSignalAction(
  action: PaperTradingOperation["action"],
): SuperMindSignalAction | null {
  if (action === "paper-buy-plan") return "buy";
  if (action === "paper-sell-plan") return "sell";
  if (action === "hold") return "hold";
  return null;
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(signals: SuperMindSignalRow[]): string {
  const header = [
    "signal_id",
    "trading_date",
    "symbol",
    "name",
    "action",
    "quantity",
    "price",
    "notional",
    "strategy",
    "reason",
    "manual_approval_required",
  ];
  const rows = signals.map((signal) => [
    signal.signalId,
    signal.tradingDate,
    signal.symbol,
    signal.name,
    signal.action,
    signal.quantity,
    signal.price,
    signal.notional,
    signal.strategy,
    signal.reason,
    signal.manualApprovalRequired,
  ]);
  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsv(value)).join(","))
    .join("\n");
}

function buildTemplate(signals: SuperMindSignalRow[]): string {
  const payload = signals.map((signal) => ({
    symbol: signal.symbol,
    action: signal.action,
    quantity: signal.quantity,
    price: signal.price,
    reason: signal.reason,
  }));

  return [
    "# SuperMind simulation signal template.",
    "# Review every signal in SuperMind manually before any simulation run.",
    "# KAIROS only emits paper signals. It never logs in, stores credentials, reads cookies, or submits live orders.",
    `signals = ${JSON.stringify(payload, null, 2)}`,
    "",
    "def handle_bar(context, bar_dict):",
    "    for signal in signals:",
    "        if signal['action'] == 'buy':",
    "            order(signal['symbol'], int(signal['quantity']))",
    "        elif signal['action'] == 'sell':",
    "            order(signal['symbol'], -int(signal['quantity']))",
    "        else:",
    "            pass",
  ].join("\n");
}

export function buildSuperMindSignalPackage(
  plan: PaperTradingPlan,
): SuperMindSignalPackage {
  const signals = plan.operations
    .map((operation) => {
      const action = toSignalAction(operation.action);
      if (!action) return null;
      return {
        signalId: `${plan.tradingDate}-${operation.symbol}-${operation.action}`,
        tradingDate: plan.tradingDate,
        symbol: toSuperMindSymbol(operation.symbol),
        name: operation.name,
        action,
        quantity: operation.quantity,
        price: operation.price,
        notional: operation.estimatedNotional,
        strategy: operation.strategy,
        reason: operation.reason,
        sourceAction: operation.action,
        manualApprovalRequired: true,
      } satisfies SuperMindSignalRow;
    })
    .filter((signal): signal is SuperMindSignalRow => signal !== null);

  return {
    generatedAt: new Date().toISOString(),
    bridge: {
      provider: "supermind",
      mode: "signal-file-only",
      execution: "manual-upload-or-review",
      liveTradingEnabled: false,
    },
    sourcePlan: {
      generatedAt: plan.generatedAt,
      tradingDate: plan.tradingDate,
      provider: plan.provider,
      planQuality: plan.qualitySummary.planQuality,
      operationCount: plan.operations.length,
    },
    signals,
    csv: buildCsv(signals),
    supermindTemplate: buildTemplate(signals),
    nextSteps: [
      "Confirm the SuperMind simulation account and cloud strategy runtime manually.",
      "Review signal rows for quantity, symbol mapping, A-share lot size, T+1, and cash constraints.",
      "Upload the CSV or copy the template only into a SuperMind simulation environment.",
      "Export SuperMind simulated fills, positions, and PnL back into KAIROS for research review.",
    ],
    guardrails: [
      "This bridge only emits a signal file and template; it never logs in to TongHuaShun.",
      "Do not paste passwords, SMS codes, cookies, browser tokens, or live broker credentials.",
      "Signals require manual review before any SuperMind simulation run.",
      "Real trading remains disabled; this is not investment advice.",
    ],
  };
}
