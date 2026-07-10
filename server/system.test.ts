import { describe, expect, it } from "vitest";
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
});
