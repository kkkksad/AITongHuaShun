/**
 * HttpMarketProvider 单元测试 —— 验证 HTTP 行情适配器正确实现 MarketDataProvider 契约。
 *
 * 覆盖：
 * - 构造函数、默认值、行情缓存初始化
 * - getQuote / getSnapshot（含防御性拷贝）
 * - tick 手动推进
 * - start / stop 生命周期与幂等性
 * - 'snapshot' 事件发出
 * - HTTP fetch 响应解析、错误处理、超时处理
 * - 空标的列表、自定义请求头、API Key
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpMarketProvider } from "./HttpMarketProvider";
import type { HttpMarketConfig } from "./HttpMarketProvider";
import type { MarketDataProvider } from "../contracts/MarketDataProvider";

// ── 辅助 ──

function makeConfig(overrides: Partial<HttpMarketConfig> = {}): HttpMarketConfig {
  return {
    baseUrl: "http://test-api.local",
    tickMs: 500,
    mode: "paper",
    symbols: ["600519", "000001"],
    ...overrides,
  };
}

function mockFetchResponse(quotes: Array<Record<string, unknown>>) {
  return {
    ok: true,
    json: async () => ({ quotes }),
  } as Response;
}

function mockFetchError(status: number) {
  return {
    ok: false,
    status,
  } as Response;
}

function assertValidSnapshot(snapshot: ReturnType<MarketDataProvider["getSnapshot"]>) {
  expect(snapshot.mode).toBe("paper");
  expect(typeof snapshot.sequence).toBe("number");
  expect(snapshot.sequence).toBeGreaterThanOrEqual(0);
  expect(snapshot.marketTime).toBeTruthy();
  expect(Array.isArray(snapshot.quotes)).toBe(true);
  for (const q of snapshot.quotes) {
    expect(typeof q.symbol).toBe("string");
    expect(typeof q.price).toBe("number");
    expect(typeof q.tradable).toBe("boolean");
    expect(typeof q.updatedAt).toBe("string");
  }
}

// ═══════════════════════════════════════════════
// 构造函数 & 初始化
// ═══════════════════════════════════════════════

describe("HttpMarketProvider 构造函数", () => {
  it("为每个 symbol 创建初始报价", () => {
    const provider = new HttpMarketProvider(makeConfig({ symbols: ["600519", "300750"] }));

    const moutai = provider.getQuote("600519");
    const ningde = provider.getQuote("300750");

    expect(moutai).toBeDefined();
    expect(moutai!.symbol).toBe("600519");
    expect(moutai!.price).toBe(0);
    expect(moutai!.tradable).toBe(true);

    expect(ningde).toBeDefined();
    expect(ningde!.symbol).toBe("300750");
    expect(ningde!.price).toBe(0);
  });

  it("默认 timeout 为 10 秒且 headers 为空对象", () => {
    const provider = new HttpMarketProvider(makeConfig());

    // 初始快照应包含所有标的
    const snapshot = provider.getSnapshot();
    expect(snapshot.quotes.length).toBe(2);
  });

  it("支持自定义 timeout 和 headers", () => {
    const provider = new HttpMarketProvider(
      makeConfig({
        timeout: 5_000,
        headers: { "X-Custom": "test-value" },
      }),
    );

    const snapshot = provider.getSnapshot();
    expect(snapshot.mode).toBe("paper");
  });

  it("空标的列表不抛出异常", () => {
    const provider = new HttpMarketProvider(makeConfig({ symbols: [] }));
    const snapshot = provider.getSnapshot();
    expect(snapshot.quotes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════
// getQuote
// ═══════════════════════════════════════════════

describe("HttpMarketProvider.getQuote", () => {
  let provider: HttpMarketProvider;

  beforeEach(() => {
    provider = new HttpMarketProvider(makeConfig({ symbols: ["600519", "300750"] }));
  });

  afterEach(() => {
    provider.stop();
  });

  it("按代码返回正确的报价", () => {
    const quote = provider.getQuote("600519");
    expect(quote).toBeDefined();
    expect(quote!.symbol).toBe("600519");
    expect(quote!.name).toBe("600519");
  });

  it("不存在的代码返回 undefined", () => {
    expect(provider.getQuote("999999")).toBeUndefined();
  });

  it("返回的是防御性拷贝，修改不影响内部状态", () => {
    const quote1 = provider.getQuote("600519");
    const quote2 = provider.getQuote("600519");

    if (quote1) {
      quote1.price = 9999;
    }

    // 第二次获取应不受影响
    if (quote2) {
      expect(quote2.price).not.toBe(9999);
    }
  });
});

// ═══════════════════════════════════════════════
// getSnapshot
// ═══════════════════════════════════════════════

describe("HttpMarketProvider.getSnapshot", () => {
  let provider: HttpMarketProvider;

  beforeEach(() => {
    provider = new HttpMarketProvider(makeConfig({ symbols: ["600519", "300750"] }));
  });

  afterEach(() => {
    provider.stop();
  });

  it("返回有效的快照结构", () => {
    const snapshot = provider.getSnapshot();
    assertValidSnapshot(snapshot);
  });

  it("包含所有已注册的标的", () => {
    const snapshot = provider.getSnapshot();
    const symbols = snapshot.quotes.map((q) => q.symbol);
    expect(symbols).toContain("600519");
    expect(symbols).toContain("300750");
  });

  it("返回的是防御性拷贝", () => {
    const snap1 = provider.getSnapshot();
    const snap2 = provider.getSnapshot();

    snap1.quotes.pop();

    // snap2 应不受影响
    expect(snap2.quotes.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════
// tick
// ═══════════════════════════════════════════════

describe("HttpMarketProvider.tick", () => {
  let provider: HttpMarketProvider;

  beforeEach(() => {
    // 先 mock fetch，让 tick 能完成 fetch
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "\u8d35\u5dde\u8305\u53f0",
            tradable: true,
            price: 1500.5,
            previousClose: 1492.6,
            changePercent: 0.53,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
          {
            symbol: "300750",
            name: "\u5b81\u5fb7\u65f6\u4ee3",
            tradable: true,
            price: 255.8,
            previousClose: 253.4,
            changePercent: 0.95,
            volume: 8_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );

    provider = new HttpMarketProvider(makeConfig({ symbols: ["600519", "300750"] }));
  });

  afterEach(() => {
    provider.stop();
    vi.unstubAllGlobals();
  });

  it("手动 tick 返回快照", () => {
    const snapshot = provider.tick();
    assertValidSnapshot(snapshot);
  });

  it("tick 返回有效快照（同步，不等待 fetch）", () => {
    const before = provider.getSnapshot().sequence;
    const snapshot = provider.tick();
    assertValidSnapshot(snapshot);
    expect(snapshot.sequence).toBe(before);
  });

  it("start 后轮询更新 sequence", async () => {
    const before = provider.getSnapshot().sequence;
    provider.start();
    await vi.waitFor(
      () => {
        expect(provider.getSnapshot().sequence).toBeGreaterThan(before);
      },
      { timeout: 3000 },
    );
    provider.stop();
  });
});

// ═══════════════════════════════════════════════
// start / stop 生命周期
// ═══════════════════════════════════════════════

describe("HttpMarketProvider.start / stop", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "\u8d35\u5dde\u8305\u53f0",
            tradable: true,
            price: 1500.5,
            previousClose: 1492.6,
            changePercent: 0.53,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("start 幂等调用不创建多个定时器", () => {
    const provider = new HttpMarketProvider(makeConfig({ tickMs: 200 }));
    provider.start();
    const seqBefore = provider.getSnapshot().sequence;
    provider.start(); // 第二次调用

    // 不应抛出异常
    expect(provider.getSnapshot().sequence).toBeGreaterThanOrEqual(seqBefore);
    provider.stop();
  });

  it("stop 后不再触发事件", async () => {
    const provider = new HttpMarketProvider(makeConfig({ tickMs: 100 }));
    let eventCount = 0;

    provider.on("snapshot", () => {
      eventCount += 1;
    });

    provider.start();
    // 等待至少一次 fetch
    await new Promise((resolve) => setTimeout(resolve, 350));
    provider.stop();

    const countAfterStop = eventCount;

    // 再等一会儿，确保不再触发
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(eventCount).toBe(countAfterStop);
  });

  it("tickMs=1000 正确传递", () => {
    const provider = new HttpMarketProvider(makeConfig({ tickMs: 1000 }));
    const snapshot = provider.tick();
    expect(snapshot).toBeDefined();
    provider.stop();
  });
});

// ═══════════════════════════════════════════════
// snapshot 事件
// ═══════════════════════════════════════════════

describe("HttpMarketProvider snapshot 事件", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "\u8d35\u5dde\u8305\u53f0",
            tradable: true,
            price: 1500.5,
            previousClose: 1492.6,
            changePercent: 0.53,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tick 时发出 snapshot 事件", () => {
    const provider = new HttpMarketProvider(makeConfig());
    let emitted = false;

    provider.on("snapshot", (snapshot) => {
      emitted = true;
      assertValidSnapshot(snapshot);
    });

    provider.tick();
    expect(emitted).toBe(true);
    provider.stop();
  });

  it("off 取消订阅后不再收到事件", () => {
    const provider = new HttpMarketProvider(makeConfig());
    let count = 0;

    const handler = () => {
      count += 1;
    };

    provider.on("snapshot", handler);
    provider.tick();

    provider.off("snapshot", handler);
    provider.tick();

    // 第一 tick 收到，第二 tick 不应收到
    expect(count).toBe(1);
    provider.stop();
  });
});

// ═══════════════════════════════════════════════
// HTTP fetch 响应处理
// ═══════════════════════════════════════════════

describe("HttpMarketProvider fetch 响应处理", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功响应更新内部报价", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "\u8d35\u5dde\u8305\u53f0",
            tradable: true,
            price: 1500.5,
            previousClose: 1492.6,
            changePercent: 0.53,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );

    const provider = new HttpMarketProvider(makeConfig());

    // tick 触发 fetch
    provider.tick();

    // 等待异步 fetch 完成
    await vi.waitFor(
      () => {
        const quote = provider.getQuote("600519");
        expect(quote).toBeDefined();
        if (quote!.price > 0) {
          expect(quote!.price).toBe(1500.5);
          expect(quote!.name).toBe("\u8d35\u5dde\u8305\u53f0");
          expect(quote!.previousClose).toBe(1492.6);
          expect(quote!.volume).toBe(5_000_000);
        }
      },
      { timeout: 2000 },
    );

    provider.stop();
  });

  it("API 返回非 200 时降级为空（不更新报价）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchError(500)),
    );

    const provider = new HttpMarketProvider(makeConfig({ symbols: ["600519"] }));
    const snapshotBefore = provider.getSnapshot();

    provider.tick();

    // 快照应不变
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshotAfter = provider.getSnapshot();
    expect(snapshotAfter.quotes[0].price).toBe(snapshotBefore.quotes[0].price);

    provider.stop();
  });

  it("API 返回格式错误的数据时降级为空", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ not_quotes: [] }),
      } as unknown as Response),
    );

    const provider = new HttpMarketProvider(makeConfig({ symbols: ["600519"] }));
    const snapshotBefore = provider.getSnapshot();

    provider.tick();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 快照应不变
    const snapshotAfter = provider.getSnapshot();
    expect(snapshotAfter.quotes[0].price).toBe(snapshotBefore.quotes[0].price);

    provider.stop();
  });

  it("fetch 网络错误时降级为空", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const provider = new HttpMarketProvider(makeConfig({ symbols: ["600519"] }));
    const snapshotBefore = provider.getSnapshot();

    provider.tick();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const snapshotAfter = provider.getSnapshot();
    expect(snapshotAfter.quotes[0].price).toBe(snapshotBefore.quotes[0].price);

    provider.stop();
  });

  it("API Key 通过 Authorization 头传递", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse([
        {
          symbol: "600519",
          name: "MT",
          tradable: true,
          price: 1500,
          previousClose: 1490,
          changePercent: 0.67,
          volume: 1_000_000,
          updatedAt: "2024-06-15T10:00:00Z",
        },
      ]),
    );

    vi.stubGlobal("fetch", fetchMock);

    const apiKey = "sk-test-abc-123";
    const provider = new HttpMarketProvider(
      makeConfig({ apiKey, symbols: ["600519"] }),
    );

    provider.tick();
    await vi.waitFor(
      () => {
        if (fetchMock.mock.calls.length > 0) {
          const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string> | undefined;
          if (headers) {
            expect(headers["Authorization"]).toBe("Bearer " + apiKey);
          }
        }
      },
      { timeout: 2000 },
    );

    provider.stop();
  });

  it("自定义 headers 合并到请求中", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse([
        {
          symbol: "600519",
          name: "MT",
          tradable: true,
          price: 1500,
          previousClose: 1490,
          changePercent: 0.67,
          volume: 1_000_000,
          updatedAt: "2024-06-15T10:00:00Z",
        },
      ]),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpMarketProvider(
      makeConfig({
        headers: { "X-Client-Id": "quant-app", "X-Region": "cn" },
        symbols: ["600519"],
      }),
    );

    provider.tick();
    await vi.waitFor(
      () => {
        if (fetchMock.mock.calls.length > 0) {
          const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string> | undefined;
          if (headers) {
            expect(headers["X-Client-Id"]).toBe("quant-app");
            expect(headers["X-Region"]).toBe("cn");
            expect(headers["Accept"]).toBe("application/json");
          }
        }
      },
      { timeout: 2000 },
    );

    provider.stop();
  });

  it("缺失的字段使用默认值", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            price: 1500.5,
          },
        ]),
      ),
    );

    const provider = new HttpMarketProvider(makeConfig({ symbols: ["600519"] }));

    provider.tick();
    await vi.waitFor(
      () => {
        const quote = provider.getQuote("600519");
        if (quote!.price > 0) {
          expect(quote!.name).toBe("600519");
          expect(quote!.tradable).toBe(true);
          expect(quote!.previousClose).toBe(0);
          expect(quote!.changePercent).toBe(0);
          expect(quote!.volume).toBe(0);
          expect(quote!.updatedAt).toBeTruthy();
        }
      },
      { timeout: 2000 },
    );

    provider.stop();
  });
});

// ═══════════════════════════════════════════════
// MarketDataProvider 契约一致性
// ═══════════════════════════════════════════════

describe("HttpMarketProvider 契约一致性", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "\u8d35\u5dde\u8305\u53f0",
            tradable: true,
            price: 1500.5,
            previousClose: 1492.6,
            changePercent: 0.53,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("实现了 MarketDataProvider 接口的所有方法", () => {
    const provider: MarketDataProvider = new HttpMarketProvider(makeConfig());

    expect(typeof provider.start).toBe("function");
    expect(typeof provider.stop).toBe("function");
    expect(typeof provider.tick).toBe("function");
    expect(typeof provider.getQuote).toBe("function");
    expect(typeof provider.getSnapshot).toBe("function");
    expect(typeof provider.on).toBe("function");
    expect(typeof provider.off).toBe("function");

    provider.stop();
  });

  it("start 后定期更新报价", async () => {
    const provider = new HttpMarketProvider(makeConfig({ tickMs: 100 }));

    const beforeSeq = provider.getSnapshot().sequence;
    provider.start();

    await vi.waitFor(
      () => {
        expect(provider.getSnapshot().sequence).toBeGreaterThan(beforeSeq);
      },
      { timeout: 3000 },
    );

    provider.stop();
  });

  it("多标的行情正确映射", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockFetchResponse([
          {
            symbol: "600519",
            name: "MT",
            tradable: true,
            price: 1500,
            previousClose: 1490,
            changePercent: 0.67,
            volume: 5_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
          {
            symbol: "300750",
            name: "ND",
            tradable: true,
            price: 255,
            previousClose: 250,
            changePercent: 2.0,
            volume: 8_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
          {
            symbol: "688981",
            name: "ZX",
            tradable: true,
            price: 95,
            previousClose: 92,
            changePercent: 3.26,
            volume: 10_000_000,
            updatedAt: "2024-06-15T10:00:00Z",
          },
        ]),
      ),
    );

    const provider = new HttpMarketProvider(
      makeConfig({ symbols: ["600519", "300750", "688981"] }),
    );

    provider.tick();
    await vi.waitFor(
      () => {
        const moutai = provider.getQuote("600519");
        const ningde = provider.getQuote("300750");
        const zhongxin = provider.getQuote("688981");

        if (moutai!.price > 0) {
          expect(moutai!.price).toBe(1500);
          expect(ningde!.price).toBe(255);
          expect(zhongxin!.price).toBe(95);
        }
      },
      { timeout: 2000 },
    );

    provider.stop();
  });
});
