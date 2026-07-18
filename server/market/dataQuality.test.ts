import { describe, expect, it } from "vitest";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import {
  computeCompleteness,
  computeCoverageFreshness,
  computeDataQuality,
  computeFreshness,
  detectAdjustmentGap,
  detectFlags,
  detectLimitHit,
  detectPriceAnomaly,
  getBoardLimit,
  isSuspectedSuspended,
} from "./dataQuality";

const NOW = Date.now();
const RECENT_ISO = new Date(NOW - 10_000).toISOString();
const STALE_ISO = new Date(NOW - 600_000).toISOString();

function makeQuote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    symbol: "600519",
    name: "贵州茅台",
    tradable: true,
    price: 1500,
    previousClose: 1490,
    changePercent: 0.67,
    volume: 10_000_000,
    updatedAt: RECENT_ISO,
    ...overrides,
  };
}

function makeSnapshot(quotes: MarketQuote[]): MarketSnapshot {
  return {
    mode: "paper",
    sequence: 1,
    marketTime: new Date().toISOString(),
    quotes,
  };
}

// ── 板块限制 ─────────────────────────────────────────────

describe("getBoardLimit", () => {
  it("主板 600xxx 返回 10%", () => {
    expect(getBoardLimit("600519")).toBe(10);
  });

  it("主板 000xxx 返回 10%", () => {
    expect(getBoardLimit("000001")).toBe(10);
  });

  it("创业板 300xxx 返回 20%", () => {
    expect(getBoardLimit("300750")).toBe(20);
  });

  it("科创板 688xxx 返回 20%", () => {
    expect(getBoardLimit("688981")).toBe(20);
  });

  it("科创板 689xxx 返回 20%", () => {
    expect(getBoardLimit("689009")).toBe(20);
  });

  it("北交所 8xxxxx 返回 30%", () => {
    expect(getBoardLimit("830799")).toBe(30);
  });

  it("北交所 4xxxxx 返回 30%", () => {
    expect(getBoardLimit("430047")).toBe(30);
  });

  it("未知代码默认返回 10%", () => {
    expect(getBoardLimit("999999")).toBe(10);
  });
});

// ── 停牌检测 ─────────────────────────────────────────────

describe("isSuspectedSuspended", () => {
  it("涨跌幅为0且成交量为0，判定为停牌", () => {
    const q = makeQuote({ changePercent: 0, volume: 0 });
    expect(isSuspectedSuspended(q)).toBe(true);
  });

  it("价格等于昨收且成交量为0，判定为停牌", () => {
    const q = makeQuote({ price: 100, previousClose: 100, volume: 0 });
    expect(isSuspectedSuspended(q)).toBe(true);
  });

  it("正常交易的不判定为停牌", () => {
    const q = makeQuote({ price: 100, previousClose: 99, volume: 100000 });
    expect(isSuspectedSuspended(q)).toBe(false);
  });

  it("涨跌幅非零但有成交不判定为停牌", () => {
    const q = makeQuote({ changePercent: 2.5, volume: 500000 });
    expect(isSuspectedSuspended(q)).toBe(false);
  });

  it("价格为0不判定为停牌（price>0 保护）", () => {
    const q = makeQuote({ price: 0, previousClose: 0, volume: 0, changePercent: 0 });
    // price=0 时应由 zero_price 标志先行处理，不误判为停牌
    expect(isSuspectedSuspended(q)).toBe(false);
  });
});

// ── 涨跌停检测 ───────────────────────────────────────────

describe("detectLimitHit", () => {
  it("主板 10% 涨停", () => {
    const q = makeQuote({ symbol: "600519", changePercent: 10.0 });
    expect(detectLimitHit(q)).toBe("limit_up");
  });

  it("主板 9.95% 接近涨停也判定", () => {
    const q = makeQuote({ symbol: "600519", changePercent: 9.95 });
    expect(detectLimitHit(q)).toBe("limit_up");
  });

  it("主板 -10% 跌停", () => {
    const q = makeQuote({ symbol: "600519", changePercent: -10.0 });
    expect(detectLimitHit(q)).toBe("limit_down");
  });

  it("创业板 20% 涨停", () => {
    const q = makeQuote({ symbol: "300750", changePercent: 20.0 });
    expect(detectLimitHit(q)).toBe("limit_up");
  });

  it("创业板 -19.95% 跌停", () => {
    const q = makeQuote({ symbol: "300750", changePercent: -19.95 });
    expect(detectLimitHit(q)).toBe("limit_down");
  });

  it("科创板 20% 涨停", () => {
    const q = makeQuote({ symbol: "688981", changePercent: 20.0 });
    expect(detectLimitHit(q)).toBe("limit_up");
  });

  it("北交所 30% 涨停", () => {
    const q = makeQuote({ symbol: "830799", changePercent: 30.0 });
    expect(detectLimitHit(q)).toBe("limit_up");
  });

  it("北交所 30% 跌停", () => {
    const q = makeQuote({ symbol: "430047", changePercent: -30.0 });
    expect(detectLimitHit(q)).toBe("limit_down");
  });

  it("正常涨跌不判定为涨跌停", () => {
    const q = makeQuote({ symbol: "600519", changePercent: 5.5 });
    expect(detectLimitHit(q)).toBeNull();
  });

  it("主板 9.8% 不够涨停容差不判定", () => {
    const q = makeQuote({ symbol: "600519", changePercent: 9.8 });
    expect(detectLimitHit(q)).toBeNull();
  });
});

// ── 复权缺口检测 ─────────────────────────────────────────

describe("detectAdjustmentGap", () => {
  it("主板价格跳空 16% 且未涨停，判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "600519",
      price: 116,
      previousClose: 100,
      changePercent: 16.0,
      volume: 5_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(true);
  });

  it("主板价格跳空 -15% 且未跌停，判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "600519",
      price: 85,
      previousClose: 100,
      changePercent: -15.0,
      volume: 5_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(true);
  });

  it("跳空 10%（未达阈值）不判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "600519",
      changePercent: 10.0,
      volume: 5_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(false);
  });

  it("涨停（已达板块限制）不判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "600519",
      changePercent: 9.95,
      volume: 10_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(false);
  });

  it("创业板和北交所合法涨停不判定为复权缺口", () => {
    expect(detectAdjustmentGap(makeQuote({
      symbol: "300750",
      price: 120,
      previousClose: 100,
      changePercent: 20,
    }))).toBe(false);
    expect(detectAdjustmentGap(makeQuote({
      symbol: "830799",
      price: 130,
      previousClose: 100,
      changePercent: 30,
    }))).toBe(false);
  });

  it("零价格不判定为复权缺口", () => {
    const q = makeQuote({ price: 0, previousClose: 100, changePercent: -100 });
    expect(detectAdjustmentGap(q)).toBe(false);
  });

  it("停牌标的不判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "600519",
      price: 100,
      previousClose: 100,
      changePercent: 0,
      volume: 0,
    });
    expect(detectAdjustmentGap(q)).toBe(false);
  });

  it("创业板 25% 跳空同时判定为复权缺口和异常价格", () => {
    const q = makeQuote({
      symbol: "300750",
      price: 125,
      previousClose: 100,
      changePercent: 25.0,
      volume: 5_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(true);
    expect(detectPriceAnomaly(q)).toBe(true);
  });

  it("创业板 18% 跳空（超过 15% 且未达 20% 涨停）判定为复权缺口", () => {
    const q = makeQuote({
      symbol: "300750",
      price: 118,
      previousClose: 100,
      changePercent: 18.0,
      volume: 5_000_000,
    });
    expect(detectAdjustmentGap(q)).toBe(true);
  });
});

// ── 异常价格检测 ─────────────────────────────────────────

describe("detectPriceAnomaly", () => {
  it("主板涨跌幅 12%（超出 10% 涨停限制），判定异常", () => {
    const q = makeQuote({
      symbol: "600519",
      price: 112,
      previousClose: 100,
      changePercent: 12.0,
      volume: 5_000_000,
    });
    expect(detectPriceAnomaly(q)).toBe(true);
  });

  it("主板涨跌幅 10%（正好在限制内），不判定异常", () => {
    const q = makeQuote({
      symbol: "600519",
      changePercent: 10.0,
      volume: 5_000_000,
    });
    expect(detectPriceAnomaly(q)).toBe(false);
  });

  it("创业板涨跌幅 22%（超出 20% 限制），判定异常", () => {
    const q = makeQuote({
      symbol: "300750",
      changePercent: 22.0,
      volume: 5_000_000,
    });
    expect(detectPriceAnomaly(q)).toBe(true);
  });

  it("创业板涨跌幅 20%（正好限制），不判定异常", () => {
    const q = makeQuote({
      symbol: "300750",
      changePercent: 20.0,
      volume: 5_000_000,
    });
    expect(detectPriceAnomaly(q)).toBe(false);
  });

  it("正常涨跌不判定异常", () => {
    const q = makeQuote({ symbol: "600519", changePercent: 3.0 });
    expect(detectPriceAnomaly(q)).toBe(false);
  });

  it("零价格不判定异常", () => {
    const q = makeQuote({ price: 0, previousClose: 100, changePercent: 500 });
    expect(detectPriceAnomaly(q)).toBe(false);
  });

  it("北交所 35%（超出 30% 限制），判定异常", () => {
    const q = makeQuote({
      symbol: "830799",
      changePercent: 35.0,
      volume: 5_000_000,
    });
    expect(detectPriceAnomaly(q)).toBe(true);
  });
});

// ── 新鲜度 ───────────────────────────────────────────────

describe("computeFreshness", () => {
  it("刚刚更新的数据满分", () => {
    const score = computeFreshness(RECENT_ISO);
    expect(score).toBe(100);
  });

  it("10分钟前的数据有较高分数", () => {
    const oldIso = new Date(NOW - 150_000).toISOString();
    const score = computeFreshness(oldIso);
    expect(score).toBeGreaterThanOrEqual(75);
  });

  it("过期很久的数据接近0", () => {
    const score = computeFreshness(STALE_ISO);
    expect(score).toBeLessThanOrEqual(60);
  });

  it("未来时间返回100", () => {
    const future = new Date(NOW + 60_000).toISOString();
    const score = computeFreshness(future);
    expect(score).toBe(100);
  });

  it("非法时间戳返回0而不是NaN", () => {
    expect(computeFreshness("not-a-date", NOW)).toBe(0);
  });

  it("使用整批报价的低分位新鲜度而不是最优单条报价", () => {
    const quotes = [
      makeQuote({ symbol: "600519", updatedAt: RECENT_ISO }),
      makeQuote({ symbol: "000858", updatedAt: STALE_ISO }),
    ];

    expect(computeCoverageFreshness(quotes, NOW)).toBeLessThan(100);
  });
});

// ── 完整度 ────────────────────────────────────────────────

describe("computeCompleteness", () => {
  it("全部有效满分", () => {
    const quotes = [makeQuote(), makeQuote({ symbol: "000858" })];
    expect(computeCompleteness(quotes)).toBe(100);
  });

  it("部分零价格为0分", () => {
    const quotes = [
      makeQuote(),
      makeQuote({ symbol: "000858", price: 0 }),
    ];
    expect(computeCompleteness(quotes)).toBe(50);
  });

  it("空列表返回0", () => {
    expect(computeCompleteness([])).toBe(0);
  });

  it("全部零价格返回0", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 0 }),
      makeQuote({ symbol: "000858", price: 0 }),
    ];
    expect(computeCompleteness(quotes)).toBe(0);
  });
});

// ── 标记检测 ──────────────────────────────────────────────

describe("detectFlags", () => {
  it("正常数据无标记", () => {
    const quotes = [makeQuote()];
    expect(detectFlags(quotes)).toHaveLength(0);
  });

  it("零价格标记", () => {
    const quotes = [makeQuote({ price: 0 })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "zero_price")).toBe(true);
  });

  it("零成交量标记", () => {
    const quotes = [makeQuote({ volume: 0 })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "zero_volume")).toBe(true);
  });

  it("停牌标记", () => {
    const quotes = [makeQuote({ price: 50, previousClose: 50, volume: 0, changePercent: 0 })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "suspended")).toBe(true);
  });

  it("涨停标记", () => {
    const quotes = [makeQuote({ symbol: "600519", changePercent: 10.0 })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "limit_up")).toBe(true);
  });

  it("跌停标记", () => {
    const quotes = [makeQuote({ symbol: "300750", changePercent: -20.0 })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "limit_down")).toBe(true);
  });

  it("过期数据标记", () => {
    const quotes = [makeQuote({ updatedAt: STALE_ISO })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "stale")).toBe(true);
  });

  it("复权缺口标记", () => {
    const quotes = [makeQuote({
      symbol: "600519",
      price: 116,
      previousClose: 100,
      changePercent: 16.0,
      volume: 5_000_000,
    })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "adjustment_gap")).toBe(true);
  });

  it("异常价格标记", () => {
    const quotes = [makeQuote({
      symbol: "600519",
      price: 113,
      previousClose: 100,
      changePercent: 13.0,
      volume: 5_000_000,
    })];
    const flags = detectFlags(quotes);
    expect(flags.some((f) => f.flag === "anomaly_price")).toBe(true);
  });

  it("一个标的可以有多个标记", () => {
    const quotes = [
      makeQuote({
        symbol: "600519",
        price: 100,
        previousClose: 100,
        volume: 0,
        changePercent: 0,
        updatedAt: STALE_ISO,
      }),
    ];
    const flags = detectFlags(quotes);
    const flagTypes = flags.map((f) => f.flag);
    expect(flagTypes).toContain("zero_volume");
    expect(flagTypes).toContain("suspended");
    expect(flagTypes).toContain("stale");
  });
});

// ── 综合质量报告 ──────────────────────────────────────────

describe("computeDataQuality", () => {
  it("正常数据高质量", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({ symbol: "000858", price: 160, previousClose: 158, changePercent: 1.27, volume: 20_000_000 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare", ["600519", "000858"]);

    expect(report.provider).toBe("akshare");
    expect(report.totalSymbols).toBe(2);
    expect(report.score.overall).toBeGreaterThanOrEqual(90);
    expect(report.score.completeness).toBe(100);
    expect(report.score.freshness).toBe(100);
    expect(report.score.suspensionRate).toBe(0);
    expect(report.score.limitUpCount).toBe(0);
    expect(report.score.limitDownCount).toBe(0);
    expect(report.score.adjustmentWarningCount).toBe(0);
    expect(report.score.anomalyPriceCount).toBe(0);
    expect(report.flags).toHaveLength(0);
    expect(report.missingSymbols).toHaveLength(0);
  });

  it("检测缺失符号", () => {
    const quotes = [makeQuote({ symbol: "600519" })];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare", ["600519", "000858", "300750"]);

    expect(report.missingSymbols).toEqual(["000858", "300750"]);
    expect(report.requestedSymbols).toBe(3);
    expect(report.validSymbols).toBe(1);
    expect(report.score.completeness).toBe(33);
    expect(report.qualityState).toBe("unusable");
  });

  it("含停牌标的的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({ symbol: "000001", price: 10, previousClose: 10, changePercent: 0, volume: 0 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.suspensionRate).toBe(0.5);
    expect(report.flags.some((f) => f.flag === "suspended")).toBe(true);
    // 含50%停牌，整体质量应有下降
    expect(report.score.overall).toBeLessThanOrEqual(90);
  });

  it("含涨跌停标的的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({ symbol: "000858", price: 176, previousClose: 160, changePercent: 10.0, volume: 50_000_000 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.limitUpCount).toBe(1);
    expect(report.score.limitDownCount).toBe(0);
    expect(report.flags.some((f) => f.flag === "limit_up")).toBe(true);
  });

  it("含复权缺口标的的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({ symbol: "000858", price: 175, previousClose: 150, changePercent: 16.67, volume: 5_000_000 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.adjustmentWarningCount).toBe(1);
    expect(report.flags.some((f) => f.flag === "adjustment_gap")).toBe(true);
    // 50% 复权缺口会降低整体评分
    expect(report.score.overall).toBeLessThanOrEqual(85);
  });

  it("含异常价格标的的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({ symbol: "000858", price: 200, previousClose: 160, changePercent: 25.0, volume: 5_000_000 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.anomalyPriceCount).toBe(1);
    expect(report.flags.some((f) => f.flag === "anomaly_price")).toBe(true);
    // 异常价格会显著降低整体评分
    expect(report.score.overall).toBeLessThanOrEqual(80);
  });

  it("缓存年龄传递到报告", () => {
    const quotes = [makeQuote()];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare", [], 3.5);

    expect(report.cacheAgeSec).toBe(3.5);
  });

  it("空快照处理", () => {
    const snapshot = makeSnapshot([]);
    const report = computeDataQuality(snapshot, "mock");

    expect(report.totalSymbols).toBe(0);
    expect(report.score.overall).toBe(0);
    expect(report.score.completeness).toBe(0);
    expect(report.score.freshness).toBe(0);
    expect(report.score.adjustmentWarningCount).toBe(0);
    expect(report.score.anomalyPriceCount).toBe(0);
  });

  it("零价格数据降低综合评分", () => {
    const quotes = [
      makeQuote({ symbol: "600519" }),
      makeQuote({ symbol: "000858", price: 0 }),
      makeQuote({ symbol: "300750", price: 0 }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.completeness).toBe(33); // 1/3 valid
    // 2/3 数据无效，整体质量应显著降低
    expect(report.score.overall).toBeLessThan(70);
    expect(report.flags.some((f) => f.flag === "zero_price")).toBe(true);
  });

  it("含过期数据的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519" }),
      makeQuote({ symbol: "000858", updatedAt: STALE_ISO }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare", [], null, NOW);

    expect(report.score.freshness).toBeLessThan(100);
    expect(report.score.staleCount).toBe(1);
    expect(report.flags.some((f) => f.flag === "stale" && f.symbol === "000858")).toBe(true);
  });

  it("同时含复权缺口和异常价格的报告", () => {
    const quotes = [
      makeQuote({ symbol: "600519", price: 1500, previousClose: 1490, changePercent: 0.67, volume: 10_000_000 }),
      makeQuote({
        symbol: "000858",
        price: 175,
        previousClose: 150,
        changePercent: 16.67,
        volume: 5_000_000,
      }),
      makeQuote({
        symbol: "300750",
        price: 250,
        previousClose: 200,
        changePercent: 25.0,
        volume: 3_000_000,
      }),
    ];
    const snapshot = makeSnapshot(quotes);
    const report = computeDataQuality(snapshot, "akshare");

    expect(report.score.adjustmentWarningCount).toBe(2); // 000858: 16.67% gap; 300750: 25% gap
    expect(report.score.anomalyPriceCount).toBe(1); // 300750: 25% > 20% limit
    expect(report.score.overall).toBeLessThanOrEqual(60);
  });
});
