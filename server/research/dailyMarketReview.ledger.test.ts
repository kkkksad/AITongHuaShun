import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, RiskLimits } from "../../shared/trading";
import { PaperBroker } from "../broker/paperBroker";
import type { TradingStore } from "../contracts/TradingStore";
import { MockMarket } from "../market/mockMarket";
import { RiskEngine } from "../risk/riskEngine";
import { InMemoryTradingStore } from "../store/inMemoryTradingStore";
import { JsonFileTradingStore } from "../store/jsonFileTradingStore";
import { buildDailyMarketReview } from "./dailyMarketReview";

const directories: string[] = [];
const symbol = "600519";
const limits: RiskLimits = {
  maxOrderNotional: 100_000, maxPositionWeight: 1, maxDailyLoss: 1,
  lotSize: 100, realTradingEnabled: false,
};

function fixture(backend: "memory" | "json", legacyAccount: boolean) {
  let time = new Date("2026-11-09T02:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
  const now = () => time;
  const market = new MockMarket("paper", 500, now);
  let price = 10;
  let previousClose = 10;
  let sourceTime: string | undefined;
  const original = market.getSnapshot();
  market.getSnapshot = (): MarketSnapshot => ({
    ...original, marketTime: now().toISOString(),
    quotes: original.quotes.map((quote) => ({ ...quote,
      price: quote.symbol === symbol ? price : quote.price,
      previousClose: quote.symbol === symbol ? previousClose : quote.previousClose,
      updatedAt: quote.symbol === symbol ? sourceTime ?? now().toISOString() : now().toISOString(),
    })),
  });
  market.getQuote = (requested) => market.getSnapshot().quotes.find((quote) => quote.symbol === requested);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-review-ledger-"));
  directories.push(directory);
  const store: TradingStore = backend === "json"
    ? new JsonFileTradingStore(directory, 10_000, false, { now })
    : new InMemoryTradingStore(10_000, false, now);
  const broker = new PaperBroker(market, store, new RiskEngine(limits), {
    mode: "paper", commissionRate: 0, minimumCommission: 5, slippageBps: 0, limits,
  });
  return { broker, store,
    nextDay: () => { time = new Date(time.getTime() + 86_400_000); vi.setSystemTime(time); },
    quote: (value: number, close = previousClose, timestamp?: string) => {
      price = value; previousClose = close; sourceTime = timestamp;
    },
    review: () => {
      const snapshot = market.getSnapshot();
      const account = broker.getAccount(snapshot);
      if (legacyAccount) delete account.tradingDayPerformance;
      return buildDailyMarketReview({
        snapshot, provider: "akshare", account, positions: broker.getPositions(snapshot),
        orders: broker.getOrders(10_000), auditEvents: store.listAudit(10_000), now: now(),
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith("kairos-review-ledger-")) throw new Error("Unexpected test directory");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe.each(["memory", "json"] as const)("daily review ledger with %s store", (backend) => {
  describe.each([false, true])("legacy account = %s", (legacy) => {
    it("keeps pending buy principal and estimated fees out of profit before and after cancellation", () => {
      const f = fixture(backend, legacy);
      const pending = f.broker.submitOrder({ symbol, side: "buy", type: "limit", quantity: 100, limitPrice: 9 });
      expect(pending.status).toBe("pending");
      expect(f.broker.getAccount().cash).toBe(9_095);
      expect(f.review().account).toMatchObject({ dailyPnl: 0, dailyPnlPercent: 0, openingEquity: 10_000, cash: 9_095 });
      f.broker.cancelOrder(pending.id);
      expect(f.review().account).toMatchObject({ dailyPnl: 0, openingEquity: 10_000, cash: 10_000 });
    });

    it("counts paid fill fees once while a different pending buy reserves more cash", () => {
      const f = fixture(backend, legacy);
      expect(f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 }).status).toBe("filled");
      expect(f.broker.submitOrder({ symbol, side: "buy", type: "limit", quantity: 100, limitPrice: 9 }).status).toBe("pending");
      expect(f.review().account).toMatchObject({ dailyPnl: -5, dailyPnlPercent: -0.0005, openingEquity: 10_000 });
    });

    it("reconstructs today's opening ledger from a buy submitted yesterday and filled today", () => {
      const f = fixture(backend, legacy);
      expect(f.broker.submitOrder({ symbol, side: "buy", type: "limit", quantity: 100, limitPrice: 9 }).status).toBe("pending");
      f.nextDay();
      f.quote(9, 10);
      f.broker.markToMarket();
      expect(f.broker.getOrders()[0].status).toBe("filled");
      expect(f.review().account).toMatchObject({ dailyPnl: -5, openingEquity: 10_000, dailyPnlPercent: -0.0005 });
    });

    it("includes a prior-day sell's actual fill and fees in today's profit after closing the position", () => {
      const f = fixture(backend, legacy);
      f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
      f.nextDay();
      expect(f.broker.submitOrder({ symbol, side: "sell", type: "limit", quantity: 100, limitPrice: 11 }).status).toBe("pending");
      f.nextDay();
      f.quote(11, 10);
      f.broker.markToMarket();
      expect(f.broker.getPositions()).toHaveLength(0);
      expect(f.review().account).toMatchObject({ dailyPnl: 95, openingEquity: 9_995, dailyPnlPercent: 0.0095 });
    });

    it("does not use a previous-close value from an old single-stock source date", () => {
      const f = fixture(backend, legacy);
      f.broker.submitOrder({ symbol, side: "buy", type: "market", quantity: 100 });
      f.nextDay();
      f.quote(11, 10, "2026-11-09T02:00:00Z");
      expect(f.review().account).toMatchObject({ dailyPnl: null, openingEquity: null, performanceBasis: "unavailable" });
    });
  });
});
