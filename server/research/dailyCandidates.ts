import type { MarketQuote, MarketSnapshot } from "../../shared/trading";

export type DailyCandidateAction = "watch" | "paper-buy" | "avoid";

export interface DailyCandidate {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  score: number;
  action: DailyCandidateAction;
  confidence: number;
  suggestedPositionWeight: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  reasons: string[];
  riskFlags: string[];
  updatedAt: string;
}

export interface DailyCandidateReport {
  generatedAt: string;
  strategyKey: "aSharePullback";
  strategyName: "A股强势回踩确认";
  mode: MarketSnapshot["mode"];
  source: {
    provider: string;
    snapshotSequence: number;
    snapshotTime: string;
    quoteCount: number;
    tradableCount: number;
  };
  autoUpdate: {
    marketRefresh: string;
    researchRefresh: string;
    execution: "paper-only";
    nextStep: string;
  };
  guardrails: string[];
  candidates: DailyCandidate[];
}

const STOP_LOSS_PERCENT = 0.02;
const TAKE_PROFIT_PERCENT = 0.05;
const MAX_SUGGESTED_POSITION_WEIGHT = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreQuote(quote: MarketQuote): Omit<DailyCandidate, "rank"> {
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  const change = Number.isFinite(quote.changePercent) ? quote.changePercent : 0;
  const volume = Number.isFinite(quote.volume) ? quote.volume : 0;
  const amplitude = Number.isFinite(quote.amplitude) ? quote.amplitude ?? 0 : 0;
  const turnover = Number.isFinite(quote.turnover) ? quote.turnover ?? 0 : 0;
  const intradayPosition =
    quote.high && quote.low && quote.high > quote.low
      ? (quote.price - quote.low) / (quote.high - quote.low)
      : 0.5;

  let score = 45;

  if (change >= 0.4 && change <= 4.5) {
    score += 24;
    reasons.push("涨幅处于强势确认区间，避免追极端一字涨停。");
  } else if (change > 4.5 && change <= 7.5) {
    score += 10;
    riskFlags.push("涨幅偏高，追价风险上升。");
  } else if (change > -1.8 && change < 0.4) {
    score += 8;
    reasons.push("日内波动温和，可进入回踩观察。");
  } else if (change <= -1.8) {
    score -= 22;
    riskFlags.push("当日走弱，暂不符合放量反包确认。");
  }

  if (volume >= 5_000_000) {
    score += 12;
    reasons.push("成交量具备基本流动性。");
  } else {
    score -= 12;
    riskFlags.push("成交量偏低，模拟滑点和成交不确定性较高。");
  }

  if (intradayPosition >= 0.55) {
    score += 10;
    reasons.push("收盘价靠近日内高位，短线承接较强。");
  } else if (intradayPosition < 0.25) {
    score -= 10;
    riskFlags.push("价格靠近日内低位，反包确认不足。");
  }

  if (turnover > 0 && turnover <= 12) {
    score += 6;
    reasons.push("换手率处于可观察区间。");
  } else if (turnover > 18) {
    score -= 8;
    riskFlags.push("换手率过高，可能是情绪化波动。");
  }

  if (amplitude > 9) {
    score -= 10;
    riskFlags.push("振幅过大，隔日波动风险较高。");
  }

  if (quote.price <= 0 || !quote.tradable) {
    score = 0;
    riskFlags.push("标的不可交易或价格无效。");
  }

  const normalizedScore = round(clamp(score, 0, 100), 2);
  const action: DailyCandidateAction =
    normalizedScore >= 72 && riskFlags.length <= 1
      ? "paper-buy"
      : normalizedScore >= 55
        ? "watch"
        : "avoid";

  if (reasons.length === 0) {
    reasons.push("当前仅满足基础观察条件，等待更多历史行情确认。");
  }

  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    score: normalizedScore,
    action,
    confidence: round(clamp(normalizedScore / 100, 0.1, 0.86), 2),
    suggestedPositionWeight:
      action === "paper-buy"
        ? MAX_SUGGESTED_POSITION_WEIGHT
        : action === "watch"
          ? 0.1
          : 0,
    stopLossPercent: STOP_LOSS_PERCENT,
    takeProfitPercent: TAKE_PROFIT_PERCENT,
    reasons,
    riskFlags,
    updatedAt: quote.updatedAt,
  };
}

export function buildDailyCandidates(
  snapshot: MarketSnapshot,
  marketDataProvider: string,
  limit = 8,
): DailyCandidateReport {
  const tradableQuotes = snapshot.quotes.filter(
    (quote) => quote.tradable && quote.price > 0 && /^\d{6}$/.test(quote.symbol),
  );

  const candidates = tradableQuotes
    .map(scoreQuote)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.changePercent - a.changePercent;
    })
    .slice(0, limit)
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));

  return {
    generatedAt: new Date().toISOString(),
    strategyKey: "aSharePullback",
    strategyName: "A股强势回踩确认",
    mode: snapshot.mode,
    source: {
      provider: marketDataProvider,
      snapshotSequence: snapshot.sequence,
      snapshotTime: snapshot.marketTime,
      quoteCount: snapshot.quotes.length,
      tradableCount: tradableQuotes.length,
    },
    autoUpdate: {
      marketRefresh: "行情由后端 MarketDataProvider 按 MARKET_TICK_MS 刷新，并通过 WebSocket 推送。",
      researchRefresh: "候选扫描由前端 TanStack Query 每 60 秒自动刷新，也可手动刷新。",
      execution: "paper-only",
      nextStep: "接入授权历史行情缓存后，候选分数会升级为真实历史序列验证。",
    },
    guardrails: [
      "候选扫描只用于研究和模拟盘观察，不代表真实收益或投资建议。",
      "当前评分主要基于实时快照特征，尚未替代授权历史日线、分钟线和样本外验证。",
      "建议动作中的 paper-buy 只表示可在模拟盘小仓位验证，绝不表示真实下单授权。",
      "真实交易保持关闭；任何同花顺或券商接入必须先经过独立凭据、风控、审计和人工审批网关。",
    ],
    candidates,
  };
}
