import type { AccountSnapshot, MarketQuote, MarketSnapshot, RiskState } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { copyPaperRiskCheckpoint, type PaperRiskCheckpoint } from "./paperRiskCheckpoint";
import type { RiskEngine } from "./riskEngine";

const PEAK_CHECKPOINT_INTERVAL_MS = 30_000;
const PEAK_CHECKPOINT_RELATIVE_CHANGE = 0.001;

export class PaperRiskCheckpointError extends Error {
  readonly statusCode = 503;
  constructor() { super("Paper风险检查点暂不可用，执行已停止；可稍后重试"); this.name = "PaperRiskCheckpointError"; }
}

const criticalFields: (keyof RiskState)[] = ["tradingDate", "circuitState", "consecutiveLosses", "trippedAt",
  "warningAt", "tradeCount", "lossCount", "unknownCycleCount", "ledgerStatus", "lastTradeTime", "baselineResetDate"];

function sameSemanticState(left: Readonly<RiskState>, right: Readonly<RiskState>): boolean {
  const fields: (keyof RiskState)[] = [...criticalFields, "peakDailyEquity", "dailyDrawdown"];
  return fields.every((field) => left[field] === right[field]);
}

/** Single-process coordinator; the ledger remains the source of committed fill evidence. */
export class PaperRiskTracker {
  private cursor = 0;
  private saved?: PaperRiskCheckpoint;
  private historyGap = false;
  private persistenceBlocked = false;

  constructor(
    private readonly risk: RiskEngine,
    private readonly store: TradingStore,
    private readonly clock: () => Date,
    private readonly freshnessReason: (quote: MarketQuote) => string | null,
  ) {
    const checkpoint = store.getPaperRiskCheckpoint();
    if (checkpoint) {
      risk.restoreState(checkpoint.state);
      this.cursor = checkpoint.lastConsumedCycle;
      this.saved = checkpoint;
      this.historyGap = checkpoint.state.ledgerStatus === "history-gap" ||
        Date.parse(checkpoint.savedAt) > this.clock().getTime() + 5_000;
    }
  }

  synchronize(account: AccountSnapshot, snapshot: MarketSnapshot, force = false): void {
    // A failed save is retried before any new execution. It must not replay
    // already consumed in-memory results while the process is still alive.
    const wasBlocked = this.persistenceBlocked;
    this.risk.setLedgerStatus(this.historyGap ? "history-gap" : "ready");
    const ledger = this.store.getPaperFillLedger();
    const outstanding = ledger.results.filter((result) => result.sequence > this.cursor);
    if (this.cursor > ledger.lastSequence || (this.cursor < ledger.lastSequence &&
        outstanding[0]?.sequence !== this.cursor + 1)) this.historyGap = true;
    if (!this.historyGap) {
      for (const result of outstanding) {
        try { this.risk.recordClosedCycleResult(result.netPnl, result.closedAt); }
        catch { this.historyGap = true; break; }
        this.cursor = result.sequence;
      }
    }
    this.risk.setLedgerStatus(this.historyGap ? "history-gap" : "ready");

    const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
    const reliableValuation = this.store.getPositions(snapshot).every((position) => {
      const quote = quoteMap.get(position.symbol);
      return quote !== undefined && Number.isFinite(quote.price) && quote.price > 0 && this.freshnessReason(quote) === null;
    });
    if (reliableValuation) {
      this.risk.observeEquity(account.equity, account.tradingDayPerformance?.openingEquity ?? undefined);
    }
    const state = this.risk.getState();
    const now = this.clock();
    const savedState = this.saved?.state;
    const criticalChange = !savedState || this.cursor !== this.saved?.lastConsumedCycle ||
      criticalFields.some((field) => state[field] !== savedState[field]);
    const newPeak = savedState && state.peakDailyEquity > savedState.peakDailyEquity;
    const peakDue = newPeak && (savedState.peakDailyEquity === 0 ||
      state.peakDailyEquity - savedState.peakDailyEquity >= savedState.peakDailyEquity * PEAK_CHECKPOINT_RELATIVE_CHANGE ||
      now.getTime() - Date.parse(this.saved!.savedAt) >= PEAK_CHECKPOINT_INTERVAL_MS);
    const forceChanged = force && (!savedState || !sameSemanticState(state, savedState));
    if (!criticalChange && !peakDue && !forceChanged && !wasBlocked) return;

    const checkpoint: PaperRiskCheckpoint = { version: 1, lastConsumedCycle: this.cursor,
      savedAt: now.toISOString(), state: { ...state } };
    try {
      this.store.setPaperRiskCheckpoint(checkpoint);
      this.saved = copyPaperRiskCheckpoint(checkpoint);
      this.persistenceBlocked = false;
    } catch {
      this.risk.setLedgerStatus("checkpoint-unavailable");
      if (!this.persistenceBlocked) console.error("[PaperRiskTracker] 风险检查点暂不可用，后续执行已停止");
      this.persistenceBlocked = true;
      throw new PaperRiskCheckpointError();
    }
  }

  /** Only called after an explicit account/risk reset, never to heal evidence silently. */
  reset(account: AccountSnapshot, snapshot: MarketSnapshot): void {
    this.cursor = this.store.getPaperFillLedger().lastSequence;
    this.saved = undefined;
    this.historyGap = false;
    this.persistenceBlocked = false;
    this.risk.resetCircuit();
    this.synchronize(account, snapshot, true);
  }
}
