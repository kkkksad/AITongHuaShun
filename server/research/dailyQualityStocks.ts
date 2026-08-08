import type { MarketQuote, MarketSnapshot } from "../../shared/trading";

export type QualityStockAction = "focus" | "watch" | "avoid";
export type QualityStockGrade = "S" | "A" | "B" | "C";

export interface DailyQualityStock {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number | null;
  score: number;
  grade: QualityStockGrade;
  action: QualityStockAction;
  style: "core" | "growth" | "momentum" | "defensive";
  confidence: number;
  suggestedPositionWeight: number;
  factors: {
    liquidity: number;
    momentum: number;
    stability: number;
    intradayStrength: number;
    turnover: number;
  };
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyQualityStockReport {
  generatedAt: string;
  mode: MarketSnapshot["mode"];
  source: {
    provider: string;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  methodology: {
    name: "每日优质股评分";
    version: "0.2.0";
    dataScope: {
      realtimeQuote: boolean;
      historicalBars: boolean;
      news: boolean;
      fundamentals: boolean;
    };
    weights: Record<string, number>;
  };
  autoUpdate: {
    marketRefresh: string;
    qualityRefresh: string;
    execution: "paper-only";
  };
  guardrails: string[];
  stocks: DailyQualityStock[];
}

const weights = {
  liquidity: 0.28,
  momentum: 0.24,
  stability: 0.2,
  intradayStrength: 0.18,
  turnover: 0.1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreRange(
  value: number,
  idealMin: number,
  idealMax: number,
  hardMin: number,
  hardMax: number,
): number {
  if (!Number.isFinite(value)) return 45;
  if (value >= idealMin && value <= idealMax) return 100;
  if (value < hardMin || value > hardMax) return 20;
  if (value < idealMin) {
    return 20 + ((value - hardMin) / Math.max(idealMin - hardMin, 0.0001)) * 80;
  }
  return 20 + ((hardMax - value) / Math.max(hardMax - idealMax, 0.0001)) * 80;
}

function computeLiquidityScore(quote: MarketQuote): number {
  const amount = quote.amount ?? quote.price * quote.volume;
  if (!Number.isFinite(amount) || amount <= 0) {
    return quote.volume >= 5_000_000 ? 72 : 42;
  }

  if (amount >= 1_000_000_000) return 100;
  if (amount >= 400_000_000) return 88;
  if (amount >= 150_000_000) return 72;
  if (amount >= 50_000_000) return 56;
  return 35;
}

function computeIntradayStrength(quote: MarketQuote): number {
  if (quote.high && quote.low && quote.high > quote.low) {
    const position = (quote.price - quote.low) / (quote.high - quote.low);
    return round(clamp(position * 100, 0, 100));
  }
  if (quote.changePercent >= 1) return 68;
  if (quote.changePercent >= 0) return 55;
  return 40;
}

function computeTurnoverScore(turnover: number): number {
  if (!Number.isFinite(turnover) || turnover <= 0) return 50;

  if (turnover < 2) {
    return round(20 + 70 * (turnover / 2) ** 1.5);
  }
  if (turnover <= 6) {
    return round(100 - Math.abs(turnover - 4) * 5);
  }

  const overheating = clamp((turnover - 6) / 12, 0, 1);
  return round(90 - 70 * overheating ** 1.35);
}

function inferStyle(
  quote: MarketQuote,
  score: number,
): DailyQualityStock["style"] {
  if (score >= 82 && Math.abs(quote.changePercent) <= 2.5) return "core";
  if (quote.changePercent >= 2.5) return "momentum";
  if ((quote.amplitude ?? 0) <= 4 && quote.changePercent >= -0.5) return "defensive";
  return "growth";
}

function gradeFromScore(score: number): QualityStockGrade {
  if (score >= 85) return "S";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  return "C";
}

function actionFromScore(score: number, riskFlags: string[]): QualityStockAction {
  if (score >= 75 && riskFlags.length <= 1) return "focus";
  if (score >= 58) return "watch";
  return "avoid";
}

function scoreQuote(quote: MarketQuote): Omit<DailyQualityStock, "rank"> {
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  const change = Number.isFinite(quote.changePercent) ? quote.changePercent : 0;
  const amplitude = Number.isFinite(quote.amplitude) ? quote.amplitude ?? 0 : 0;
  const turnover = Number.isFinite(quote.turnover) ? quote.turnover ?? 0 : 0;

  const factors = {
    liquidity: computeLiquidityScore(quote),
    momentum: round(scoreRange(change, 0.2, 3.8, -4.5, 8.5)),
    stability: round(100 - clamp(amplitude || Math.abs(change) * 1.8, 0, 12) * 6.5),
    intradayStrength: computeIntradayStrength(quote),
    turnover: computeTurnoverScore(turnover),
  };

  if (factors.liquidity >= 72) reasons.push("成交额/成交量满足优质股筛选的流动性门槛。");
  if (change >= 0.2 && change <= 3.8) reasons.push("涨跌幅处于健康强势区间，未出现过热追涨。");
  if (factors.intradayStrength >= 65) reasons.push("价格靠近日内强势区间，承接表现较好。");
  if (factors.stability >= 70) reasons.push("日内波动相对可控，适合进入观察池。");
  if (turnover >= 2 && turnover <= 6) reasons.push("换手率处于 2%-6% 的健康换手甜蜜区。");
  if (turnover <= 0) reasons.push("换手率字段缺失，本因子按中性证据处理。");

  if (change <= -3) riskFlags.push("当日跌幅较大，优先等待企稳确认。");
  if (change >= 7) riskFlags.push("当日涨幅过高，隔日回撤风险上升。");
  if (amplitude >= 10) riskFlags.push("振幅过大，短线不确定性偏高。");
  if (turnover > 0 && turnover < 0.8) riskFlags.push("换手不足，价格信号可能缺少成交确认。");
  if (turnover >= 10 && turnover < 18) riskFlags.push("换手偏热，追涨与次日回撤风险上升。");
  if (turnover >= 18) riskFlags.push("换手率过高，可能存在情绪化交易。");
  if (factors.liquidity < 55) riskFlags.push("流动性不足，模拟成交质量较差。");
  if (!quote.tradable || quote.price <= 0) riskFlags.push("标的不可交易或价格无效。");

  const score = round(
    factors.liquidity * weights.liquidity +
      factors.momentum * weights.momentum +
      factors.stability * weights.stability +
      factors.intradayStrength * weights.intradayStrength +
      factors.turnover * weights.turnover,
  );
  const grade = gradeFromScore(score);
  const action = actionFromScore(score, riskFlags);

  if (reasons.length === 0) {
    reasons.push("当前只满足基础入池条件，等待历史数据和样本外验证。");
  }

  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    amount: quote.amount ?? null,
    score,
    grade,
    action,
    style: inferStyle(quote, score),
    confidence: round(clamp(score / 100, 0.15, 0.9)),
    suggestedPositionWeight: action === "focus" ? 0.15 : action === "watch" ? 0.08 : 0,
    factors,
    reasons,
    riskFlags,
    updatedAt: quote.updatedAt,
  };
}

export function buildDailyQualityStocks(
  snapshot: MarketSnapshot,
  marketDataProvider: string,
  limit = 10,
): DailyQualityStockReport {
  const tradableQuotes = snapshot.quotes.filter(
    (quote) => quote.tradable && quote.price > 0 && /^\d{6}$/.test(quote.symbol),
  );

  const stocks = tradableQuotes
    .map(scoreQuote)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.factors.liquidity !== a.factors.liquidity) {
        return b.factors.liquidity - a.factors.liquidity;
      }
      return b.changePercent - a.changePercent;
    })
    .slice(0, limit)
    .map((stock, index) => ({ rank: index + 1, ...stock }));

  return {
    generatedAt: new Date().toISOString(),
    mode: snapshot.mode,
    source: {
      provider: marketDataProvider,
      snapshotSequence: snapshot.sequence,
      snapshotTime: snapshot.marketTime,
      quoteCount: snapshot.quotes.length,
      tradableCount: tradableQuotes.length,
    },
    methodology: {
      name: "每日优质股评分",
      version: "0.2.0",
      dataScope: {
        realtimeQuote: marketDataProvider !== "mock",
        historicalBars: false,
        news: false,
        fundamentals: false,
      },
      weights,
    },
    autoUpdate: {
      marketRefresh: "行情快照由后端数据源刷新；AkShare 模式下使用真实只读行情。",
      qualityRefresh: "前端每 60 秒刷新一次每日优质股，也可手动刷新。",
      execution: "paper-only",
    },
    guardrails: [
      "每日优质股只用于研究和模拟盘观察，不代表真实收益或投资建议。",
      "当前版本主要使用实时行情快照评分，尚未接入同花顺授权历史数据、财务因子和真实新闻。",
      "focus 只表示优先观察或进入 paper 小仓位验证，不表示真实下单授权。",
      "后续接入同花顺模拟盘时，凭据只能放在服务端密钥系统或本地未提交环境变量中，不能写入前端或提交记录。",
    ],
    stocks,
  };
}
