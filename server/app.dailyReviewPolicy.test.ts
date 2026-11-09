import { expect, it } from "vitest";
import { buildTradingApp } from "./app";
import { createTestConfig } from "./test/testConfig";

it("passes actual execution limits through the daily-review HTTP endpoint", async () => {
  const app = await buildTradingApp({
    config: createTestConfig({
      MARKET_MODE: "paper", TRADING_SEED_PORTFOLIO: false,
      PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN: 3, PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: 7,
    }), startMarket: false,
  });
  try {
    const response = await app.inject("/api/research/daily-review");
    expect(response.statusCode).toBe(200);
    expect(response.json().strategyReview.nextActions.join(" "))
      .toContain("单轮最多 3 笔、每日最多 7 笔");
  } finally { await app.close(); }
});
