import type {
  BacktestResult,
  EquityPoint,
  StrategyId,
  StrategyParameters,
  Trade,
} from "../types";

const symbols = [
  ["600519", 1490],
  ["300750", 252],
  ["688981", 92],
  ["601318", 52],
  ["600036", 44],
] as const;

const strategyDrift: Record<StrategyId, number> = {
  momentum: 0.00072,
  "mean-reversion": 0.00055,
  breakout: 0.00066,
  "multi-factor": 0.00061,
  dca: 0.00032,
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDate(dayOffset: number): string {
  const date = new Date(Date.UTC(2026, 2, 2 + dayOffset));
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function calculateMaxDrawdown(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let peak = values[0];
  let maxDrawdown = 0;

  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }

  return maxDrawdown;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function runBacktest(
  strategyId: StrategyId,
  parameters: StrategyParameters,
): BacktestResult {
  const seed = hashSeed(`${strategyId}:${Object.values(parameters).join(":")}`);
  const random = mulberry32(seed);
  const startingCapital = 1_000_000;
  const periods = 90;
  const equityCurve: EquityPoint[] = [];
  const returns: number[] = [];
  const trades: Trade[] = [];

  let portfolio = startingCapital;
  let benchmark = startingCapital;

  for (let day = 0; day < periods; day += 1) {
    const riskScale = parameters.maxPosition / 35;
    const thresholdPenalty = Math.abs(parameters.entryThreshold - 1.4) * 0.00008;
    const stopBenefit = Math.max(0, 8 - parameters.stopLoss) * 0.000018;
    const noise = (random() - 0.48) * 0.015 * riskScale;
    const cycle = Math.sin(day / (parameters.lookback / 4 + 3)) * 0.0018;
    const dailyReturn =
      strategyDrift[strategyId] - thresholdPenalty + stopBenefit + noise + cycle;
    const benchmarkReturn = 0.00034 + (random() - 0.49) * 0.008;

    portfolio *= 1 + dailyReturn;
    benchmark *= 1 + benchmarkReturn;
    returns.push(dailyReturn);

    equityCurve.push({
      date: formatDate(day),
      portfolio: Math.round(portfolio),
      benchmark: Math.round(benchmark),
    });

    if (day > 4 && day % Math.max(5, parameters.rebalanceDays + 3) === 0) {
      const [symbol, basePrice] = symbols[trades.length % symbols.length];
      const side = trades.length % 3 === 2 ? "\u5356\u51FA" : "\u4E70\u5165";
      const quantity = 100 * (1 + (trades.length % 6));
      const price = basePrice * (0.97 + random() * 0.08);
      const pnl = side === "\u5356\u51FA" ? (random() - 0.34) * price * quantity * 0.08 : 0;

      trades.push({
        id: `TR-${String(trades.length + 1).padStart(3, "0")}`,
        symbol,
        side,
        date: formatDate(day),
        price: Number(price.toFixed(2)),
        quantity,
        pnl: Number(pnl.toFixed(2)),
      });
    }
  }

  const endingCapital = equityCurve.at(-1)?.portfolio ?? startingCapital;
  const totalReturn = endingCapital / startingCapital - 1;
  const annualizedReturn = (1 + totalReturn) ** (252 / periods) - 1;
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatility = standardDeviation(returns);
  const closedTrades = trades.filter((trade) => trade.side === "\u5356\u51FA");
  const winningTrades = closedTrades.filter((trade) => trade.pnl > 0);

  return {
    equityCurve,
    trades,
    metrics: {
      totalReturn,
      annualizedReturn,
      maxDrawdown: calculateMaxDrawdown(equityCurve.map((point) => point.portfolio)),
      sharpe: volatility === 0 ? 0 : (meanReturn / volatility) * Math.sqrt(252),
      winRate: closedTrades.length === 0 ? 0 : winningTrades.length / closedTrades.length,
      tradeCount: trades.length,
    },
  };
}
