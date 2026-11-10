import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaperHistoryArchiveReport, PaperHistoryEvidence } from "../../shared/paperHistory";
import { PaperHistoryArchiveContent } from "./PaperHistoryArchivePanel";

const evidence: PaperHistoryEvidence = {
  schemaVersion: 1, accountId: "PAPER-CN-01", generatedAt: "2026-11-09T15:00:00Z",
  firstObservedAt: "2026-11-09T14:00:00Z", lastObservedAt: "2026-11-09T15:00:00Z",
  window: { fromDate: "2026-11-03", toDate: "2026-11-09" }, runCount: 8, openSessionRuns: 0,
  unknownSessionRuns: 6, submittedAttempts: 2, submissionEvidenceRuns: 5,
  days: [{ date: "2026-11-09", runs: 8, openRuns: 0, unknownSessionRuns: 6, submittedAttempts: 2, submissionEvidenceRuns: 5 }],
  blockers: [{ code: "cash-check", count: 11 }], issues: [{ code: "history-warming", count: 3 }], latestRuns: [],
};
const render = (state: PaperHistoryArchiveReport["state"], data: PaperHistoryEvidence | null = evidence) =>
  renderToStaticMarkup(createElement(PaperHistoryArchiveContent, { report: { state, data }, isFetching: false, onRefresh() {} }));

describe("Paper archive evidence presentation", () => {
  const run = { occurredAt: "2026-11-09T14:00:00Z", session: "open" as const, phase: null,
    regime: null, planQuality: null, sourceStatus: null, submittedOrders: null, skippedOperations: null,
    blockers: {}, issues: [] };
  const funnel = { scope: "ranked-top-12" as const, scannerCandidateCount: 18, consideredCandidateCount: 12,
    existingPositionCount: 4, newSymbolCount: 8, eligibleNewSymbolCount: 5,
    individuallySizedNewSymbolCount: 2, plannedBuyCount: 1, allowNewPositions: false };
  it("shows separate recorded new-symbol funnel counts and the global permission", () => {
    const html = render("ready", { ...evidence, latestRuns: [{ ...run, newPositionFunnel: funnel }] });
    expect(html).toContain("最近新增标的漏斗");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = [...doc.querySelectorAll("table")].find(t => t.caption?.textContent?.includes("最近新增标的漏斗"))!;
    expect([...table.querySelectorAll("tbody td")].slice(1).map(c => c.textContent))
      .toEqual(["18", "12", "4", "8", "5", "2", "1", "不允许新增"]);
    expect(html).toContain("拟买不是提交或成交");
    expect(html).toContain("独立金额");
  });
  it("keeps old funnel evidence unknown and actual zero distinct from missing counts", () => {
    const zero = Object.fromEntries(Object.entries(funnel).map(([key, value]) => [key, typeof value === "number" ? 0 : value]));
    const html = render("stale", { ...evidence, latestRuns: [run, { ...run, newPositionFunnel: zero as typeof funnel }] });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = [...doc.querySelectorAll("table")].find(t => t.caption?.textContent?.includes("最近新增标的漏斗"))!;
    expect([...table.querySelectorAll("tbody tr")][0].textContent).toContain("未知");
    expect([...table.querySelectorAll("tbody tr")][1].textContent).toContain("不允许新增");
    expect([...table.querySelectorAll("tbody tr")][1].querySelectorAll("td")[1].textContent).toBe("0");
    expect(html).toContain("归档已过期");
  });
  it("bounds funnel rows to twenty and hides prior-account funnel evidence", () => {
    const data = { ...evidence, latestRuns: Array.from({ length: 21 }, () => ({ ...run, newPositionFunnel: funnel })) };
    const html = render("ready", data), doc = new DOMParser().parseFromString(html, "text/html");
    const table = [...doc.querySelectorAll("table")].find(t => t.caption?.textContent?.includes("最近新增标的漏斗"))!;
    expect(table.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(render("waiting-for-account", data)).not.toContain("最近新增标的漏斗");
  });
  it("shows bounded recent run timings and keeps zero distinct from an unmeasured stage", () => {
    const html = render("ready", { ...evidence, latestRuns: [{ occurredAt: "2026-11-09T14:00:00Z", session: "open",
      phase: null, regime: null, planQuality: null, sourceStatus: null, submittedOrders: 0, skippedOperations: 1,
      blockers: {}, issues: [], timing: { clock: "monotonic", scope: "run-before-audit", unit: "ms",
        totalMs: 1234, researchMs: 1200, notificationMs: null, executionMs: 0 } }] });
    expect(html).toContain("最近运行耗时");
    expect(html).toContain("1.234 秒");
    expect(html).toContain("0 毫秒");
    expect(html).toContain("未知");
    expect(html).toContain("记录间隔");
  });
  it("does not reconstruct old timings from record timestamps", () => {
    const html = render("stale", { ...evidence, latestRuns: [{ occurredAt: "2026-11-09T14:00:00Z", session: null,
      phase: null, regime: null, planQuality: null, sourceStatus: null, submittedOrders: null, skippedOperations: null,
      blockers: {}, issues: [] }] });
    expect(html).toContain("最近运行耗时");
    expect(html).toContain("未知");
    expect(html).not.toContain("0 毫秒");
    expect(html).toContain("归档已过期");
  });
  it("shows the actual window, coverage and submission evidence without calling attempts fills", () => {
    const html = render("ready");
    expect(html).toContain("2026-11-03 — 2026-11-09");
    expect(html).toContain("已记录提交尝试");
    expect(html).toContain("5 / 8");
    expect(html).toContain("现金检查");
    expect(html).toContain("历史预热");
    expect(html).not.toContain("已成交 2");
  });
  it("does not call zero confirmed open-session coverage a strategy signal failure", () => {
    const html = render("ready");
    expect(html).toContain("没有可确认的盘中运行证据");
    expect(html).toContain("部分旧记录的会话未知");
    expect(html).not.toContain("策略无信号导致零成交");
  });
  it("keeps stale counts visibly stale", () => {
    const html = render("stale");
    expect(html).toContain("归档已过期");
    expect(html).toContain("5 / 8");
    expect(html).toContain("2026-11-03");
  });
  it.each([
    ["waiting-for-account", "等待当前账户归档"],
    ["unavailable", "归档暂不可用"],
    ["disabled", "长期归档未接入"],
  ] as const)("hides any previous evidence in %s state", (state, text) => {
    const html = render(state);
    expect(html).toContain(text);
    expect(html).not.toContain("5 / 8");
    expect(html).not.toContain("2026-11-03");
  });
});
