/**
 * 数据质量评分模块
 *
 * 对 MarketSnapshot 进行多维质量评估：
 * - 新鲜度：数据更新时间 vs 当前时间
 * - 完整度：有效报价的符号比例
 * - 停牌检测：价格/成交量异常的标的
 * - 涨跌停检测：触及涨跌停板的标的
 * - 复权检测：前后复权未对齐导致的价格跳空
 * - 异常波动：超出板块涨跌停限制的非停牌价格波动
 * - 综合评分：加权汇总
 *
 * 参考：docs/plans/2026-07-11-real-data-strategy-research-loop.md
 */
import type {
  DataQualityFlag,
  DataQualityReport,
  DataQualityScore,
  MarketQuote,
  MarketSnapshot,
} from "../../shared/trading";

/** 各板块涨跌停幅度 */
const BOARD_LIMITS: Record<string, { limit: number; label: string }> = {
  "0": { limit: 10, label: "主板" },      // 000xxx, 600xxx
  "300": { limit: 20, label: "创业板" },
  "301": { limit: 20, label: "创业板" },
  "688": { limit: 20, label: "科创板" },
  "689": { limit: 20, label: "科创板" },
};

/** 新鲜度：超过此秒数开始扣分 */
const FRESHNESS_MAX_AGE_SEC = 300; // 5分钟满分
const FRESHNESS_DECAY_SEC = 600;   // 每10分钟额外扣10分

/** 复权检测：价格跳空阈值（相对于昨收的百分比） */
const ADJUSTMENT_GAP_THRESHOLD_PCT = 15; // 超过15%的跳空可能是复权未对齐

/** 综合评分权重 */
const WEIGHTS = {
  freshness: 0.25,
  completeness: 0.25,
  suspensionPenalty: 0.20,
  limitHitPenalty: 0.10,
  adjustmentPenalty: 0.10,
  anomalyPenalty: 0.10,
};

/**
 * 根据股票代码前缀判断涨跌停幅度
 */
export function getBoardLimit(symbol: string): number {
  const prefix3 = symbol.slice(0, 3);

  if (BOARD_LIMITS[prefix3]) {
    return BOARD_LIMITS[prefix3].limit;
  }
  // 科创板: 688xxx, 689xxx
  if (symbol.startsWith("688") || symbol.startsWith("689")) {
    return 20;
  }
  // 创业板: 300xxx, 301xxx
  if (symbol.startsWith("300") || symbol.startsWith("301")) {
    return 20;
  }
  // 北交所: 8xxxxx, 4xxxxx (6位代码首字符)
  if (symbol.startsWith("8") || symbol.startsWith("4")) {
    return 30;
  }
  return 10; // 默认主板
}

/**
 * 判断是否疑似停牌
 * 条件：价格等于昨收 且 成交量为0
 */
export function isSuspectedSuspended(quote: MarketQuote): boolean {
  // 涨跌幅为0且无成交，大概率停牌
  if (quote.changePercent === 0 && quote.volume === 0 && quote.price > 0) {
    return true;
  }
  // 价格与昨收完全相同且无成交（且价格大于0，排除未初始化情况）
  if (quote.price === quote.previousClose && quote.volume === 0 && quote.price > 0) {
    return true;
  }
  return false;
}

/**
 * 判断涨跌停
 * 返回 "limit_up" | "limit_down" | null
 */
export function detectLimitHit(quote: MarketQuote): "limit_up" | "limit_down" | null {
  const boardLimit = getBoardLimit(quote.symbol);
  const tolerance = 0.1;

  // 只接受涨跌停阈值附近的报价；明显越界的值留给异常价格检测。
  if (Math.abs(quote.changePercent - boardLimit) <= tolerance) {
    return "limit_up";
  }
  if (Math.abs(quote.changePercent + boardLimit) <= tolerance) {
    return "limit_down";
  }
  return null;
}

/**
 * 检测复权缺口：价格跳空超过阈值，可能是前后复权未对齐
 *
 * 在 A 股中，除权除息日股价会出现大幅跳空。如果数据源混用了
 * 前复权/后复权/不复权价格，就会出现无法解释的价格缺口。
 *
 * 检测逻辑：
 * - 价格相对昨收变化超过 ADJUSTMENT_GAP_THRESHOLD_PCT
 * - 排除涨跌停（正常市场行为）
 * - 排除停牌标的
 *
 * @returns true if adjustment gap detected
 */
export function detectAdjustmentGap(quote: MarketQuote): boolean {
  // 排除零价格或无昨收的标的
  if (quote.price <= 0 || quote.previousClose <= 0) {
    return false;
  }
  // 排除停牌
  if (isSuspectedSuspended(quote)) {
    return false;
  }
  if (detectLimitHit(quote)) {
    return false;
  }
  const absChangePct = Math.abs(quote.changePercent);

  // 跳空超过阈值，优先标记为复权风险；是否同时超出涨跌停由 anomaly_price 单独标记。
  if (absChangePct >= ADJUSTMENT_GAP_THRESHOLD_PCT) {
    return true;
  }

  return false;
}

/**
 * 检测异常价格：价格变动超出板块涨跌停限制
 *
 * 如果某标的涨跌幅超出板块涨跌停限制，且不是停牌状态，
 * 可能是数据源错误或复权问题。
 *
 * @returns true if anomalous price detected
 */
export function detectPriceAnomaly(quote: MarketQuote): boolean {
  if (quote.price <= 0) {
    return false; // 零价格由 zero_price 检测
  }
  if (isSuspectedSuspended(quote)) {
    return false;
  }

  const boardLimit = getBoardLimit(quote.symbol);
  const absChangePct = Math.abs(quote.changePercent);

  // 15%-20% 的跳空优先按复权风险处理，避免同一条数据同时进入异常价格计数。
  if (detectAdjustmentGap(quote) && absChangePct < 20) {
    return false;
  }

  // 超出板块涨跌停限制（留 0.5% 浮点容差）
  if (absChangePct > boardLimit + 0.5) {
    return true;
  }

  return false;
}

/**
 * 计算数据新鲜度评分 (0-100)
 */
export function computeFreshness(updatedAt: string, nowMs?: number): number {
  const now = nowMs ?? Date.now();
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return 0;
  const ageSec = (now - updatedAtMs) / 1000;

  if (ageSec <= 0) return 100;
  if (ageSec >= FRESHNESS_MAX_AGE_SEC + FRESHNESS_DECAY_SEC * 9) return 0;

  // 前5分钟满分，之后线性衰减到0
  if (ageSec <= FRESHNESS_MAX_AGE_SEC) return 100;
  const excess = ageSec - FRESHNESS_MAX_AGE_SEC;
  const decay = Math.min(100, (excess / FRESHNESS_DECAY_SEC) * 100);
  return Math.round(Math.max(0, 100 - decay));
}

/**
 * 使用低 10% 分位评估整批报价新鲜度，避免一条最新报价掩盖大量陈旧报价，
 * 同时容忍极少量孤立延迟。
 */
export function computeCoverageFreshness(
  quotes: MarketQuote[],
  nowMs: number = Date.now(),
): number {
  if (quotes.length === 0) return 0;
  const scores = quotes
    .map((quote) => computeFreshness(quote.updatedAt, nowMs))
    .sort((a, b) => a - b);
  const percentileIndex = Math.floor((scores.length - 1) * 0.1);
  return scores[percentileIndex];
}

/**
 * 计算数据完整度评分 (0-100)
 * 有效的报价：价格 > 0 且成交量 >= 0
 */
export function computeCompleteness(quotes: MarketQuote[]): number {
  if (quotes.length === 0) return 0;
  const valid = quotes.filter((quote) =>
    Number.isFinite(quote.price) &&
    Number.isFinite(quote.volume) &&
    quote.price > 0 &&
    quote.volume >= 0
  ).length;
  return Math.round((valid / quotes.length) * 100);
}

/**
 * 检测停牌、涨跌停、过期、复权缺口和异常数据
 */
export function detectFlags(
  quotes: MarketQuote[],
  nowMs: number = Date.now(),
): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];

  for (const quote of quotes) {
    // 零价格
    if (quote.price === 0) {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "zero_price",
        detail: `价格为 0，可能数据缺失或未上市`,
      });
      continue; // 零价格情况下其他检测无意义
    }

    // 零成交量
    if (quote.volume === 0) {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "zero_volume",
        detail: `成交量为 0，可能停牌或数据延迟`,
      });
    }

    // 停牌
    if (isSuspectedSuspended(quote)) {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "suspended",
        detail: `疑似停牌：价格=${quote.price} 昨收=${quote.previousClose} 成交量=0`,
      });
    }

    // 涨跌停
    const limit = detectLimitHit(quote);
    if (limit === "limit_up") {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "limit_up",
        detail: `涨停：涨跌幅 ${quote.changePercent.toFixed(2)}%（板块限制 ${getBoardLimit(quote.symbol)}%）`,
      });
    } else if (limit === "limit_down") {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "limit_down",
        detail: `跌停：涨跌幅 ${quote.changePercent.toFixed(2)}%（板块限制 ${getBoardLimit(quote.symbol)}%）`,
      });
    }

    // 复权缺口
    if (detectAdjustmentGap(quote)) {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "adjustment_gap",
        detail: `复权缺口：涨跌幅 ${quote.changePercent.toFixed(2)}%，超过 ${ADJUSTMENT_GAP_THRESHOLD_PCT}% 阈值，可能前后复权未对齐`,
      });
    }

    // 异常价格
    if (detectPriceAnomaly(quote)) {
      const boardLimit = getBoardLimit(quote.symbol);
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "anomaly_price",
        detail: `异常价格：涨跌幅 ${quote.changePercent.toFixed(2)}%，超出板块 ${boardLimit}% 涨跌停限制`,
      });
    }

    // 数据过期（超过5分钟未更新）
    const updatedAtMs = new Date(quote.updatedAt).getTime();
    const ageSec = Number.isFinite(updatedAtMs)
      ? (nowMs - updatedAtMs) / 1000
      : Number.POSITIVE_INFINITY;
    if (ageSec > 300) {
      flags.push({
        symbol: quote.symbol,
        name: quote.name,
        flag: "stale",
        detail: `数据过期：${Math.round(ageSec)}秒未更新`,
      });
    }
  }

  return flags;
}

/**
 * 综合计算数据质量报告
 *
 * @param snapshot 当前市场快照
 * @param provider 数据提供者标识
 * @param requestedSymbols 请求的符号列表（用于检测缺失）
 * @param cacheAgeSec 缓存年龄（可选，来自桥接的缓存元数据）
 */
export function computeDataQuality(
  snapshot: MarketSnapshot,
  provider: string,
  requestedSymbols: string[] = [],
  cacheAgeSec: number | null = null,
  nowMs: number = Date.now(),
): DataQualityReport {
  const quotes = snapshot.quotes;
  const normalizedRequestedSymbols = Array.from(new Set(requestedSymbols));

  // 空快照：直接返回零分报告
  if (quotes.length === 0) {
    return {
      timestamp: new Date(nowMs).toISOString(),
      provider,
      totalSymbols: 0,
      requestedSymbols: normalizedRequestedSymbols.length,
      validSymbols: 0,
      qualityState: "unusable",
      score: {
        freshness: 0,
        completeness: 0,
        suspensionRate: 0,
        limitUpCount: 0,
        limitDownCount: 0,
        adjustmentWarningCount: 0,
        anomalyPriceCount: 0,
        staleCount: 0,
        overall: 0,
      },
      flags: [],
      missingSymbols: normalizedRequestedSymbols,
      cacheAgeSec,
    };
  }

  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const evaluatedSymbols = normalizedRequestedSymbols.length > 0
    ? normalizedRequestedSymbols
    : Array.from(quoteBySymbol.keys());
  const evaluatedQuotes = evaluatedSymbols
    .map((symbol) => quoteBySymbol.get(symbol))
    .filter((quote): quote is MarketQuote => Boolean(quote));
  const missingSymbols = normalizedRequestedSymbols.filter(
    (symbol) => !quoteBySymbol.has(symbol),
  );
  const validSymbols = evaluatedQuotes.filter((quote) =>
    Number.isFinite(quote.price) &&
    Number.isFinite(quote.volume) &&
    quote.price > 0 &&
    quote.volume >= 0
  ).length;

  // 新鲜度：使用整批报价低分位，不让单条最新报价掩盖陈旧数据
  const freshness = computeCoverageFreshness(evaluatedQuotes, nowMs);

  // 完整度：有明确请求池时把缺失和无效报价一起纳入分母
  const completeness = evaluatedSymbols.length > 0
    ? Math.round((validSymbols / evaluatedSymbols.length) * 100)
    : 0;

  // 数据标记
  const flags = detectFlags(quotes, nowMs);

  // 停牌比例
  const suspendedCount = flags.filter((f) => f.flag === "suspended").length;
  const suspensionRate = quotes.length > 0 ? suspendedCount / quotes.length : 0;

  // 涨跌停数量
  const limitUpCount = flags.filter((f) => f.flag === "limit_up").length;
  const limitDownCount = flags.filter((f) => f.flag === "limit_down").length;

  // 零价格数量（额外扣分）
  const zeroPriceCount = flags.filter((f) => f.flag === "zero_price").length;

  // 复权缺口数量
  const adjustmentWarningCount = flags.filter((f) => f.flag === "adjustment_gap").length;

  // 异常价格数量
  const anomalyPriceCount = flags.filter((f) => f.flag === "anomaly_price").length;
  const staleCount = flags.filter((f) => f.flag === "stale").length;

  // 综合评分：zero_price 会影响 completeness 和 suspensionPenalty
  const suspensionPenalty = Math.max(0, 100 - (suspensionRate + zeroPriceCount / quotes.length) * 120);
  const limitHitPenalty = Math.max(0, 100 - ((limitUpCount + limitDownCount) / quotes.length) * 50);
  const adjustmentPenalty = Math.max(0, 100 - (adjustmentWarningCount / quotes.length) * 250);
  const anomalyPenalty = Math.max(0, 100 - (anomalyPriceCount / quotes.length) * 500);

  let overall = Math.round(
    freshness * WEIGHTS.freshness +
    completeness * WEIGHTS.completeness +
    suspensionPenalty * WEIGHTS.suspensionPenalty +
    limitHitPenalty * WEIGHTS.limitHitPenalty +
    adjustmentPenalty * WEIGHTS.adjustmentPenalty +
    anomalyPenalty * WEIGHTS.anomalyPenalty,
  );

  const adjustmentRate = adjustmentWarningCount / quotes.length;
  const anomalyRate = anomalyPriceCount / quotes.length;
  if (adjustmentRate >= 0.5) {
    overall = Math.min(overall, 85);
  }
  if (adjustmentWarningCount > 0 && anomalyPriceCount > 0) {
    overall = Math.min(overall, 60);
  }
  if (anomalyRate >= 0.5) {
    overall = Math.min(overall, 70);
  }

  const score: DataQualityScore = {
    freshness: Math.round(freshness),
    completeness,
    suspensionRate: Math.round(suspensionRate * 1000) / 1000,
    limitUpCount,
    limitDownCount,
    adjustmentWarningCount,
    anomalyPriceCount,
    staleCount,
    overall,
  };

  const qualityState: DataQualityReport["qualityState"] =
    completeness < 50 || freshness < 25 || anomalyRate >= 0.5
      ? "unusable"
      : overall < 85 || missingSymbols.length > 0 || staleCount > 0 ||
          adjustmentWarningCount > 0 || anomalyPriceCount > 0
        ? "degraded"
        : "healthy";

  return {
    timestamp: new Date(nowMs).toISOString(),
    provider,
    totalSymbols: quotes.length,
    requestedSymbols: evaluatedSymbols.length,
    validSymbols,
    qualityState,
    score,
    flags,
    missingSymbols,
    cacheAgeSec,
  };
}
