import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LogViewer", () => {
  it("uses server pagination and pauses automatic refresh on history pages", () => {
    const source = readFileSync("src/components/LogViewer.tsx", "utf8");

    expect(source).toContain("const LOG_PAGE_SIZE = 50;");
    expect(source).toContain('offset: String((page - 1) * LOG_PAGE_SIZE)');
    expect(source).toContain("if (!autoRefresh || page !== 1) return;");
    expect(source).toContain("data.pageCount");
    expect(source).toContain('aria-label={iszh ? "日志上一页" : "Previous log page"}');
    expect(source).toContain('aria-label={iszh ? "日志下一页" : "Next log page"}');
    expect(source).toContain('iszh ? "导出当前页 JSON" : "Export current page as JSON"');
  });
});
