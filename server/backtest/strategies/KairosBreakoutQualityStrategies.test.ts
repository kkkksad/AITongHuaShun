import { describe, expect, it } from "vitest";
import type { StrategyContext, StrategySignal } from "../../../shared/backtest";
import type { MarketQuote, MarketSnapshot } from "../../../shared/trading";
import {
  KairosQualityLowVolTrendStrategy,
  KairosVolatilityContractionBreakoutStrategy,
  KairosVolumePriceBreakoutStrategy,
} from "./KairosBreakoutQualityStrategies";

function quote(input: {
  price: number;
  changePercent?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
}): MarketQuote {
  return {
    symbol: "600001",
    name: "测试股票",
    tradable: true,
    price: input.price,
    previousClose: input.price / (1 + (input.changePercent ?? 0) / 100),
    changePercent: input.changePercent ?? 0,
    volume: input.volume ?? 1_000_000,
    updatedAt: "2026-10-21T09:35:00+08:00",
    open: input.open ?? input.price,
    high: input.high ?? input.price,
    low: input.low ?? input.price,
    amount: input.price * (input.volume ?? 1_000_000),
  };
}

function context(index: number, item: MarketQuote): StrategyContext {
  const snapshot: MarketSnapshot = {
    mode: "paper",
    sequence: index,
    marketTime: `2026-10-21T09:${String(35 + (index % 20)).padStart(2, "0")}:00+08:00`,
    quotes: [item],
  };
  return {
    snapshot,
    account: {
      accountId: "test",
      mode: "paper",
      cash: 1_000_000,
      equity: 1_000_000,
      marketValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      riskUtilization: 0,
      paused: false,
      updatedAt: snapshot.marketTime,
    },
    positions: [],
    equity: 1_000_000,
    cash: 1_000_000,
    barIndex: index,
    totalBars: 200,
  };
}

function signals(
  strategy: { onBar: (input: StrategyContext) => StrategySignal[] },
  quotes: MarketQuote[],
): StrategySignal[][] {
  return quotes.map((item, index) => strategy.onBar(context(index, item)));
}

describe("KairosBreakoutQualityStrategies", () => {
  it("volatility contraction strategy requires contraction, breakout and volume together", () => {
    const strategy = new KairosVolatilityContractionBreakoutStrategy(
      5,
      10,
      0.62,
      5,
      1.4,
      8,
      4.8,
      0.08,
      0.035,
      0.16,
    );
    const history: MarketQuote[] = [];
    for (let index = 0; index < 15; index += 1) {
      const price = 20 + Math.sin(index / 2) * 0.6;
      history.push(quote({
        price,
        changePercent: 0.1,
        high: price + 0.35,
        low: price - 0.35,
      }));
    }
    for (let index = 0; index < 5; index += 1) {
      history.push(quote({
        price: 20.1 + index * 0.01,
        changePercent: 0,
        high: 20.13 + index * 0.01,
        low: 20.07 + index * 0.01,
        volume: 500_000,
      }));
    }

    const withoutBreakout = signals(strategy, history);
    expect(withoutBreakout.flat()).toHaveLength(0);

    const breakout = quote({
      price: 21.8,
      changePercent: 2.2,
      high: 21.9,
      low: 20.1,
      volume: 5_000_000,
    });
    const output = strategy.onBar(context(history.length, breakout));
    expect(output).toEqual([expect.objectContaining({
      symbol: "600001",
      side: "buy",
      targetWeight: 0.16,
    })]);
  });

  it("volume-price breakout requires volume and intraday confirmation", () => {
    const strategy = new KairosVolumePriceBreakoutStrategy(
      5,
      6,
      10,
      1.5,
      0.58,
      4.5,
      0.075,
      0.03,
      0.16,
    );
    const history: MarketQuote[] = [];
    for (let index = 0; index < 14; index += 1) {
      const price = 10 + index * 0.05;
      history.push(quote({
        price,
        changePercent: 0.2,
        high: price + 0.12,
        low: price - 0.12,
      }));
    }
    expect(signals(strategy, history).flat()).toHaveLength(0);
    const weakVolume = quote({
      price: 11.0,
      changePercent: 3.5,
      high: 11.05,
      low: 10.65,
      volume: 1_050_000,
    });
    expect(strategy.onBar(context(history.length, weakVolume))).toHaveLength(0);

    const confirmed = quote({
      price: 11.2,
      changePercent: 4.0,
      high: 11.25,
      low: 10.8,
      volume: 3_000_000,
    });
    expect(strategy.onBar(context(history.length + 1, confirmed))).toEqual([
      expect.objectContaining({ side: "buy", targetWeight: 0.16 }),
    ]);
  });

  it("quality low-vol trend uses stable price behavior without a fundamentals claim", () => {
    const strategy = new KairosQualityLowVolTrendStrategy(
      5,
      10,
      5,
      0.022,
      0.38,
      0.055,
      0.07,
      0.03,
      0.18,
    );
    const history: MarketQuote[] = [];
    for (let index = 0; index < 22; index += 1) {
      const price = 10 + index * 0.035 + Math.sin(index / 4) * 0.01;
      history.push(quote({
        price,
        changePercent: 0.15,
        high: price + 0.02,
        low: price - 0.02,
      }));
    }

    expect(signals(strategy, history).flat()).toEqual([
      expect.objectContaining({ side: "buy", targetWeight: 0.18 }),
    ]);
  });
});
