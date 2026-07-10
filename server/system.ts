import type { EnhancedRiskLimits } from "../shared/trading";
import type { ServerConfig } from "./config";
import type { MarketDataProvider } from "./contracts/MarketDataProvider";
import type { TradingStore } from "./contracts/TradingStore";
import { PaperBroker } from "./broker/paperBroker";
import { AkShareMarketProvider } from "./market/AkShareProvider";
import { MockMarket } from "./market/mockMarket";
import { RiskEngine } from "./risk/riskEngine";
import { InMemoryTradingStore } from "./store/inMemoryTradingStore";
import { JsonFileTradingStore } from "./store/jsonFileTradingStore";

export interface TradingSystem {
  market: MarketDataProvider;
  marketDataProvider: ServerConfig["MARKET_DATA_PROVIDER"];
  store: TradingStore;
  risk: RiskEngine;
  broker: PaperBroker;
  limits: EnhancedRiskLimits;
}

function parseMarketSymbols(value: string): string[] {
  const symbols = value
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^\d{6}$/.test(symbol));

  if (symbols.length === 0) {
    throw new Error("MARKET_SYMBOLS 至少需要一个 6 位证券代码");
  }

  return [...new Set(symbols)];
}

function createMarket(config: ServerConfig): MarketDataProvider {
  if (config.MARKET_DATA_PROVIDER === "akshare") {
    if (config.MARKET_MODE !== "paper") {
      throw new Error("AkShare 只读行情必须使用 MARKET_MODE=paper");
    }

    return new AkShareMarketProvider({
      baseUrl: config.AKSHARE_BRIDGE_URL,
      symbols: parseMarketSymbols(config.MARKET_SYMBOLS),
      tickMs: config.MARKET_TICK_MS,
      timeout: config.MARKET_DATA_TIMEOUT_MS,
      mode: "paper",
      apiKey: config.AKSHARE_BRIDGE_TOKEN,
    });
  }

  return new MockMarket(config.MARKET_MODE, config.MARKET_TICK_MS);
}

function createStore(config: ServerConfig): TradingStore {
  if (config.STORE_BACKEND === "json") {
    return new JsonFileTradingStore(config.DATA_DIR, config.TRADING_STARTING_CASH);
  }
  return new InMemoryTradingStore(config.TRADING_STARTING_CASH);
}

export function createTradingSystem(config: ServerConfig): TradingSystem {
  if (config.REAL_TRADING_ENABLED) {
    throw new Error("真实交易尚未实现，REAL_TRADING_ENABLED 必须保持 false");
  }

  if (config.MARKET_MODE === "live") {
    throw new Error("Live market providers are not implemented. Use MARKET_MODE=mock.");
  }

  const limits: EnhancedRiskLimits = {
    maxOrderNotional: config.MAX_ORDER_NOTIONAL,
    maxPositionWeight: config.MAX_POSITION_WEIGHT,
    maxDailyLoss: config.MAX_DAILY_LOSS,
    lotSize: 100,
    realTradingEnabled: config.REAL_TRADING_ENABLED,
    circuitBreaker: {
      maxConsecutiveLosses: config.CIRCUIT_MAX_CONSECUTIVE_LOSSES,
      maxDailyDrawdown: config.CIRCUIT_MAX_DAILY_DRAWDOWN,
      cooldownMinutes: config.CIRCUIT_COOLDOWN_MINUTES,
      recoveryMinutes: config.CIRCUIT_RECOVERY_MINUTES,
    },
    dynamicPositionScaling: config.DYNAMIC_POSITION_SCALING,
    maxDrawdownReductionFactor: config.MAX_DRAWDOWN_REDUCTION_FACTOR,
  };
  const market = createMarket(config);
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
    marketDataProvider: config.MARKET_DATA_PROVIDER,
    store,
    risk,
    broker,
    limits,
  };
}
