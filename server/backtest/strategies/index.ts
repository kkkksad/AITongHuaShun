/**
 * 策略库 —— 即插即用的回测策略集合。
 *
 * 使用方式：
 * ```typescript
 * import { MovingAverageCrossStrategy } from "./strategies";
 * const engine = new BacktestEngine(snapshots, new MovingAverageCrossStrategy(5, 20, 0.5));
 * ```
 */

export { MovingAverageCrossStrategy } from "./MovingAverageCrossStrategy";
export { RSIStrategy } from "./RSIStrategy";
export { BollingerBandsStrategy } from "./BollingerBandsStrategy";
export { MomentumStrategy } from "./MomentumStrategy";
export { GridTradingStrategy } from "./GridTradingStrategy";
export { MACDStrategy } from "./MACDStrategy";
export { TurtleStrategy } from "./TurtleStrategy";
export { DCAStrategy } from "./DCAStrategy";
export { ASharePullbackConfirmationStrategy } from "./ASharePullbackConfirmationStrategy";
export {
  KairosCapitalShieldStrategy,
  KairosLowVolTrendStrategy,
  KairosQuietPullbackStrategy,
  KairosRiskOffRecoveryStrategy,
} from "./KairosDefensiveStrategies";
export {
  KairosTrendHealthStrategy,
  KairosWashoutRecoveryStrategy,
} from "./KairosRegimeStrategies";

// 技术指标也可以导出，方便自定义策略使用
export {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  atr,
  highest,
  lowest,
  donchianChannel,
} from "./indicators";
export type { MACDResult, BollingerBandsResult, DonchianChannelResult } from "./indicators";
