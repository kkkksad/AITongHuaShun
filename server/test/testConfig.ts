import type { ServerConfig } from "../config";

export function createTestConfig(
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    API_HOST: "127.0.0.1",
    API_PORT: 8787,
    WEB_ORIGIN: "http://127.0.0.1:4173",
    MARKET_MODE: "mock",
    MARKET_TICK_MS: 1000,
    TRADING_STARTING_CASH: 1_000_000,
    MAX_ORDER_NOTIONAL: 100_000,
    MAX_POSITION_WEIGHT: 0.25,
    MAX_DAILY_LOSS: 0.05,
    COMMISSION_RATE: 0.0003,
    MIN_COMMISSION: 5,
    SLIPPAGE_BPS: 5,
    REAL_TRADING_ENABLED: false,
    STORE_BACKEND: "memory",
    DATA_DIR: "./data",
    ...overrides,
  };
}
