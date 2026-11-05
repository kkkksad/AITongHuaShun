import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../shared/trading";
import { OrderHistory } from "./OrderHistory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function orders(count: number): OrderRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ORDER-${index}`, symbol: String(600000 + index), name: `目标股票${index}`,
    side: "buy", type: "limit", quantity: 100, status: "pending",
    requestedPrice: 40, limitPrice: 40, filledQuantity: 0, notional: 0, commission: 0,
    createdAt: new Date(Date.UTC(2026, 10, 5, 2, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 10, 5, 2, index)).toISOString(),
  }));
}

describe("OrderHistory live pagination", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onCancelOrder = vi.fn(async () => undefined);

  beforeEach(() => {
    onCancelOrder.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(data: OrderRecord[], pendingAction = false) {
    await act(async () => { root.render(<OrderHistory orders={data} onCancelOrder={onCancelOrder} pendingAction={pendingAction} />); });
  }

  const visibleNames = () => Array.from(container.querySelectorAll(".symbol-cell strong"), (node) => node.textContent);
  const pageText = () => container.querySelector(".pagination-info")?.textContent;
  function button(text: string) {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((element) => element.textContent === text)!;
  }
  async function click(text: string) { await act(async () => button(text).click()); }
  async function select(index: number, value: string) {
    await act(async () => {
      const element = container.querySelectorAll("select")[index];
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function search(value: string) {
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(".search-label input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows the remaining pending orders when the sole last-page order fills", async () => {
    const initial = orders(16);
    await render(initial);
    await select(0, "pending");
    await click("下一页");
    expect(visibleNames()).toEqual(["目标股票0"]);
    expect(pageText()).toContain("第 2 / 2 页");
    await render(initial.map((order, index) => index === 0 ? { ...order, status: "filled", filledQuantity: 100 } : order));
    expect(visibleNames()).toHaveLength(15);
    expect(visibleNames()[0]).toBe("目标股票15");
    expect(container.querySelector(".empty-row")).toBeNull();
    expect(container.querySelector(".pagination-bar")).toBeNull();
    expect(container.querySelectorAll("select")[0].value).toBe("pending");
  });

  it("clamps the rendered rows and page label before passive effects run", async () => {
    const commits: Array<{ names: Array<string | null>; page: string | null | undefined }> = [];
    function Observe({ data }: { data: OrderRecord[] }) {
      useLayoutEffect(() => { commits.push({ names: visibleNames(), page: pageText() }); }, [data]);
      return <OrderHistory orders={data} />;
    }
    await act(async () => { root.render(<Observe data={orders(46)} />); });
    await click("末页");
    expect(pageText()).toContain("第 4 / 4 页");
    await act(async () => { root.render(<Observe data={orders(16)} />); });
    expect(commits.at(-1)?.names).toEqual(["目标股票0"]);
    expect(commits.at(-1)?.page).toContain("第 2 / 2 页");
    await click("上一页");
    expect(pageText()).toContain("第 1 / 2 页");
    expect(visibleNames()).toHaveLength(15);
    expect(button("首页").disabled).toBe(true);
    expect(button("下一页").disabled).toBe(false);
  });

  it("does not return to an obsolete last page after orders are cleared and regrow", async () => {
    await render(orders(31));
    await click("末页");
    expect(visibleNames()).toEqual(["目标股票0"]);
    await render([]);
    expect(container.querySelector(".empty-row")?.textContent).toContain("暂无匹配");
    await render(orders(31));
    expect(pageText()).toContain("第 1 / 3 页");
    expect(visibleNames()).toHaveLength(15);
    expect(visibleNames()[0]).toBe("目标股票30");
  });

  it("keeps a valid history page when new orders arrive", async () => {
    await render(orders(31));
    await click("下一页");
    await render(orders(32));
    expect(pageText()).toContain("第 2 / 3 页");
    expect(visibleNames()[0]).toBe("目标股票16");
    expect(visibleNames()).toHaveLength(15);
  });

  it("retains search, status, side and sort while moving to a valid last page", async () => {
    const initial = orders(31);
    await render(initial);
    await select(0, "pending");
    await select(1, "buy");
    await search("目标");
    await click("最新");
    await click("末页");
    expect(visibleNames()).toEqual(["目标股票30"]);
    await render(initial.map((order, index) => index >= 16 ? { ...order, status: "filled" } : order));
    expect(pageText()).toContain("第 2 / 2 页");
    expect(visibleNames()).toEqual(["目标股票15"]);
    expect(container.querySelectorAll("select")[0].value).toBe("pending");
    expect(container.querySelectorAll("select")[1].value).toBe("buy");
    expect(container.querySelector<HTMLInputElement>(".search-label input")!.value).toBe("目标");
    expect(button("最早").title).toBe("最早在前");
  });

  it("cancels the currently displayed order after clamping and honors pending actions", async () => {
    await render(orders(31));
    await click("末页");
    await render(orders(16));
    expect(visibleNames()).toEqual(["目标股票0"]);
    await click("撤单");
    expect(onCancelOrder).toHaveBeenCalledTimes(1);
    expect(onCancelOrder).toHaveBeenCalledWith("ORDER-0");
    await render(orders(16), true);
    expect(button("撤单").disabled).toBe(true);
    await click("撤单");
    expect(onCancelOrder).toHaveBeenCalledTimes(1);
  });

  it("exports the complete sorted filtered result rather than only the current page", async () => {
    const matching = orders(31);
    const excluded: OrderRecord[] = [
      { ...matching[0], id: "EXCLUDED-FILLED", status: "filled" },
      { ...matching[0], id: "EXCLUDED-SELL", side: "sell" },
      { ...matching[0], id: "EXCLUDED-SEARCH", name: "其它股票", symbol: "000001" },
    ];
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:test-orders"; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render([...matching, ...excluded]);
    await select(0, "pending");
    await select(1, "buy");
    await search("目标");
    await click("最新");
    await click("末页");
    expect(visibleNames()).toHaveLength(1);
    await click("导出");
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(32);
    expect(lines[0]).toContain("ID,代码,名称");
    expect(lines[1]).toMatch(/^ORDER-0,/);
    expect(lines.at(-1)).toMatch(/^ORDER-30,/);
    expect(csv).not.toContain("EXCLUDED");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-orders");
  });
});
