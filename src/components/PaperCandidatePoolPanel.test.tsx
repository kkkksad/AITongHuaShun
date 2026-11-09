import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PaperCandidatePool } from "../../shared/paperCandidatePool";
import { PaperCandidatePoolPanel } from "./PaperCandidatePoolPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
function render(pool?: PaperCandidatePool) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<PaperCandidatePoolPanel pool={pool} />));
  return container;
}
const pool: PaperCandidatePool = {
  total: 3, omitted: 0,
  counts: { observation: 1, "pending-confirmation": 1, executable: 1, holding: 0, "holding-exit": 0 },
  rows: [
    { symbol: "600001", name: "甲股票", tier: "executable", reason: "信号已形成计划", reasonSource: "symbol-plan", nextCheck: "提交前重查行情与风控" },
    { symbol: "600002", name: "乙股票", tier: "pending-confirmation", reason: "全局额度已用完", reasonSource: "global-plan", nextCheck: "下一轮重查额度" },
    { symbol: "600003", name: "丙股票", tier: "observation", reason: "尚无逐股计划", reasonSource: "unassessed", nextCheck: "后续扫描重查" },
  ],
};
describe("Paper candidate pool", () => {
  it("shows exact counts and separates plan readiness from execution, with per-row evidence", () => {
    const view = render(pool);
    expect(view.textContent).toContain("全部 3");
    expect(view.textContent).toContain("买入计划就绪 1");
    expect(view.textContent).toContain("待确认区 1");
    expect(view.textContent).toContain("计划就绪仍须提交前复核");
    expect(view.textContent).toContain("全局计划限制");
    expect(view.textContent).toContain("提交前重查行情与风控");
  });
  it("filters without changing counts and provides an empty state for an empty tier", () => {
    const view = render(pool);
    const pending = [...view.querySelectorAll("button")].find((button) => button.textContent === "待确认区 1")!;
    act(() => pending.click());
    expect(pending.getAttribute("aria-pressed")).toBe("true");
    expect(view.querySelector("table")?.textContent).toContain("乙股票");
    expect(view.querySelector("table")?.textContent).not.toContain("甲股票");
    act(() => [...view.querySelectorAll("button")].find((button) => button.textContent === "持仓区 0")!.click());
    expect(view.textContent).toContain("本分区暂无候选");
    expect(view.textContent).toContain("全部 3");
  });
  it("does not turn a legacy report without a pool into an invented zero", () => {
    const view = render();
    expect(view.textContent).toContain("此报告尚无完整候选分区");
    expect(view.textContent).not.toContain("全部 0");
  });
  it("states omitted detail counts separately from full pool totals", () => {
    const view = render({ ...pool, total: 8, omitted: 5, counts: { ...pool.counts, observation: 6 } });
    expect(view.textContent).toContain("全部 8");
    expect(view.textContent).toContain("另有 5 只未展示明细");
  });
});
