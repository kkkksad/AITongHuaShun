import { describe, expect, it } from "vitest";
import { buildResearchInputDiagnostics, describeResearchInputDiagnostics } from "./researchInputDiagnostics";

describe("research input diagnostics", () => {
  const input = {
    sectorOutlooks: [{}, {}],
    stockRegimes: [{ regime: "healthy-trend" }, { regime: "insufficient-data" }],
    warnings: [] as string[],
  };

  it("counts valid historical inputs without treating all returned stocks as usable", () => {
    expect(buildResearchInputDiagnostics(input)).toEqual({
      sectorCount: 2, stockCount: 2, usableStockCount: 1, issues: [],
    });
  });

  it("identifies a provider contract failure without preserving raw error content", () => {
    const result = buildResearchInputDiagnostics({
      sectorOutlooks: [{}, {}, {}, {}, {}, {}], stockRegimes: [],
      warnings: ["stock_zh_a_hist_tx() got an unexpected keyword argument 'timeout' https://x.test/?token=secret"],
    });
    expect(result.issues).toEqual(["provider-contract", "stock-history-insufficient"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(describeResearchInputDiagnostics(result)).toEqual([
      "历史覆盖：6 个板块，0/0 只个股具备足够日线。",
      "历史接口参数与供应商SDK不兼容。",
      "缺少具备足够历史日线的个股。",
    ]);
  });

  it.each([
    ["连接行情桥超时（8000ms）", "provider-timeout"],
    ["历史缓存冷启动中，后台预热", "history-warming"],
    ["2 个历史序列超过队列上限", "history-queue-full"],
    ["行业资金流暂不可用", "provider-warning"],
  ])("classifies %s using fixed messages", (warning, code) => {
    expect(buildResearchInputDiagnostics({ ...input, warnings: [warning] }).issues).toEqual([code]);
  });

  it("bounds classifications and preserves insufficient sector evidence", () => {
    const result = buildResearchInputDiagnostics({
      sectorOutlooks: [{}], stockRegimes: [],
      warnings: Array(100).fill("warming timeout queue limit unexpected keyword argument"),
    });
    expect(result.issues.length).toBeLessThanOrEqual(4);
    expect(describeResearchInputDiagnostics(result)[0]).toContain("1 个板块");
    expect(buildResearchInputDiagnostics({ ...input, sectorOutlooks: [{}] }).issues)
      .toEqual(["sector-history-insufficient"]);
  });

  it.each([undefined, null, {}, { sectorCount: -1 }, {
    sectorCount: 2, stockCount: 1, usableStockCount: 2, issues: [],
  }])("does not fabricate evidence for invalid or legacy diagnostics %j", (value) => {
    expect(describeResearchInputDiagnostics(value)).toEqual([]);
  });

  it("never reflects arbitrary persisted issue text", () => {
    const reasons = describeResearchInputDiagnostics({
      sectorCount: 2, stockCount: 1, usableStockCount: 1,
      issues: ["https://x.test/secret", "provider-timeout", "provider-timeout"],
    });
    expect(reasons).toHaveLength(2);
    expect(reasons.join(" ")).not.toContain("secret");
  });
});
