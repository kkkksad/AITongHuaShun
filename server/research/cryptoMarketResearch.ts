import type { TradingMode } from "../../shared/trading";
import { bridgeErrorMessage, fetchBridgeJson } from "./bridgeRequest";

export type CryptoMarketTone = "positive" | "neutral" | "negative" | "unavailable";

export interface CryptoMarketResearchItem {
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPercent: number;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  updatedAt: string;
  source: string;
}

export interface CryptoMarketResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: {
    name: string;
    fetchedAt: string | null;
    itemCount: number;
  };
  market: {
    tone: CryptoMarketTone;
    coverage: number;
    averageChangePercent: number | null;
    asOf: string | null;
  };
  crypto: CryptoMarketResearchItem[];
  aShareContext: {
    bias: "supportive" | "neutral" | "restrictive";
    summary: string;
  };
  warnings: string[];
  guardrails: string[];
}

interface BridgeCryptoResponse {
  provider: string;
  source: string;
  fetchedAt: string;
  items: CryptoMarketResearchItem[];
  warning?: string | null;
}

function toneForChange(value: number | null): CryptoMarketTone {
  if (value === null) return "unavailable";
  if (value >= 1.5) return "positive";
  if (value <= -1.5) return "negative";
  return "neutral";
}

export function boundedCryptoBridgeTimeoutMs(timeoutMs: number): number {
  return Math.min(5_000, Math.max(1_000, timeoutMs));
}

function baseReport(input: {
  mode: TradingMode;
  provider: string;
  generatedAt: string;
}): CryptoMarketResearchReport {
  return {
    generatedAt: input.generatedAt,
    mode: input.mode,
    provider: input.provider,
    sourceStatus: "degraded",
    source: { name: "unavailable", fetchedAt: null, itemCount: 0 },
    market: {
      tone: "unavailable",
      coverage: 0,
      averageChangePercent: null,
      asOf: null,
    },
    crypto: [],
    aShareContext: {
      bias: "neutral",
      summary: "BTC/ETH 当前不可用，不用静态价格补位，也不改变 A 股策略方向。",
    },
    warnings: [],
    guardrails: [
      "数字资产数据只用于全球风险偏好观察。",
      "本模块不提供数字资产账户、订单或收益预测。",
      "数字资产信号不能单独提高 A 股仓位。",
    ],
  };
}

export async function buildCryptoMarketResearch(input: {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}): Promise<CryptoMarketResearchReport> {
  const generatedAt = (input.clock?.() ?? new Date()).toISOString();
  const base = baseReport({
    mode: input.mode,
    provider: input.marketDataProvider,
    generatedAt,
  });
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      warnings: ["当前未启用 AkShare，不使用静态币价替代真实来源。"],
    };
  }

  try {
    const response = await fetchBridgeJson<BridgeCryptoResponse>({
      url: `${input.bridgeUrl.replace(/\/+$/, "")}/api/market/crypto/quotes`,
      token: input.bridgeToken,
      timeoutMs: boundedCryptoBridgeTimeoutMs(input.timeoutMs),
      cacheTtlMs: 2 * 60_000,
      fetchImpl: input.fetchImpl,
    });
    const items = response.items.filter((item) => (
      (item.symbol === "BTCUSD" || item.symbol === "ETHUSD") &&
      Number.isFinite(item.priceUsd) &&
      item.priceUsd > 0 &&
      Number.isFinite(item.change24hPercent)
    ));
    const averageChangePercent = items.length > 0
      ? Number((items.reduce(
          (sum, item) => sum + item.change24hPercent,
          0,
        ) / items.length).toFixed(2))
      : null;
    const tone = toneForChange(averageChangePercent);
    const bias = tone === "positive"
      ? "supportive"
      : tone === "negative"
        ? "restrictive"
        : "neutral";
    const summary = averageChangePercent === null
      ? "BTC/ETH 当前不可用，不用静态价格补位，也不改变 A 股策略方向。"
      : `BTC/ETH 24 小时平均涨跌 ${averageChangePercent >= 0 ? "+" : ""}${averageChangePercent.toFixed(2)}%，只补充全球风险偏好证据，不能单独改变 A 股方向。`;

    return {
      ...base,
      sourceStatus: items.length > 0 ? "live-read-only" : "degraded",
      source: {
        name: response.source,
        fetchedAt: response.fetchedAt,
        itemCount: items.length,
      },
      market: {
        tone,
        coverage: items.length,
        averageChangePercent,
        asOf: items.map((item) => item.updatedAt).sort().at(-1) ?? null,
      },
      crypto: items,
      aShareContext: { bias, summary },
      warnings: [response.warning].filter((value): value is string => Boolean(value)),
    };
  } catch (error) {
    return {
      ...base,
      warnings: [`BTC/ETH 快照暂不可用: ${bridgeErrorMessage(error)}`],
    };
  }
}
