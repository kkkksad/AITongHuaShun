import type { TradingMode } from "../../shared/trading";
import { fetchBridgeJson } from "./bridgeRequest";

export type IpoSubscriptionStatus =
  | "open-today"
  | "upcoming"
  | "awaiting-listing"
  | "listed-recently";

export type IpoRecommendation =
  | "consider"
  | "cautious"
  | "avoid"
  | "wait-for-pricing"
  | "closed";

export interface BridgeIpoSubscriptionItem {
  symbol: string;
  name: string;
  subscriptionCode: string;
  exchange: string;
  board: string;
  issueTotalWanShares: number | null;
  onlineIssueShares: number | null;
  marketValueRequirementWan: number | null;
  maxSubscriptionShares: number | null;
  issuePrice: number | null;
  latestPrice: number | null;
  subscriptionDate: string | null;
  ballotDate: string | null;
  paymentDate: string | null;
  listingDate: string | null;
  issuePe: number | null;
  industryPe: number | null;
  winningRate: number | null;
  firstDayChangePercent: number | null;
}

interface BridgeIpoSubscriptionsResponse {
  provider?: string;
  source?: string;
  fetchedAt?: string;
  items?: BridgeIpoSubscriptionItem[];
  warning?: string | null;
}

export interface IpoSubscriptionResearchItem extends BridgeIpoSubscriptionItem {
  status: IpoSubscriptionStatus;
  score: number | null;
  recommendation: IpoRecommendation;
  reasons: string[];
  risks: string[];
}

export interface IpoSubscriptionResearchReport {
  generatedAt: string;
  mode: TradingMode;
  provider: string;
  sourceStatus: "live-read-only" | "degraded" | "mock-disabled";
  source: string;
  fetchedAt: string | null;
  window: {
    lookbackDays: 30;
    lookaheadDays: 30;
  };
  counts: {
    openToday: number;
    upcoming: number;
    awaitingListing: number;
    listedRecently: number;
  };
  methodology: {
    version: "1.0.0";
    scoreMeaning: string;
    recommendationMeaning: string;
  };
  items: IpoSubscriptionResearchItem[];
  warning: string | null;
  guardrails: string[];
}

export interface IpoSubscriptionResearchInput {
  bridgeUrl: string;
  bridgeToken?: string;
  marketDataProvider: string;
  mode: TradingMode;
  timeoutMs: number;
  limit?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1_000;
const LOOKBACK_DAYS = 30 as const;
const LOOKAHEAD_DAYS = 30 as const;

function chinaDate(value: Date): string {
  return new Date(value.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

function dateDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / DAY_MS) : null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function classifyStatus(
  item: BridgeIpoSubscriptionItem,
  todayDay: number,
): IpoSubscriptionStatus | null {
  const subscriptionDay = dateDay(item.subscriptionDate);
  const listingDay = dateDay(item.listingDate);
  if (subscriptionDay !== null && subscriptionDay === todayDay) {
    return "open-today";
  }
  if (
    subscriptionDay !== null &&
    subscriptionDay > todayDay &&
    subscriptionDay - todayDay <= LOOKAHEAD_DAYS
  ) {
    return "upcoming";
  }
  if (
    listingDay !== null &&
    listingDay <= todayDay &&
    todayDay - listingDay <= LOOKBACK_DAYS
  ) {
    return "listed-recently";
  }
  if (
    subscriptionDay !== null &&
    subscriptionDay < todayDay &&
    todayDay - subscriptionDay <= LOOKBACK_DAYS &&
    (listingDay === null || listingDay > todayDay)
  ) {
    return "awaiting-listing";
  }
  return null;
}

function boardRisks(item: BridgeIpoSubscriptionItem): string[] {
  if (item.board === "科创板" || item.symbol.startsWith("688")) {
    return ["科创板申购需要相应交易权限，并适用更高波动风险。"];
  }
  if (
    item.board === "创业板" ||
    item.symbol.startsWith("300") ||
    item.symbol.startsWith("301")
  ) {
    return ["创业板申购需要相应交易权限，并适用注册制新股风险。"];
  }
  if (item.board.includes("北交") || item.symbol.startsWith("92")) {
    return ["北交所需要相应交易权限，申购资金与配售规则不同于沪深新股。"];
  }
  return [];
}

function scoreSubscription(
  item: BridgeIpoSubscriptionItem,
  status: IpoSubscriptionStatus,
): Pick<IpoSubscriptionResearchItem, "score" | "recommendation" | "reasons" | "risks"> {
  const risks = boardRisks(item);
  if (status === "awaiting-listing" || status === "listed-recently") {
    return {
      score: null,
      recommendation: "closed",
      reasons: [status === "listed-recently" ? "已经上市，申购阶段已结束。" : "申购已经结束，等待上市。"],
      risks,
    };
  }
  if (
    item.issuePrice === null ||
    item.issuePe === null ||
    item.industryPe === null ||
    item.industryPe <= 0
  ) {
    return {
      score: null,
      recommendation: "wait-for-pricing",
      reasons: ["发行价或发行/行业市盈率尚未完整披露，暂不形成申购判断。"],
      risks: [...risks, "等待定价后重新计算估值分数。"],
    };
  }

  const peRatio = item.issuePe / item.industryPe;
  let score = 50;
  if (peRatio <= 0.8) score += 20;
  else if (peRatio <= 1) score += 10;
  else if (peRatio <= 1.25) score -= 5;
  else if (peRatio <= 2) score -= 20;
  else score -= 35;

  if (item.issuePrice <= 20) score += 5;
  else if (item.issuePrice > 100) score -= 15;
  else if (item.issuePrice > 50) score -= 8;
  score = round(clamp(score, 0, 100));

  const reasons = [
    `发行市盈率为行业市盈率的 ${(peRatio * 100).toFixed(0)}%。`,
    `发行价 ${item.issuePrice.toFixed(2)} 元。`,
  ];
  if (peRatio > 1.25) {
    risks.push("发行估值明显高于行业水平，破发与估值回落风险较高。");
  } else {
    risks.push("新股仍可能破发，估值折价不等于确定收益。");
  }

  return {
    score,
    recommendation: score >= 68 ? "consider" : score >= 40 ? "cautious" : "avoid",
    reasons,
    risks,
  };
}

function emptyCounts(): IpoSubscriptionResearchReport["counts"] {
  return {
    openToday: 0,
    upcoming: 0,
    awaitingListing: 0,
    listedRecently: 0,
  };
}

function baseReport(
  input: IpoSubscriptionResearchInput,
  generatedAt: string,
): Omit<IpoSubscriptionResearchReport, "sourceStatus" | "source" | "fetchedAt" | "items" | "warning"> {
  return {
    generatedAt,
    mode: input.mode,
    provider: input.marketDataProvider,
    window: {
      lookbackDays: LOOKBACK_DAYS,
      lookaheadDays: LOOKAHEAD_DAYS,
    },
    counts: emptyCounts(),
    methodology: {
      version: "1.0.0",
      scoreMeaning: "0-100 为发行时估值与价格规则分数，不是中签率或上市上涨概率。",
      recommendationMeaning: "可关注申购只表示当前公开字段通过启发式估值门槛，不构成个性化投资建议。",
    },
    guardrails: [
      "只使用申购时可见的发行价、发行市盈率、行业市盈率和板块规则，不使用上市后涨幅反推申购建议。",
      "未定价或关键估值字段缺失时只显示等待定价，不补造数据。",
      "该模块只读，不检查账户资格，不连接券商，也不会自动提交新股申购。",
    ],
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export async function buildIpoSubscriptionResearch(
  input: IpoSubscriptionResearchInput,
): Promise<IpoSubscriptionResearchReport> {
  const now = input.now?.() ?? new Date();
  const generatedAt = now.toISOString();
  const base = baseReport(input, generatedAt);
  if (input.marketDataProvider !== "akshare") {
    return {
      ...base,
      sourceStatus: "mock-disabled",
      source: "mock-disabled",
      fetchedAt: null,
      items: [],
      warning: "当前未启用 AkShare，真实新股申购数据不可用且不会使用静态数据替代。",
    };
  }

  const limit = Math.min(80, Math.max(1, Math.round(input.limit ?? 40)));
  const bridgeLimit = Math.min(200, Math.max(80, limit * 2));
  try {
    const bridge = await fetchBridgeJson<BridgeIpoSubscriptionsResponse>({
      url:
        `${trimTrailingSlash(input.bridgeUrl)}` +
        `/api/research/ipo-subscriptions?limit=${bridgeLimit}`,
      token: input.bridgeToken,
      timeoutMs: input.timeoutMs,
      cacheTtlMs: 30 * 60_000,
      fetchImpl: input.fetchImpl ?? fetch,
    });
    const todayDay = dateDay(chinaDate(now))!;
    const statusOrder: Record<IpoSubscriptionStatus, number> = {
      "open-today": 0,
      upcoming: 1,
      "awaiting-listing": 2,
      "listed-recently": 3,
    };
    const items = (bridge.items ?? [])
      .flatMap((item) => {
        const status = classifyStatus(item, todayDay);
        if (!status) return [];
        return [{
          ...item,
          status,
          ...scoreSubscription(item, status),
        }];
      })
      .sort((left, right) => {
        const statusDifference = statusOrder[left.status] - statusOrder[right.status];
        if (statusDifference !== 0) return statusDifference;
        const leftDate = left.status === "listed-recently"
          ? left.listingDate
          : left.subscriptionDate;
        const rightDate = right.status === "listed-recently"
          ? right.listingDate
          : right.subscriptionDate;
        return left.status === "upcoming"
          ? String(leftDate).localeCompare(String(rightDate))
          : String(rightDate).localeCompare(String(leftDate));
      })
      .slice(0, limit);
    const counts = emptyCounts();
    for (const item of items) {
      if (item.status === "open-today") counts.openToday += 1;
      else if (item.status === "upcoming") counts.upcoming += 1;
      else if (item.status === "awaiting-listing") counts.awaitingListing += 1;
      else counts.listedRecently += 1;
    }

    return {
      ...base,
      sourceStatus: bridge.warning ? "degraded" : "live-read-only",
      source: bridge.source ?? "unknown",
      fetchedAt: bridge.fetchedAt ?? null,
      counts,
      items,
      warning: bridge.warning ?? null,
    };
  } catch {
    return {
      ...base,
      sourceStatus: "degraded",
      source: "unavailable",
      fetchedAt: null,
      items: [],
      warning: "真实新股申购源暂不可用，请稍后重试。",
    };
  }
}
