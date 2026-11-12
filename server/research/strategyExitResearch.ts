import type { BacktestStrategy, StrategyContext, StrategySignal } from "../../shared/backtest";
import { getChinaDateKey } from "../trading/ashareTradingCalendar";

export type ExitResearchMode = "native" | "common-price-stop" | "family-exit";
export type ExitResearchFamily = "trend" | "mean-reversion";

const emptyDiagnostics = () => ({ completedCloseObservations: 0, invalidCloseObservations: 0,
  unknownHoldingAgeObservations: 0, invalidCostObservations: 0,
  generatedStopExits: 0, generatedTrendBreakExits: 0, generatedMeanRecoveryExits: 0,
  generatedTimeoutExits: 0, blockedExitObservations: 0, replacedNativeSellSignals: 0, suppressedBuySignals: 0 });

function validateIntent(signals: unknown, symbol: string): asserts signals is StrategySignal[] {
  if (!Array.isArray(signals) || signals.some(signal => !signal || signal.symbol !== symbol ||
    (signal.side !== "buy" && signal.side !== "sell") || signal.type !== "market" ||
    (signal.quantity !== undefined && (!Number.isFinite(signal.quantity) || signal.quantity <= 0)) ||
    (signal.targetWeight !== undefined && (!Number.isFinite(signal.targetWeight) || signal.targetWeight <= 0 || signal.targetWeight > 1)) ||
    (signal.quantity === undefined && signal.targetWeight === undefined))) {
    throw Error("退出研究原始意图非法，不得过滤后冒充无信号");
  }
}

/** Offline hypothesis only. Native returns the original instance; no production plan imports this module. */
export function createStrategyExitResearch(base: BacktestStrategy, symbol: string, family: ExitResearchFamily,
  mode: ExitResearchMode, asOf: Date) {
  const cutoff = asOf.getTime();
  if (!/^\d{6}$/.test(symbol) || !Number.isFinite(cutoff) ||
    !["trend", "mean-reversion"].includes(family) || !["native", "common-price-stop", "family-exit"].includes(mode)) {
    throw Error("退出研究缺少有效标的、族、模式或截止时间");
  }
  let diagnostics = emptyDiagnostics();
  let prices: number[] = [], previousClose: number | undefined, cycle: number | undefined;
  let holdingCloses: number | undefined, belowMaCloses = 0;
  if (mode === "native") return { strategy: base, getDiagnostics: () => ({ ...diagnostics }) };

  const strategy: BacktestStrategy = {
    name: `${base.name} [${mode}:${family}]`,
    reset() {
      diagnostics = emptyDiagnostics(); prices = []; previousClose = cycle = holdingCloses = undefined;
      belowMaCloses = 0; base.reset?.();
    },
    onStart(context) { base.onStart?.(structuredClone(context)); },
    onEnd(context) { base.onEnd?.(structuredClone(context)); },
    onBar(context: StrategyContext) {
      // The base gets its own complete copy; callback edits cannot alter the policy's observations.
      const raw = base.onBar(structuredClone(context));
      validateIntent(raw, symbol);
      diagnostics.replacedNativeSellSignals += raw.filter(signal => signal.side === "sell").length;
      const buys = raw.filter(signal => signal.side === "buy").map(signal => ({ ...signal }));
      const quotes = context.snapshot.quotes.filter(quote => quote.symbol === symbol);
      const quote = quotes[0], close = Date.parse(context.snapshot.marketTime);
      const validTime = Number.isFinite(close) && close <= cutoff &&
        close === Date.parse(`${getChinaDateKey(new Date(close))}T15:00:00+08:00`);
      if (context.snapshot.mode !== "paper" || quotes.length !== 1 || !validTime ||
        !Number.isFinite(quote.price) || quote.price <= 0 || Date.parse(quote.updatedAt) !== close ||
        (previousClose !== undefined && close <= previousClose)) {
        diagnostics.invalidCloseObservations++;
        return [];
      }
      const precedingClose = previousClose; previousClose = close;
      diagnostics.completedCloseObservations++;
      prices.push(quote.price); if (prices.length > 20) prices.shift();
      const ma20 = prices.length === 20 ? prices.reduce((sum, price) => sum + price, 0) / 20 : undefined;
      const positions = context.positions.filter(position => position.symbol === symbol && position.quantity > 0);
      if (positions.length > 1) throw Error("退出研究持仓重复，不能推断实际周期");
      const position = positions[0];
      if (!position) { cycle = holdingCloses = undefined; belowMaCloses = 0; return buys; }

      const openedAt = Date.parse(position.paperEntry?.openedAt ?? "");
      if (!Number.isFinite(openedAt) || openedAt > close) {
        cycle = holdingCloses = undefined;
      } else if (cycle !== openedAt) {
        cycle = openedAt; belowMaCloses = 0;
        // Only a fill observed since the preceding close, or on this first observation's date,
        // provides the start of a complete observation count. Never infer calendar holding days.
        holdingCloses = (precedingClose !== undefined ? openedAt > precedingClose :
          getChinaDateKey(new Date(openedAt)) === getChinaDateKey(new Date(close))) ? 1 : undefined;
      } else if (holdingCloses !== undefined) {
        holdingCloses++;
      }
      if (holdingCloses === undefined) diagnostics.unknownHoldingAgeObservations++;
      belowMaCloses = ma20 !== undefined && quote.price < ma20 ? belowMaCloses + 1 : 0;
      const costValid = Number.isFinite(position.averagePrice) && position.averagePrice > 0;
      if (!costValid) diagnostics.invalidCostObservations++;
      let reason: "generatedStopExits" | "generatedTrendBreakExits" | "generatedMeanRecoveryExits" | "generatedTimeoutExits" | undefined;
      if (costValid && quote.price <= position.averagePrice * 0.97) reason = "generatedStopExits";
      else if (mode === "family-exit") {
        if (family === "trend" && belowMaCloses >= 2) reason = "generatedTrendBreakExits";
        else if (family === "mean-reversion" && ma20 !== undefined && costValid &&
          quote.price >= ma20 && quote.price >= position.averagePrice * 1.015) reason = "generatedMeanRecoveryExits";
        else if (holdingCloses !== undefined && holdingCloses >= (family === "trend" ? 20 : 10)) reason = "generatedTimeoutExits";
      }
      if (!reason) return buys;
      diagnostics.suppressedBuySignals += buys.length;
      const locked = position.t1LockedQuantity ?? 0;
      const available = position.availableQuantity ?? position.quantity - locked;
      const quantity = Math.floor(Math.min(position.quantity, available, position.quantity - locked) / 100) * 100;
      if (!quote.tradable || !Number.isFinite(locked) || locked < 0 || !Number.isFinite(quantity) || quantity <= 0) {
        diagnostics.blockedExitObservations++; return [];
      }
      diagnostics[reason]++;
      return [{ symbol, side: "sell", type: "market", quantity }];
    },
  };
  return { strategy, getDiagnostics: () => ({ ...diagnostics }) };
}
