import type { PaperCandidatePool, PaperCandidatePoolTier } from "../../shared/paperCandidatePool";
import type { PaperTradingOperation } from "./paperTradingPlan";

type ScannerRow = {
  symbol: string; name: string; action: string; reasons?: string[]; riskFlags?: string[];
};
const tierOrder: PaperCandidatePoolTier[] = ["holding-exit", "holding", "executable", "pending-confirmation", "observation"];
const operationPriority: Record<PaperTradingOperation["action"], number> = {
  "paper-sell-plan": 5, "hold": 4, "paper-buy-plan": 3, blocked: 2, observe: 1,
};
const nextChecks: Record<PaperCandidatePoolTier, string> = {
  observation: "后续扫描重新核对评分、历史与信号；扫描入选不代表交易资格。",
  "pending-confirmation": "下一轮重查上述限制及历史、信号、整手资金和风控。",
  executable: "提交前仍须重查行情时效、交易时段、资金、笔数及Broker风控。",
  holding: "下一轮跟踪估值、T+1可卖数量与退出条件。",
  "holding-exit": "提交前重查报价、T+1可卖数量、订单额度与Broker风控。",
};

/** Evidence-only view. Never used by sizing, signal selection or order submission. */
export function buildPaperCandidatePool(input: {
  candidates: ScannerRow[];
  qualityStocks: ScannerRow[];
  positions: Array<{ symbol: string; name: string }>;
  operations: PaperTradingOperation[];
  consideredSymbols?: string[];
}): PaperCandidatePool {
  const symbols = new Map<string, { name: string; scans: ScannerRow[] }>();
  const add = (symbol: string, name: string, scan?: ScannerRow) => {
    if (!/^\d{6}$/.test(symbol)) return;
    let row = symbols.get(symbol);
    if (!row) { row = { name, scans: [] }; symbols.set(symbol, row); }
    if (scan) row.scans.push(scan);
  };
  for (const row of [...input.candidates, ...input.qualityStocks]) add(row.symbol, row.name, row);
  for (const row of input.positions) add(row.symbol, row.name);
  const operations = new Map<string, PaperTradingOperation>();
  for (const operation of input.operations) {
    if (!/^\d{6}$/.test(operation.symbol)) continue;
    add(operation.symbol, operation.name);
    const old = operations.get(operation.symbol);
    if (!old || operationPriority[operation.action] > operationPriority[old.action]) operations.set(operation.symbol, operation);
  }
  const held = new Set(input.positions.map((row) => row.symbol));
  const considered = new Set(input.consideredSymbols ?? []);
  const globalReasons = [...new Set(input.operations.filter((row) => row.symbol === "CASH" && row.action === "observe").map((row) => row.reason))].join("；");
  const counts: PaperCandidatePool["counts"] = { observation: 0, "pending-confirmation": 0, executable: 0, holding: 0, "holding-exit": 0 };
  const rows: PaperCandidatePool["rows"] = [];
  for (const [symbol, value] of symbols) {
    const operation = operations.get(symbol);
    const actionableScan = value.scans.some((scan) => scan.action === "paper-buy" || scan.action === "focus");
    let tier: PaperCandidatePoolTier = "observation";
    let reasonSource: PaperCandidatePool["rows"][number]["reasonSource"] = "scanner";
    let reason = [...new Set(value.scans.flatMap((scan) => [...(scan.riskFlags ?? []), ...(scan.reasons ?? [])]))].join("；") || "扫描器未提供进一步原因。";
    if (operation) {
      tier = operation.action === "paper-sell-plan" ? "holding-exit"
        : held.has(symbol) || operation.action === "hold" ? "holding"
        : operation.action === "paper-buy-plan" ? "executable"
        : operation.action === "blocked" ? "pending-confirmation" : "observation";
      reason = operation.reason;
      reasonSource = "symbol-plan";
    } else if (held.has(symbol)) {
      tier = "holding";
      reasonSource = "unassessed";
      reason = "已有持仓，本轮未生成逐股计划；继续核对估值与退出条件。";
    } else if (considered.has(symbol) && globalReasons) {
      tier = "pending-confirmation";
      reasonSource = "global-plan";
      reason = globalReasons;
    } else if (actionableScan) {
      reasonSource = "unassessed";
      reason = "扫描器关注候选，本轮未生成逐股计划；尚不能据此确认策略命中或买入资格。";
    }
    counts[tier] += 1;
    rows.push({ symbol, name: operation?.name ?? value.name, tier, reason, reasonSource, nextCheck: nextChecks[tier] });
  }
  rows.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));
  return { total: rows.length, counts, omitted: Math.max(0, rows.length - 120), rows: rows.slice(0, 120) };
}
