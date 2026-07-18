import type { ExternalMarketImpactReport } from "./externalMarketImpact";
import type { ExternalMarketFeatureUpdate } from "./externalMarketFeatureStore";

interface ExternalMarketFeatureCaptureOptions {
  store: {
    upsert(update: ExternalMarketFeatureUpdate): unknown;
  };
  buildReport: () => Promise<ExternalMarketImpactReport>;
  fetchHs300CloseReturn: () => Promise<number | null>;
  clock?: () => Date;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

interface FetchHs300CloseReturnInput {
  bridgeUrl: string;
  bridgeToken?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface BridgeIndexResponse {
  quotes: Array<{
    symbol: string;
    changePercent: number;
  }>;
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function chinaParts(value: Date) {
  const shifted = new Date(value.getTime() + CHINA_OFFSET_MS);
  return {
    tradeDate: shifted.toISOString().slice(0, 10),
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function percentToDecimal(value: number | null | undefined): number | null {
  return value === null || value === undefined
    ? null
    : Math.round(value * 10_000) / 1_000_000;
}

export async function fetchHs300CloseReturnFromBridge(
  input: FetchHs300CloseReturnInput,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const baseUrl = input.bridgeUrl.replace(/\/+$/, "");
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${baseUrl}/api/market/indices?symbols=SH000300`,
      {
        headers: {
          Accept: "application/json",
          ...(input.bridgeToken
            ? { Authorization: `Bearer ${input.bridgeToken}` }
            : {}),
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`HS300 bridge HTTP ${response.status}`);
    }
    const payload = await response.json() as BridgeIndexResponse;
    const quote = payload.quotes.find((item) => item.symbol === "SH000300");
    return quote && Number.isFinite(quote.changePercent)
      ? percentToDecimal(quote.changePercent)
      : null;
  } finally {
    clearTimeout(timer);
  }
}

export class ExternalMarketFeatureCapture {
  private readonly store: ExternalMarketFeatureCaptureOptions["store"];
  private readonly buildReport: ExternalMarketFeatureCaptureOptions["buildReport"];
  private readonly fetchHs300CloseReturn: ExternalMarketFeatureCaptureOptions["fetchHs300CloseReturn"];
  private readonly clock: () => Date;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly completedStages = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(options: ExternalMarketFeatureCaptureOptions) {
    this.store = options.store;
    this.buildReport = options.buildReport;
    this.fetchHs300CloseReturn = options.fetchHs300CloseReturn;
    this.clock = options.clock ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? 60_000;
    this.onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce().catch(this.onError);
    this.timer = setInterval(() => {
      void this.runOnce().catch(this.onError);
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    const now = this.clock();
    const { tradeDate, day, minutes } = chinaParts(now);
    if (day === 0 || day === 6) return;

    if (minutes >= 9 * 60 + 20 && minutes <= 9 * 60 + 29) {
      const stageKey = `${tradeDate}:pre-market`;
      if (this.completedStages.has(stageKey)) return;
      const report = await this.buildReport();
      const marketBySymbol = new Map(
        report.markets.map((market) => [market.symbol, market]),
      );
      const cryptoBySymbol = new Map(
        report.crypto.map((item) => [item.symbol, item]),
      );
      const usGroup = report.groups.find((group) => group.key === "us-overnight");
      this.store.upsert({
        tradeDate,
        capturedAt: now.toISOString(),
        usOvernightReturn: percentToDecimal(usGroup?.averageChangePercent),
        japanOpenReturn: percentToDecimal(marketBySymbol.get("N225")?.changePercent),
        koreaOpenReturn: percentToDecimal(marketBySymbol.get("KOSPI")?.changePercent),
        hongKongOpenReturn: percentToDecimal(marketBySymbol.get("HSI")?.changePercent),
        btcOvernightReturn: percentToDecimal(
          cryptoBySymbol.get("BTCUSD")?.change24hPercent,
        ),
        ethOvernightReturn: percentToDecimal(
          cryptoBySymbol.get("ETHUSD")?.change24hPercent,
        ),
      });
      this.completedStages.add(stageKey);
      return;
    }

    if (minutes >= 15 * 60 + 10 && minutes <= 15 * 60 + 19) {
      const stageKey = `${tradeDate}:close-label`;
      if (this.completedStages.has(stageKey)) return;
      const hs300CloseReturn = await this.fetchHs300CloseReturn();
      this.store.upsert({
        tradeDate,
        capturedAt: now.toISOString(),
        hs300CloseReturn,
      });
      this.completedStages.add(stageKey);
    }
  }
}
