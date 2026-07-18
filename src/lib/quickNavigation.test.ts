import { describe, expect, it } from "vitest";
import { filterQuickNavigationItems, getQuickNavigationKeyAction, type QuickNavigationItem } from "./quickNavigation";

const items: QuickNavigationItem[] = [
  { id: "overview", label: "总览", group: "工作台", title: "量化研究工作台", keywords: ["首页"] },
  { id: "market", label: "市场", group: "研究", title: "市场观察", keywords: ["行情"] },
  { id: "strategy", label: "策略", group: "研究", title: "策略实验室", keywords: ["回测"] },
  { id: "account", label: "账户", group: "交易与管理", title: "模拟账户", keywords: ["下单", "订单"] },
  { id: "learning", label: "研究管线", group: "研究", title: "研究管线", keywords: ["学习"] },
  { id: "settings", label: "设置", group: "交易与管理", title: "系统设置", keywords: ["配置"] },
];

describe("快速页面跳转", () => {
  it.each([["首页", "overview"], ["行情", "market"], ["回测", "strategy"], ["下单", "account"], ["学习", "learning"], ["配置", "settings"]])(
    "支持页面名称与工作流关键词：%s", (query, expected) => {
      expect(filterQuickNavigationItems(items, query).map((item) => item.id)).toEqual([expected]);
    },
  );

  it("空查询返回全部页面且匹配忽略大小写和两端空格", () => {
    expect(filterQuickNavigationItems(items, "")).toHaveLength(6);
    expect(filterQuickNavigationItems([{ ...items[1], keywords: ["Market"] }], "  market  ").map((item) => item.id)).toEqual(["market"]);
  });

  it("回车选择首项，Esc 关闭结果，其他按键不处理", () => {
    expect(getQuickNavigationKeyAction("Enter", items.slice(1, 3))).toEqual({ type: "select", id: "market" });
    expect(getQuickNavigationKeyAction("Enter", [])).toEqual({ type: "none" });
    expect(getQuickNavigationKeyAction("Escape", items)).toEqual({ type: "close" });
    expect(getQuickNavigationKeyAction("ArrowDown", items)).toEqual({ type: "none" });
  });
});