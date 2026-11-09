import type { RiskState } from "../../shared/trading";

export interface PaperRiskCheckpoint {
  version: 1;
  lastConsumedCycle: number;
  savedAt: string;
  state: RiskState;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRiskTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function validatePaperRiskState(value: unknown): asserts value is RiskState {
  if (!record(value) || typeof value.tradingDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.tradingDate) ||
      !isRiskTimestamp(`${value.tradingDate}T00:00:00.000Z`) ||
      !(value.baselineResetDate === null || value.baselineResetDate === value.tradingDate) ||
      !["normal", "warning", "tripped"].includes(String(value.circuitState)) ||
      !["ready", "history-gap", "checkpoint-unavailable"].includes(String(value.ledgerStatus)) ||
      ![value.tradeCount, value.lossCount, value.consecutiveLosses, value.unknownCycleCount].every(count) ||
      Number(value.lossCount) > Number(value.tradeCount) || Number(value.consecutiveLosses) > Number(value.lossCount) ||
      typeof value.peakDailyEquity !== "number" || !Number.isFinite(value.peakDailyEquity) || value.peakDailyEquity < 0 ||
      typeof value.dailyDrawdown !== "number" || !Number.isFinite(value.dailyDrawdown) || value.dailyDrawdown < 0 || value.dailyDrawdown > 1 ||
      (value.peakDailyEquity === 0 && value.dailyDrawdown !== 0) ||
      ![value.trippedAt, value.warningAt, value.lastTradeTime, value.lastEvaluationTime].every((time) => time === null || isRiskTimestamp(time)) ||
      (value.circuitState === "tripped" ? value.trippedAt === null : value.trippedAt !== null) ||
      (value.circuitState === "warning" && value.warningAt === null) ||
      (value.circuitState === "normal" && value.warningAt !== null) ||
      (value.tradeCount === 0 ? value.lastTradeTime !== null : value.lastTradeTime === null)) {
    throw new Error("Invalid persisted Paper risk state.");
  }
}

export function copyPaperRiskState(state: Readonly<RiskState>): RiskState {
  return { tradingDate: state.tradingDate, circuitState: state.circuitState, consecutiveLosses: state.consecutiveLosses,
    dailyDrawdown: state.dailyDrawdown, peakDailyEquity: state.peakDailyEquity, trippedAt: state.trippedAt,
    warningAt: state.warningAt, tradeCount: state.tradeCount, lossCount: state.lossCount,
    unknownCycleCount: state.unknownCycleCount, ledgerStatus: state.ledgerStatus,
    baselineResetDate: state.baselineResetDate,
    lastTradeTime: state.lastTradeTime, lastEvaluationTime: state.lastEvaluationTime };
}

export function copyPaperRiskCheckpoint(checkpoint: PaperRiskCheckpoint): PaperRiskCheckpoint {
  return { version: 1, lastConsumedCycle: checkpoint.lastConsumedCycle, savedAt: checkpoint.savedAt,
    state: copyPaperRiskState(checkpoint.state) };
}

export function validatePaperRiskCheckpoint(value: unknown, lastCycleSequence: number): asserts value is PaperRiskCheckpoint {
  if (!record(value) || value.version !== 1 || !count(value.lastConsumedCycle) ||
      value.lastConsumedCycle > lastCycleSequence || !isRiskTimestamp(value.savedAt)) {
    throw new Error("Invalid persisted Paper risk checkpoint.");
  }
  validatePaperRiskState(value.state);
  if (value.state.ledgerStatus === "checkpoint-unavailable") {
    throw new Error("Transient failure cannot be a persisted Paper risk checkpoint.");
  }
}
