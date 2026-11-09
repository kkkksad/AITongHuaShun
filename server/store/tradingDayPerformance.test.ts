import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";
import type { TradingStore } from "../contracts/TradingStore";
import { MockMarket } from "../market/mockMarket";
import { PaperBroker } from "../broker/paperBroker";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "./inMemoryTradingStore";
import { JsonFileTradingStore } from "./jsonFileTradingStore";

const directories: string[] = [];
const limits: RiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 1, maxDailyLoss: 0.05,
  lotSize: 100, realTradingEnabled: false,
};
const symbol = "600519";

function fixture(backend: "memory" | "json") {
  let time = new Date("2026-11-09T02:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
  const now = () => time;
  const market = new MockMarket("paper", 500, now);
  let price = 10;
  let previousClose = 10;
  const originalSnapshot = market.getSnapshot();
  market.getSnapshot = (): MarketSnapshot => ({
    ...originalSnapshot, marketTime: now().toISOString(),
    quotes: originalSnapshot.quotes.map((quote) => ({ ...quote,
      price: quote.symbol === symbol ? price : quote.price,
      previousClose: quote.symbol === symbol ? previousClose : quote.previousClose,
      updatedAt: now().toISOString(),
    })),
  });
  market.getQuote = (requested) => market.getSnapshot().quotes.find((quote) => quote.symbol === requested);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-day-performance-"));
  directories.push(directory);
  const load = () => new JsonFileTradingStore(directory, 10_000, false, { now });
  const store: TradingStore = backend === "json" ? load() : new InMemoryTradingStore(10_000, false, now);
  const brokerFor = (target: TradingStore) => new PaperBroker(market, target, new RiskEngine(limits), {
    mode: "paper", commissionRate: 0, minimumCommission: 5, slippageBps: 0, limits,
  });
  const broker = brokerFor(store);
  return { store, broker, load, brokerFor, directory, market,
    quote: (value: number, close = previousClose) => { price = value; previousClose = close; },
    nextDay: () => { time = new Date(time.getTime() + 86_400_000); vi.setSystemTime(time); },
    at: (value: string) => { time = new Date(value); vi.setSystemTime(time); },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("kairos-day-performance-")) throw new Error("Unexpected fixture path");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["memory", "json"] as const)("trading-day risk with %s store", (backend) => {
  it("blocks a large daily loss even when prior gains leave cumulative PnL near zero", () => {
    const f = fixture(backend);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 }).status).toBe("filled");
    f.quote(15);
    expect(f.broker.getAccount().equity).toBe(10_995);
    f.nextDay();
    f.quote(10, 15);
    const order = f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
    expect(order.status).toBe("rejected");
    expect(f.store.listAudit().some((event) => event.action === "DAILY_LOSS_LIMIT")).toBe(true);
  });

  it("does not let historical cumulative losses block a profitable new trading day", () => {
    const f = fixture(backend);
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 }).status).toBe("filled");
    f.quote(5);
    expect(f.broker.getAccount().dailyPnlPercent).toBeLessThan(-0.05);
    f.nextDay();
    f.quote(5.1, 5);
    const order = f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
    expect(order.status).toBe("filled");
    expect(f.broker.getAccount().dailyPnlPercent).toBeLessThan(-0.05);
  });

  it("includes buy/sell fees and keeps the opening baseline after closing the whole position", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    f.quote(11, 10);
    expect(f.broker.submitOrder({ symbol, side: "sell", type: "market", quantity: 200 }).status).toBe("filled");
    const account = f.broker.getAccount();
    expect(account.tradingDayPerformance).toMatchObject({
      date: "2026-11-10", openingEquity: 9_995, pnl: 195, baselineSource: "previous-close",
    });
    expect(account.dailyPnl).toBe(190);
  });

  it("counts a new account's paid buy commission as part of today's PnL", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({
      openingEquity: 10_000, pnl: -5, pnlPercent: -0.0005, baselineSource: "account-start",
    });
  });

  it("does not treat reserved cash as a daily loss", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "limit", quantity: 100, limitPrice: 9 });
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({ openingEquity: 10_000, pnl: 0 });
  });

  it("refuses new exposure when the overnight holding's previous close is missing", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    f.quote(11, 0);
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({
      openingEquity: null, pnl: null, pnlPercent: null, baselineSource: "unavailable",
    });
    expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("rejected");
    expect(f.store.listAudit().some((event) => event.action === "DAILY_BASELINE_UNAVAILABLE")).toBe(true);
    // Missing baseline must not independently prevent reducing an existing position.
    expect(f.broker.submitOrder({ symbol, side: "sell", type: "market", quantity: 100 }).status).toBe("filled");
  });

  it("does not use yesterday's source timestamp to establish today's previous close", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    const old = f.market.getSnapshot();
    f.nextDay();
    f.market.getSnapshot = () => old;
    expect(f.broker.getAccount().tradingDayPerformance?.baselineSource).toBe("unavailable");
  });

  it("rebuilds the same baseline after selling and buying again on the same day", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    f.quote(11, 10);
    f.broker.submitOrder({ symbol, side: "sell", type: "market", quantity: 100 });
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({ openingEquity: 9_995, pnl: 190 });
  });

  it("starts the next daily period at Beijing midnight and includes the overnight price move", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    f.at("2026-11-09T15:59:59Z");
    expect(f.broker.getAccount().tradingDayPerformance?.date).toBe("2026-11-09");
    f.at("2026-11-09T16:00:00Z");
    f.quote(9, 10);
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({
      date: "2026-11-10", openingEquity: 9_995, pnl: -200,
    });
  });

  it("uses the new principal after an explicit local account reset", () => {
    const f = fixture(backend);
    f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
    f.nextDay();
    f.broker.resetAccount({ startingCash: 20_000, strategyProfile: "balanced" });
    expect(f.broker.getAccount().tradingDayPerformance).toMatchObject({
      openingEquity: 20_000, pnl: 0, pnlPercent: 0, baselineSource: "account-start",
    });
  });
});

it("reconstructs the same daily baseline after a JSON-store restart", () => {
  const f = fixture("json");
  f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 200 });
  f.nextDay();
  f.quote(11, 10);
  f.broker.submitOrder({ symbol, side: "sell", type: "market", quantity: 100 });
  const before = f.broker.getAccount();
  expect(before.tradingDayPerformance).toMatchObject({ openingEquity: 9_995, pnl: 195 });
  expect(f.brokerFor(f.load()).getAccount().tradingDayPerformance).toEqual(before.tradingDayPerformance);
});
