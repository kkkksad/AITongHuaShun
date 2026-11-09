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
