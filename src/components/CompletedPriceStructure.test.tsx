import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompletedPriceStructure } from "./CompletedPriceStructure";

const context = { symbol: "600001", latestDate: "2026-11-13", barCount: 80, generatedAt: "2026-11-13T08:00:00.000Z" };
function evidence() {
  return {
    symbol: context.symbol, latestDate: context.latestDate, barCount: 80, requiredBars: 61,
    source: "frozen-price-test", adjustment: "qfq", asOf: "2026-11-13T07:30:00.000Z",
    scope: "completed-qfq-daily-structure-not-live-intraday-signal-or-trade-permission",
    status: "observed", observed: true,
    validation: { invalidBars: 0, duplicateBars: 0, excludedIncompleteOrFutureBars: 1, trimmedBars: 0 },
    breakout: { resistanceWindowBars: 20, priorHigh20: 12, priorHighDate: "2026-11-02",
      latestClose: 11, latestDayHigh: 11.9, closesAbovePriorHigh20: false },
    pullback: { lowDate: "2026-11-12", low: 10, priorAnchorHighDate: "2026-11-02", priorAnchorHigh20: 12,
      pullbackFromPriorAnchor: 1 - 10 / 12, recoveredFromLow: 11 / 10 - 1,
      previousDayHigh: 10.8, latestCloseAbovePreviousDayHigh: true, recoveryAfterLow: true,
      lowCompletedVolumeRatio20: 0.7 as number | null },
  };
}
function render(value: unknown = evidence(), overrides: Partial<typeof context> = {}) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(CompletedPriceStructure, { value, ...context, ...overrides }));
  return root;
}
function withPrices(close: number, high: number) {
  const value = evidence(); value.breakout.latestClose = close; value.breakout.latestDayHigh = high;
  value.breakout.closesAbovePriorHigh20 = close > 12;
  value.pullback.recoveredFromLow = close / 10 - 1;
  value.pullback.latestCloseAbovePreviousDayHigh = close > 10.8;
  return value;
}

describe("completed price observations", () => {
  it.each([
    [12.1, 12.3, "突破待持续确认"],
    [11.9, 12.3, "冲高未站稳"],
    [12, 12.3, "冲高未站稳"],
    [12, 12, "未越过前20日高点"],
    [11, 11.9, "未越过前20日高点"],
  ])("describes close %s and high %s against an earlier resistance", (close, high, label) => {
    const root = render(withPrices(close, high));
    expect(root.querySelector('[data-observation="breakout"]')?.textContent).toContain(label);
    expect(root.textContent).toContain("前20日高点 ¥12.0000");
    expect(root.textContent).toContain("2026-11-02");
  });

  it("requires subsequent recovery, reduced volume and the previous high together", () => {
    const root = render();
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤后恢复线索");
    expect(root.textContent).toContain("0.70");
    expect(root.textContent).toContain("2026-11-12");
    expect(root.textContent).toContain("16.7%");
  });

  it.each([null, 0, 1, 1.1])("does not label volume ratio %s as reduced volume recovery", ratio => {
    const value = evidence(); value.pullback.lowCompletedVolumeRatio20 = ratio;
    const root = render(value);
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤恢复条件未齐");
    expect(root.textContent).not.toContain("回撤后恢复线索");
    if (ratio === null || ratio === 0) expect(root.textContent).toContain("低点量比未知");
  });

  it("does not call a close equal to the previous high a recovery confirmation", () => {
    const root = render(withPrices(10.8, 11.9));
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤恢复条件未齐");
  });

  it("preserves historical source and cutoff when report generation is later", () => {
    const root = render(evidence(), { generatedAt: "2026-11-14T12:00:00.000Z" });
    expect(root.textContent).toContain("frozen-price-test");
    expect(root.textContent).toContain("2026-11-13");
    expect(root.textContent).toContain("15:30:00");
    expect(root.textContent).not.toContain("2026-11-14");
    expect(root.textContent).toContain("北京时间");
    expect(root.textContent).toContain("不是实时信号、胜率或交易许可");
    expect(root.querySelector("details")?.open).toBe(false);
    expect(root.querySelector("button,form,a,input")).toBeNull();
  });

  it.each([undefined, null, [], "legacy", { status: "insufficient-history", observed: false }])
    ("keeps legacy or unavailable evidence unknown: %s", value => {
      // Pass undefined explicitly through createElement instead of the render fixture default.
      const html = renderToStaticMarkup(createElement(CompletedPriceStructure, { value, ...context }));
      expect(html).toContain("完成日线结构未知");
      expect(html).not.toContain("回撤后恢复线索");
    });

  it.each([
    ["wrong stock", (v: ReturnType<typeof evidence>) => { v.symbol = "600002"; }],
    ["wrong adjustment", (v: ReturnType<typeof evidence>) => { v.adjustment = "none"; }],
    ["blank source", (v: ReturnType<typeof evidence>) => { v.source = " "; }],
    ["scope mismatch", (v: ReturnType<typeof evidence>) => { v.scope = "intraday"; }],
    ["invalid bars", (v: ReturnType<typeof evidence>) => { v.validation.invalidBars = 1; }],
    ["duplicate bars", (v: ReturnType<typeof evidence>) => { v.validation.duplicateBars = 1; }],
    ["invalid counters", (v: ReturnType<typeof evidence>) => { v.validation.trimmedBars = -1; }],
    ["count mismatch", (v: ReturnType<typeof evidence>) => { v.barCount = 79; }],
    ["uncompleted day", (v: ReturnType<typeof evidence>) => { v.asOf = "2026-11-13T06:59:59.999Z"; }],
    ["future cutoff", (v: ReturnType<typeof evidence>) => { v.asOf = "2026-11-13T08:00:00.001Z"; }],
    ["invalid date", (v: ReturnType<typeof evidence>) => { v.latestDate = "2026-02-30"; }],
    ["invalid clock", (v: ReturnType<typeof evidence>) => { v.asOf = "bad"; }],
  ])("rejects common observation identity/boundary: %s", (_name, mutate) => {
    const value = evidence(); mutate(value); const root = render(value);
    expect(root.textContent).toContain("完成日线结构未知");
    expect(root.querySelector("details")).toBeNull();
    expect(root.textContent).not.toMatch(/NaN|Infinity/);
  });

  it.each([NaN, Infinity, -1, 0])("keeps invalid breakout price %s unknown independently", price => {
    const value = evidence(); value.breakout.priorHigh20 = price; const root = render(value);
    expect(root.querySelector('[data-observation="breakout"]')?.textContent).toContain("突破证据未知");
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤后恢复线索");
    expect(root.textContent).not.toMatch(/NaN|Infinity/);
  });

  it.each([
    (v: ReturnType<typeof evidence>) => { v.breakout.closesAbovePriorHigh20 = true; },
    (v: ReturnType<typeof evidence>) => { v.breakout.latestClose = 12.5; },
    (v: ReturnType<typeof evidence>) => { v.breakout.priorHighDate = context.latestDate; },
  ])("rejects inconsistent breakout fields", mutate => {
    const value = evidence(); mutate(value);
    expect(render(value).querySelector('[data-observation="breakout"]')?.textContent).toContain("突破证据未知");
  });

  it.each([
    (v: ReturnType<typeof evidence>) => { v.pullback.lowDate = context.latestDate; },
    (v: ReturnType<typeof evidence>) => { v.pullback.priorAnchorHighDate = v.pullback.lowDate; },
    (v: ReturnType<typeof evidence>) => { v.pullback.recoveredFromLow = 0.9; },
    (v: ReturnType<typeof evidence>) => { v.pullback.pullbackFromPriorAnchor = 0.9; },
    (v: ReturnType<typeof evidence>) => { v.pullback.latestCloseAbovePreviousDayHigh = false; },
    (v: ReturnType<typeof evidence>) => { v.pullback.recoveryAfterLow = false; },
    (v: ReturnType<typeof evidence>) => { v.pullback.lowCompletedVolumeRatio20 = Infinity; },
  ])("rejects inconsistent pullback fields without hiding valid price evidence", mutate => {
    const value = evidence(); mutate(value); const root = render(value);
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤证据未知");
    expect(root.querySelector('[data-observation="breakout"]')?.textContent).toContain("未越过前20日高点");
  });

  it("retains independent breakout evidence with a missing pullback section", () => {
    const value = { ...evidence(), pullback: undefined }; const before = structuredClone(value); const root = render(value);
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤证据未知");
    expect(root.querySelector('[data-observation="breakout"]')?.textContent).toContain("未越过前20日高点");
    expect(value).toEqual(before);
  });

  it("does not derive pullback evidence from a close that exceeds its daily high", () => {
    const value = withPrices(12.5, 11.9); const root = render(value);
    expect(root.querySelector('[data-observation="breakout"]')?.textContent).toContain("突破证据未知");
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤证据未知");
  });

  it("keeps finite-price arithmetic overflow unknown", () => {
    const value = evidence(); value.pullback.low = 1e308; value.pullback.priorAnchorHigh20 = 1;
    value.pullback.pullbackFromPriorAnchor = -1e308; value.pullback.recoveredFromLow = -1;
    const root = render(value);
    expect(root.querySelector('[data-observation="pullback"]')?.textContent).toContain("回撤证据未知");
    expect(root.textContent).not.toMatch(/NaN|Infinity/);
  });
});
