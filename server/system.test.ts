import { describe, expect, it } from "vitest";
import { AkShareMarketProvider } from "./market/AkShareProvider";
import { createTestConfig } from "./test/testConfig";
import { createTradingSystem } from "./system";

describe("createTradingSystem", () => {
  it("rejects real trading even when the environment flag is enabled", () => {
    expect(() =>
      createTradingSystem(
        createTestConfig({
          REAL_TRADING_ENABLED: true,
        }),
      ),
    ).toThrow("真实交易");
  });

  it("uses AkShare for read-only market data while retaining paper execution", () => {
    const system = createTradingSystem(
      createTestConfig({
        MARKET_MODE: "paper",
        MARKET_DATA_PROVIDER: "akshare",
        MARKET_SYMBOLS: "600519,000858",
      }),
    );

    expect(system.market).toBeInstanceOf(AkShareMarketProvider);
    expect(system.marketDataProvider).toBe("akshare");
    expect(system.broker.getAccount().mode).toBe("paper");
    expect(system.limits.realTradingEnabled).toBe(false);
  });

  it("rejects AkShare when the execution mode is not paper", () => {
    expect(() =>
      createTradingSystem(
        createTestConfig({
          MARKET_MODE: "mock",
          MARKET_DATA_PROVIDER: "akshare",
        }),
      ),
    ).toThrow("MARKET_MODE=paper");
  });
});
