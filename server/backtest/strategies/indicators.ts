/**
 * 技术指标计算工具集 —— 策略基类使用的通用指标函数。
 *
 * 所有函数均为纯函数，接收价格数组和参数值，返回计算结果。
 * 设计原则：
 * - 不依赖外部状态，仅基于传入的数值序列计算。
 * - 返回 NaN 当数据不足时（调用方自行处理）。
 * - 使用 Welford 类在线方式计算方差，避免浮点误差累积。
 */

/** ------------------------------------------------------------------
 *  均线
 *  ------------------------------------------------------------------ */

/** 简单移动平均 */
export function sma(prices: number[], period: number): number {
  if (prices.length < period || period <= 0) return NaN;
  const slice = prices.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** 指数移动平均 */
export function ema(prices: number[], period: number): number {
  if (prices.length < period || period <= 0) return NaN;
  const k = 2 / (period + 1);
  // 用 SMA 作为初始值
  const seed = sma(prices.slice(0, period), period);
  let result = seed;
  for (let i = period; i < prices.length; i++) {
    result = prices[i] * k + result * (1 - k);
  }
  return result;
}

/** ------------------------------------------------------------------
 *  RSI (相对强弱指标)
 *  ------------------------------------------------------------------ */

export function rsi(prices: number[], period: number): number {
  if (prices.length < period + 1 || period <= 0) return NaN;

  let avgGain = 0;
  let avgLoss = 0;

  // 初始 Wilder 平均
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** ------------------------------------------------------------------
 *  MACD
 *  ------------------------------------------------------------------ */

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult {
  if (prices.length < slowPeriod + signalPeriod) {
    return { macd: NaN, signal: NaN, histogram: NaN };
  }

  // 计算快慢 EMA
  const fastEmaArr: number[] = [];
  const slowEmaArr: number[] = [];

  // 逐一计算 EMA 序列
  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);

  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      fastEmaArr.push(prices[i]);
      slowEmaArr.push(prices[i]);
    } else {
      fastEmaArr.push(prices[i] * fastK + fastEmaArr[i - 1] * (1 - fastK));
      slowEmaArr.push(prices[i] * slowK + slowEmaArr[i - 1] * (1 - slowK));
    }
  }

  // MACD 线 = 快EMA - 慢EMA
  const macdArr: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdArr.push(fastEmaArr[i] - slowEmaArr[i]);
  }

  // 信号线 = MACD 的 EMA
  const signalK = 2 / (signalPeriod + 1);
  const signalArr: number[] = [macdArr[0]];
  for (let i = 1; i < macdArr.length; i++) {
    signalArr.push(
      macdArr[i] * signalK + signalArr[i - 1] * (1 - signalK),
    );
  }

  const macdVal = macdArr[macdArr.length - 1];
  const signalVal = signalArr[signalArr.length - 1];

  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
  };
}

/** ------------------------------------------------------------------
 *  布林带
 *  ------------------------------------------------------------------ */

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;   // (upper - lower) / middle
  percentB: number;     // (price - lower) / (upper - lower)
}

export function bollingerBands(
  prices: number[],
  period = 20,
  stdMultiplier = 2,
): BollingerBandsResult {
  if (prices.length < period || period <= 0) {
    return {
      upper: NaN,
      middle: NaN,
      lower: NaN,
      bandwidth: NaN,
      percentB: NaN,
    };
  }

  const middle = sma(prices, period);

  // 标准差
  const slice = prices.slice(-period);
  const variance =
    slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdMultiplier * stdDev;
  const lower = middle - stdMultiplier * stdDev;
  const bandwidth = (upper - lower) / middle;
  const currentPrice = prices[prices.length - 1];
  const percentB =
    upper - lower === 0 ? 0 : (currentPrice - lower) / (upper - lower);

  return { upper, middle, lower, bandwidth, percentB };
}

/** ------------------------------------------------------------------
 *  ATR (平均真实波幅)
 *  ------------------------------------------------------------------ */

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number {
  if (highs.length < period + 1 || period <= 0) return NaN;

  // 计算 True Range 序列
  const trValues: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trValues.push(tr);
  }

  // Wilders 平滑
  let atrVal = trValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trValues.length; i++) {
    atrVal = (atrVal * (period - 1) + trValues[i]) / period;
  }

  return atrVal;
}

/** ------------------------------------------------------------------
 *  最高/最低
 *  ------------------------------------------------------------------ */

export function highest(prices: number[], period: number): number {
  if (prices.length < period || period <= 0) return NaN;
  return Math.max(...prices.slice(-period));
}

export function lowest(prices: number[], period: number): number {
  if (prices.length < period || period <= 0) return NaN;
  return Math.min(...prices.slice(-period));
}

/** ------------------------------------------------------------------
 *  唐奇安通道 (Donchian Channel)
 *  ------------------------------------------------------------------ */

export interface DonchianChannelResult {
  upper: number;
  lower: number;
  middle: number;
}

export function donchianChannel(
  highs: number[],
  lows: number[],
  period: number,
): DonchianChannelResult {
  const upper = highest(highs, period);
  const lower = lowest(lows, period);
  return {
    upper,
    lower,
    middle: (upper + lower) / 2,
  };
}
