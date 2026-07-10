import type { RiskLimits } from "../shared/trading";
import type { ServerConfig } from "./config";
import type { MarketDataProvider } from "./contracts/MarketDataProvider";
import type { TradingStore } from "./contracts/TradingStore";
import { PaperBroker } from "./broker/paperBroker";
import { MockMarket } from "./market/mockMarket";
import { RiskEngine } from "./risk/riskEngine";
import { InMemoryTradingStore } from "./store/inMemoryTradingStore";
import { JsonFileTradingStore } from "./store/jsonFileTradingStore";

export interface TradingSystem {
  market: MarketDataProvider;
  store: TradingStore;
  risk: RiskEngine;
  broker: PaperBroker;
  limits: RiskLimits;
}

function createStore(config: ServerConfig): TradingStore {
  if (config.STORE_BACKEND === "json") {
    return new JsonFileTradingStore(config.DATA_DIR, config.TRADING_STARTING_CASH);
  }
  return new InMemoryTradingStore(config.TRADING_STARTING_CASH);
}

export function createTradingSystem(config: ServerConfig): TradingSystem {
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
  const market: MarketDataProvider = new MockMarket(config.MARKET_MODE, config.MARKET_TICK_MS);
  const store: TradingStore = createStore(config);
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
