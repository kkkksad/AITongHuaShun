import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord, OrderRequest } from "../../shared/trading";
import type { TradingBackend } from "../hooks/useTradingBackend";
import { PaperAccount } from "./PaperAccount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = "2026-11-05T02:00:00.000Z";
const clientOrderId = "00000000-0000-4000-8000-000000000031";

function createBackend(): TradingBackend {
  return {
    connectionState: "connected", realtimeState: "connected", mode: "paper",
    marketDataProvider: "mock", pendingAction: false,
    account: {
      accountId: "PAPER-LOCAL", mode: "paper", cash: 1_004.99,
      equity: 2_005.99, marketValue: 1_001, unrealizedPnl: -1, realizedPnl: 0,
      dailyPnl: -1, dailyPnlPercent: -1 / 2_006.99, riskUtilization: 0.1,
      paused: false, updatedAt: now,
    },
    market: {
      mode: "paper", sequence: 1, marketTime: now,
      quotes: [
        { symbol: "600519", name: "测试甲", price: 10.01, previousClose: 10.02,
          changePercent: -0.1, volume: 1_000, tradable: true, updatedAt: now },
        { symbol: "000858", name: "测试乙", price: 20.02, previousClose: 20,
          changePercent: 0.1, volume: 1_000, tradable: true, updatedAt: now },
      ],
    },
    positions: [{
      symbol: "600519", name: "测试甲", quantity: 100, availableQuantity: 100,
      averagePrice: 10.02, currentPrice: 10.01, marketValue: 1_001,
      unrealizedPnl: -1, realizedPnl: 0, weight: 1_001 / 2_005.99,
    }],
    orders: [],
    limits: {
      maxOrderNotional: 100_000.09, maxPositionWeight: 0.5, maxDailyLoss: 0.05,
      lotSize: 100, realTradingEnabled: false,
    },
    refresh: vi.fn(async () => undefined),
    submitOrder: vi.fn(async (request: OrderRequest): Promise<OrderRecord> => ({
      ...request, id: "ORDER-31", status: "accepted", requestedPrice: 10.01,
      filledQuantity: 0, notional: 0, commission: 0, createdAt: now, updatedAt: now,
    })),
    cancelOrder: vi.fn(async () => { throw new Error("unexpected cancellation"); }),
    setPaused: vi.fn(async () => undefined), resetAccount: vi.fn(async () => undefined),
    setStrategyProfile: vi.fn(async () => undefined),
    setExecutionStrategy: vi.fn(async () => undefined),
  };
}

describe("PaperAccount order reference and execution boundary", () => {
  let root: Root;
  let container: HTMLDivElement;
  let backend: TradingBackend;

  beforeEach(() => {
    backend = createBackend();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(clientOrderId);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () => { root.render(<PaperAccount backend={backend} />); });
  }

  function button(label: string) {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((element) => element.textContent === label)!;
  }

  async function click(label: string) {
    await act(async () => { button(label).click(); });
  }

  async function input(label: string, value: string) {
    const element = Array.from(container.querySelectorAll("label"))
      .find((node) => node.querySelector("span")?.textContent === label)!
      .querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function symbol(value: string) {
    await act(async () => {
      const element = container.querySelector("select")!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function reference() {
    return container.querySelector(".order-estimate")!;
  }

  function numericPrincipal() {
    const text = reference().querySelectorAll("strong")[1].textContent!;
    return Number(text.replace(/[^\d.-]/g, ""));
  }

  it("shows cents for account, position, order reference and risk amounts", async () => {
    await render();
    expect(container.querySelector(".account-hero h2")?.textContent).toBe("¥2,005.99");
    expect(Array.from(container.querySelectorAll(".account-metrics strong"), (node) => node.textContent))
      .toEqual(["¥1,001.00", "¥1,004.99", "-¥1.00", "10.0%"]);
    expect(container.querySelector(".data-table tbody td.negative")?.textContent).toBe("-¥1.00");
    expect(reference().querySelectorAll("strong")[1].textContent).toBe("¥1,001.00");
    expect(container.textContent).toContain("单笔上限 ¥100,000.09 · 整手 100 股");
  });

  it("labels market principal and explains costs immediately beside the estimate", async () => {
    await render();
    expect(reference().textContent).toContain("参考本金");
    expect(reference().textContent).not.toContain("预计金额");
    const explanation = reference().nextElementSibling?.textContent;
    expect(explanation).toContain("当前参考价");
    expect(explanation).toContain("不含手续费和滑点");
    expect(explanation).toContain("无固定比例现金预留");
    expect(explanation).toContain("买单仍需覆盖必要费用");
    expect(explanation).toContain("服务端最终核验");
  });

  it("uses the entered limit for reference without promising an execution total", async () => {
    await render();
    await click("限价单");
    await input("限价 (¥)", "12.34");
    await input("数量", "200");
    expect(reference().querySelectorAll("strong")[0].textContent).toBe("¥12.34");
    expect(reference().querySelectorAll("strong")[1].textContent).toBe("¥2,468.00");
    const explanation = reference().nextElementSibling?.textContent;
    expect(explanation).toContain("输入限价");
    expect(explanation).not.toContain("当前参考价");
    expect(explanation).toContain("不含手续费和滑点");
    expect(explanation).toContain("服务端最终核验");
  });

  it("preserves market principal calculation and submits the selected symbol and quantity", async () => {
    await render();
    await input("数量", "200");
    expect(numericPrincipal()).toBe(2_002);
    await symbol("000858");
    expect(numericPrincipal()).toBe(4_004);
    await click("提交模拟订单");
    expect(backend.submitOrder).toHaveBeenCalledTimes(1);
    expect(backend.submitOrder).toHaveBeenCalledWith({
      symbol: "000858", side: "buy", type: "market", quantity: 200, clientOrderId,
    });
  });

  it("preserves sell limit submission when cash is zero", async () => {
    backend.account = { ...backend.account!, cash: 0 };
    await render();
    await click("卖出");
    await click("限价单");
    await input("限价 (¥)", "12.34");
    await input("数量", "200");
    expect(numericPrincipal()).toBe(2_468);
    expect(button("提交限价单").disabled).toBe(false);
    await click("提交限价单");
    expect(backend.submitOrder).toHaveBeenCalledTimes(1);
    expect(backend.submitOrder).toHaveBeenCalledWith({
      symbol: "600519", side: "sell", type: "limit", quantity: 200,
      limitPrice: 12.34, clientOrderId,
    });
  });

  it("returns to the market quote and omits the old limit from a market submission", async () => {
    await render();
    await click("限价单");
    await input("限价 (¥)", "12.34");
    await input("数量", "300");
    await click("市价单");
    expect(numericPrincipal()).toBe(3_003);
    await click("提交模拟订单");
    expect(backend.submitOrder).toHaveBeenCalledTimes(1);
    expect(backend.submitOrder).toHaveBeenCalledWith({
      symbol: "600519", side: "buy", type: "market", quantity: 300, clientOrderId,
    });
  });

  it.each([1_001, 1_004.99])("leaves final fee funding checks to the server at cash %s", async (cash) => {
    backend.account = { ...backend.account!, cash };
    vi.mocked(backend.submitOrder).mockRejectedValue(new Error("可用资金不足"));
    await render();
    expect(button("提交模拟订单").disabled).toBe(false);
    await click("提交模拟订单");
    expect(backend.submitOrder).toHaveBeenCalledTimes(1);
    expect(backend.submitOrder).toHaveBeenCalledWith({
      symbol: "600519", side: "buy", type: "market", quantity: 100, clientOrderId,
    });
  });
});
