import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaperPortfolioRiskEvidence } from "../../shared/paperPortfolioRisk";
import { PaperPortfolioRiskPanel } from "./PaperPortfolioRiskPanel";

function evidence(): PaperPortfolioRiskEvidence {
  return { scope: "current-filled-holdings", valuationAsOf: "2026-04-01T07:01:00Z",
    historyAsOf: "2026-04-01T07:00:00Z", holdingsMarketValue: 2000, investedRatio: 0.1,
    valuationStatus: "available", holdingCount: 2, omittedHoldingCount: 0, historyAvailableHoldingCount: 2,
    totalPairCount: 1, observedPairCount: 1,
    holdings: ["600010", "600011"].map((symbol, i) => ({ symbol, name: ["甲银行", "乙银行"][i],
      marketValue: 1000, accountWeight: 0.05, stockWeight: 0.5, historyBarCount: 80, historySource: "frozen-test" })),
    pairs: [{ left: "600010", right: "600011", samples: 79, correlation: 0.86, status: "observed",
      firstInterval: { startDate: "2026-01-01", endDate: "2026-01-02" },
      lastInterval: { startDate: "2026-03-20", endDate: "2026-03-21" }, maxCalendarSpanDays: 1 }],
    industryClassification: "unknown", industryHardLimitEnabled: false, correlationHardLimitEnabled: false };
}
function render(risk?: PaperPortfolioRiskEvidence) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(PaperPortfolioRiskPanel, { risk }));
  return root;
}

describe("Paper portfolio common-risk explanation", () => {
  it("keeps a legacy backend explicitly unknown without issuing any request", () => {
    const root = render();
    expect(root.textContent).toContain("尚未提供组合共同风险证据");
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
  });

  it("separates portfolio exposure and stock-only weights and labels correlation as historical", () => {
    const root = render(evidence());
    expect(root.textContent).toContain("股票市值占当前权益 10.0%");
    expect(root.textContent).toContain("占账户权益");
    expect(root.textContent).toContain("占股票市值");
    expect(root.textContent).toContain("5.0%");
    expect(root.textContent).toContain("50.0%");
    expect(root.textContent).toContain("0.86");
    expect(root.textContent).toContain("79");
    expect(root.textContent).toContain("2026-01-01");
    expect(root.textContent).toContain("2026-03-21");
    expect(root.textContent).toContain("历史相关性不是胜率");
    expect(root.textContent).toContain("不含挂单和拟买");
    expect(root.textContent).toContain("行业分类尚未核实");
    expect(root.querySelector("details")?.open).toBe(false);
  });

  it.each(["missing-history", "insufficient-history", "undefined-variance"] as const)("does not turn %s into zero or independent risk", status => {
    const risk = evidence(); risk.pairs[0] = { ...risk.pairs[0], status, correlation: null };
    const root = render(risk);
    expect(root.textContent).not.toContain("0.00");
    expect(root.textContent).toContain({ "missing-history": "缺少匹配历史", "insufficient-history": "共同区间不足60", "undefined-variance": "收益方差为零或不可计算" }[status]);
  });

  it("reports unknown timestamps and proportions without NaN or Infinity", () => {
    const risk = evidence(); risk.historyAsOf = null; risk.valuationAsOf = "bad"; risk.investedRatio = null;
    risk.holdingsMarketValue = null; risk.valuationStatus = "invalid";
    risk.holdings[0] = { ...risk.holdings[0], marketValue: null, accountWeight: null, stockWeight: null,
      historySource: null, historyBarCount: null };
    const root = render(risk);
    expect(root.textContent).toContain("未知");
    expect(root.textContent).not.toMatch(/NaN|Infinity/);
    expect(root.textContent).toContain("存在无效或重复估值");
  });

  it("shows omitted rows and total pairing scope instead of implying complete coverage", () => {
    const risk = evidence(); risk.holdingCount = 13; risk.omittedHoldingCount = 1; risk.totalPairCount = 78;
    const root = render(risk);
    expect(root.textContent).toContain("另有 1 行未展示");
    expect(root.textContent).toContain("1/78 对");
    expect(root.textContent).toContain("分母包含全部持仓");
  });

  it("does not mutate evidence or expose a buy/sell control", () => {
    const risk = evidence(); const before = structuredClone(risk); const root = render(risk);
    expect(risk).toEqual(before);
    expect(root.querySelector("button,form,a,input")).toBeNull();
    expect(root.querySelectorAll("[role=region]")).toHaveLength(2);
  });
});
