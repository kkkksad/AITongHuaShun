import type {
  PaperActivityBlockerCode,
  PaperActivityFunnel,
} from "../../shared/trading";
import type { PaperTradingOperation } from "../research/paperTradingPlan";

const BLOCKER_CODES: PaperActivityBlockerCode[] = [
  "market-data",
  "history",
  "strategy",
  "affordability",
  "fees",
  "cash",
  "position",
  "phase",
  "risk",
  "duplicate",
  "execution",
  "other",
];

function emptyBlockerCounts(): Record<PaperActivityBlockerCode, number> {
  return Object.fromEntries(BLOCKER_CODES.map((code) => [code, 0])) as Record<PaperActivityBlockerCode, number>;
}

export function classifyPaperActivityBlocker(value: string): PaperActivityBlockerCode {
  const normalized = value.toLowerCase();
  if (/(market|quote|行情|数据|source|tradable)/u.test(normalized)) return "market-data";
  if (/(history|historical|entry-persistence|历史|持续性)/u.test(normalized)) return "history";
  if (/(strategy|signal|route|策略|信号)/u.test(normalized)) return "strategy";
  if (/(lot-size|not-affordable|一手|整手|afford)/u.test(normalized)) return "affordability";
  if (/(fee|commission|round-trip|费用|佣金)/u.test(normalized)) return "fees";
  if (/(cash|reserve|资金|现金)/u.test(normalized)) return "cash";
  if (/(position|t\+1|持仓|仓位|可卖)/u.test(normalized)) return "position";
  if (/(phase|daily.*cap|阶段|额度|上限)/u.test(normalized)) return "phase";
  if (/(risk|circuit|drawdown|风控|熔断|亏损)/u.test(normalized)) return "risk";
  if (/(duplicate|same-day|idempot|重复|回补)/u.test(normalized)) return "duplicate";
  if (/(execution|submit|broker|执行|提交|撮合)/u.test(normalized)) return "execution";
  return "other";
}

function firstBlockedRule(operation: PaperTradingOperation): string {
  return operation.ruleChecks.find((rule) => rule.includes("blocked")) ?? operation.reason;
}

export function buildPaperActivityFunnel(input: {
  candidatePoolSize: number;
  affordableCandidateCount: number;
  historyCoveredCandidateCount: number;
  strategyQualifiedCandidateCount: number;
  operations: PaperTradingOperation[];
}): PaperActivityFunnel {
  const blockerCounts = emptyBlockerCounts();
  const blockedOperations = input.operations.filter((operation) => operation.action === "blocked");
  for (const operation of blockedOperations) {
    const code = classifyPaperActivityBlocker(firstBlockedRule(operation));
    blockerCounts[code] += 1;
  }
  const plannedBuyOrders = input.operations.filter(
    (operation) => operation.action === "paper-buy-plan",
  ).length;
  const plannedSellOrders = input.operations.filter(
    (operation) => operation.action === "paper-sell-plan",
  ).length;
  return {
    observedCandidates: Math.max(0, Math.floor(input.candidatePoolSize)),
    affordableCandidates: Math.max(0, Math.floor(input.affordableCandidateCount)),
    historyCoveredCandidates: Math.max(0, Math.floor(input.historyCoveredCandidateCount)),
    strategyQualifiedCandidates: Math.max(0, Math.floor(input.strategyQualifiedCandidateCount)),
    plannedOrders: plannedBuyOrders + plannedSellOrders,
    plannedBuyOrders,
    plannedSellOrders,
    submittedOrders: 0,
    filledOrders: 0,
    blockedCandidates: blockedOperations.length,
    blockerCounts,
  };
}

export function withPaperActivityExecutionCounts(
  funnel: PaperActivityFunnel,
  submittedOrders: number,
  filledOrders: number,
): PaperActivityFunnel {
  return {
    ...funnel,
    submittedOrders: Math.max(0, Math.floor(submittedOrders)),
    filledOrders: Math.max(0, Math.floor(filledOrders)),
  };
}
