import { describe, expect, it } from "vitest";
import {
  AkShareMarketProvider,
  AKSHARE_DEFAULT_SYMBOLS,
} from "./AkShareProvider";

describe("AkShareMarketProvider", () => {
  it("uses default AkShare bridge URL", () => {
    const provider = new AkShareMarketProvider();
    expect(provider).toBeDefined();
    // 验证默认配置：构造不抛异常
    const snapshot = provider.tick();
    expect(snapshot.mode).toBe("paper");
    expect(snapshot.quotes.length).toBe(AKSHARE_DEFAULT_SYMBOLS.length);
  });

  it("accepts custom baseUrl", () => {
    const provider = new AkShareMarketProvider({
      baseUrl: "http://akshare:8800",
      symbols: ["600519"],
    });

    const snapshot = provider.tick();
    expect(snapshot.quotes.length).toBe(1);
    expect(snapshot.quotes[0].symbol).toBe("600519");
  });

  it("accepts custom symbols and mode", () => {
    const provider = new AkShareMarketProvider({
      symbols: ["000001", "000858"],
      mode: "paper",
      tickMs: 10000,
    });

    expect(provider).toBeDefined();
    const snapshot = provider.tick();
    expect(snapshot.mode).toBe("paper");
    expect(snapshot.quotes.length).toBe(2);
  });

  it("implements MarketDataProvider contract", () => {
    const provider = new AkShareMarketProvider({ symbols: ["600519"] });

    // 不调用 start() 的 tick 也应返回有效快照
    const snapshot1 = provider.tick();
    expect(snapshot1.quotes).toBeDefined();
    expect(snapshot1.sequence).toBeGreaterThanOrEqual(0);

    // getSnapshot
    const snapshot2 = provider.getSnapshot();
    expect(snapshot2.quotes.length).toBe(1);

    // getQuote
    const quote = provider.getQuote("600519");
    expect(quote).toBeDefined();
    expect(quote!.symbol).toBe("600519");

    const missing = provider.getQuote("NONEXISTENT");
    expect(missing).toBeUndefined();
  });

  it("emits snapshot event on tick", () => {
    const provider = new AkShareMarketProvider({ symbols: ["600519"] });

    let emitted = false;
    provider.on("snapshot", () => {
      emitted = true;
    });

    provider.tick();
    expect(emitted).toBe(true);
  });

  it("default symbols are all tradable", () => {
    const provider = new AkShareMarketProvider();
    const snapshot = provider.tick();

    for (const quote of snapshot.quotes) {
      expect(quote.tradable).toBe(true);
    }
  });

  it("stop after start does not throw", () => {
    const provider = new AkShareMarketProvider({
      symbols: ["600519"],
      tickMs: 60000, // Long interval to avoid actual fetch
    });

    provider.start();
    provider.stop();
    // 验证 start/stop 不抛异常
    expect(true).toBe(true);
  });
});
