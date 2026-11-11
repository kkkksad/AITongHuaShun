import { describe, expect, it } from "vitest";
import { buildResearchInputDiagnostics, describeResearchInputDiagnostics } from "./researchInputDiagnostics";

const base = { sectorOutlooks: [{}, {}], stockRegimes: [{ regime: "healthy-trend" }], warnings: [] as string[] };

describe("mixed research warning evidence", () => {
  it.each([
    [base, ["桥接请求超时", "行业资金流暂不可用"], ["provider-timeout", "provider-warning"]],
    [{ ...base, stockRegimes: [] }, ["行业资金流暂不可用"], ["stock-history-insufficient", "provider-warning"]],
    [{ ...base, sectorOutlooks: [{}] }, ["行情可选字段无效"], ["sector-history-insufficient", "provider-warning"]],
    [base, ["历史缓存预热中", "行业资金流暂不可用"], ["history-warming", "provider-warning"]],
    [base, ["历史队列上限", "行业资金流暂不可用"], ["history-queue-full", "provider-warning"]],
  ])("retains unknown warnings alongside recognized or coverage issues: %j", (input, warnings, issues) => {
    expect(buildResearchInputDiagnostics({ ...input, warnings }).issues).toEqual(issues);
  });

  it("does not treat timeout parameter contract errors as a transport timeout", () => {
    expect(buildResearchInputDiagnostics({ ...base, warnings: ["unexpected keyword argument 'timeout'", "其他供应商警告"] }).issues)
      .toEqual(["provider-contract", "provider-warning"]);
  });

  it("keeps the generic marker in the four-slot budget with independent coverage counts", () => {
    const result = buildResearchInputDiagnostics({ sectorOutlooks: [], stockRegimes: [],
      warnings: ["unexpected keyword argument", "request timed out", "warming", "queue full", "其他错误"] });
    expect(result).toEqual({ sectorCount: 0, stockCount: 0, usableStockCount: 0,
      issues: ["provider-contract", "provider-timeout", "history-warming", "provider-warning"] });
    expect(describeResearchInputDiagnostics(result)[0]).toBe("历史覆盖：0 个板块，0/0 只个股具备足够日线。");
  });

  it("marks uninspected warning rows without scanning beyond the eight-row budget", () => {
    const warnings = Array(8).fill("request timeout");
    Object.defineProperty(warnings, 8, { get() { throw Error("must not inspect ninth warning"); } });
    expect(buildResearchInputDiagnostics({ ...base, warnings }).issues).toEqual(["provider-timeout", "provider-warning"]);
  });

  it("marks character truncation even when the inspected prefix has a known class", () => {
    expect(buildResearchInputDiagnostics({ ...base, warnings: ["timeout " + "x".repeat(2100)] }).issues)
      .toEqual(["provider-timeout", "provider-warning"]);
  });

  it("keeps internally generated insufficient-history warnings explained by their counts", () => {
    expect(buildResearchInputDiagnostics({ sectorOutlooks: [], stockRegimes: [],
      warnings: ["没有板块具备至少 61 根有效日线。", "没有候选股票具备至少 61 根有效历史日线。"] }).issues)
      .toEqual(["sector-history-insufficient", "stock-history-insufficient"]);
  });

  it("does not trust an insufficient-history message when corresponding counts are healthy", () => {
    expect(buildResearchInputDiagnostics({ ...base, warnings: ["没有候选股票具备至少 61 根有效历史日线。"] }).issues)
      .toEqual(["provider-warning"]);
  });

  it("deduplicates unknown warning markers and never reflects raw text or mutates input", () => {
    const warnings = ["timeout", "https://provider.test/?token=SECRET_A", "SECRET_B other warning"];
    const before = JSON.stringify(warnings);
    const result = buildResearchInputDiagnostics({ ...base, warnings });
    expect(result.issues).toEqual(["provider-timeout", "provider-warning"]);
    expect(JSON.stringify(describeResearchInputDiagnostics(result))).not.toMatch(/SECRET|provider\.test/);
    expect(JSON.stringify(warnings)).toBe(before);
  });

  it("retains original classes when every inspected warning is recognized", () => {
    expect(buildResearchInputDiagnostics({ ...base, warnings: ["timeout", "warming", "queue full"] }).issues)
      .toEqual(["provider-timeout", "history-warming", "history-queue-full"]);
  });
});
