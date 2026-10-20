import { describe, expect, it } from "vitest";
import {
  getActiveModuleId,
  getModuleById,
  getModuleHref,
  moduleCatalog,
  parseAccountTab,
  parseLearningSection,
  parseMarketTab,
  parseSettingsSection,
  parseStrategyStage,
} from "./moduleCatalog";

describe("模块目录", () => {
  it("覆盖所有一级页面和主要二级模块", () => {
    expect(new Set(moduleCatalog.map((item) => item.view))).toEqual(new Set([
      "overview",
      "market",
      "strategy",
      "account",
      "learning",
      "settings",
    ]));
    expect(moduleCatalog.filter((item) => item.view === "market")).toHaveLength(11);
    expect(moduleCatalog.filter((item) => item.view === "account")).toHaveLength(8);
    expect(moduleCatalog.filter((item) => item.view === "strategy")).toHaveLength(5);
    expect(moduleCatalog.filter((item) => item.view === "settings")).toHaveLength(4);
    expect(moduleCatalog.filter((item) => item.view === "learning")).toHaveLength(7);
  });

  it("为二级模块生成稳定的深链接", () => {
    expect(getModuleHref(getModuleById("account-orders")!)).toBe("/account?tab=orders");
    expect(getModuleHref(getModuleById("strategy-validate")!)).toBe("/strategy?stage=validate");
    expect(getModuleHref(getModuleById("settings-execution")!)).toBe("/settings?section=execution");
  });

  it("只接受白名单参数，非法值回退默认模块", () => {
    expect(parseAccountTab("?tab=orders")).toBe("orders");
    expect(parseAccountTab("?tab=not-a-tab")).toBe("portfolio");
    expect(parseStrategyStage("?stage=validate")).toBe("validate");
    expect(parseStrategyStage("?stage=closed")).toBe("configure");
    expect(parseMarketTab("?tab=turning")).toBe("turning");
    expect(parseMarketTab("?tab=unknown")).toBe("a-share");
    expect(parseSettingsSection("?section=account")).toBe("account");
    expect(parseSettingsSection("?section=unknown")).toBe("execution");
    expect(parseLearningSection("?section=daily-review")).toBe("daily-review");
    expect(parseLearningSection("?section=unknown")).toBe("pipeline");
  });

  it("根据当前页面和 URL 计算高亮模块", () => {
    expect(getActiveModuleId("account", "?tab=orders")).toBe("account-orders");
    expect(getActiveModuleId("strategy", "?stage=backtest")).toBe("strategy-backtest");
    expect(getActiveModuleId("market", "?tab=events")).toBe("market-events");
    expect(getActiveModuleId("settings", "?section=profile")).toBe("settings-profile");
    expect(getActiveModuleId("learning", "?section=paper-plan")).toBe("learning-paper-plan");
  });
});