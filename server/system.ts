import type { RiskLimits } from "../shared/trading";
import type { ServerConfig } from "./config";
import { PaperBroker } from "./broker/paperBroker";
import { MockMarket } from "./market/mockMarket";
import { RiskEngine } from "./risk/riskEngine";
import { InMemoryTradingStore } from "./store/inMemoryTradingStore";

export function createTradingSystem(config: ServerConfig) {
  if (config.MARKET_MODE === "live") {
    throw new Error("Live market providers are not implemented. Use MARKET_MODE=mock.");
  }

  const limits: RiskLimits = {
    maxOrderNotional: config.MAX_ORDER_NOTIONAL,
    maxPositionWeight: config.MAX_POSITION_WEIGHT,
    maxDailyLoss: config.MAX_DAILY_LOSS,
    lotSize: 100,
    realTradingEnabled: config.REAL_TRADING_ENABLED,
  };
  const market = new MockMarket(config.MARKET_MODE, config.MARKET_TICK_MS);
  const store = new InMemoryTradingStore(config.TRADING_STARTING_CASH);
  const risk = new RiskEngine(limits);
  const broker = new PaperBroker(market, store, risk, {
    mode: config.MARKET_MODE,
    commissionRate: config.COMMISSION_RATE,
    minimumCommission: config.MIN_COMMISSION,
    slippageBps: config.SLIPPAGE_BPS,
    limits,
  });

  return {
    market,
    store,
    risk,
    broker,
    limits,
  };
}

export type TradingSystem = ReturnType<typeof createTradingSystem>;
