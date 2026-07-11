import type { MarketSnapshot } from "../../shared/trading";
import type { DailyCandidateReport } from "./dailyCandidates";
import type { DailyQualityStockReport } from "./dailyQualityStocks";
import type { StrategyLeaderboardReport } from "./strategyLeaderboard";

type ResearchRunKind = "strategy-leaderboard" | "daily-candidates" | "daily-quality-stocks";

export interface MarketSnapshotSample {
  recordedAt: string;
  provider: string;
  mode: MarketSnapshot["mode"];
  sequence: number;
  marketTime: string;
  quoteCount: number;
  tradableCount: number;
  topSymbols: string[];
}

export interface ResearchRunSample {
  recordedAt: string;
  kind: ResearchRunKind;
  provider: string;
  mode: MarketSnapshot["mode"];
  snapshotSequence: number;
  snapshotTime: string;
  itemCount: number;
  topSymbols: string[];
  summary: string;
}

export interface LearningState {
  generatedAt: string;
  dataMemory: {
    storage: "in-memory";
    marketSnapshotSamples: number;
    researchRuns: number;
    firstSnapshotTime: string | null;
    latestSnapshotTime: string | null;
    providersSeen: string[];
    symbolsSeen: number;
    topSymbols: string[];
  };
  researchLoop: {
    strategyLeaderboardRuns: number;
    dailyCandidateRuns: number;
    dailyQualityRuns: number;
    latestRuns: ResearchRunSample[];
  };
  currentCapability: {
    realtimeQuotes: boolean;
    historicalBars: boolean;
    paperExecution: boolean;
    liveExecution: false;
    statement: string;
  };
  nextDataNeeds: string[];
  guardrails: string[];
}

const MAX_SNAPSHOT_SAMPLES = 720;
const MAX_RESEARCH_RUNS = 240;

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function summarizeSnapshot(snapshot: MarketSnapshot, provider: string): MarketSnapshotSample {
  const tradableQuotes = snapshot.quotes.filter((quote) => quote.tradable && quote.price > 0);
  const topSymbols = tradableQuotes
    .slice()
    .sort((a, b) => b.volume * b.price - a.volume * a.price)
    .slice(0, 8)
    .map((quote) => quote.symbol);

  return {
    recordedAt: new Date().toISOString(),
    provider,
    mode: snapshot.mode,
    sequence: snapshot.sequence,
    marketTime: snapshot.marketTime,
    quoteCount: snapshot.quotes.length,
    tradableCount: tradableQuotes.length,
    topSymbols,
  };
}

export class InMemoryResearchStore {
  private marketSnapshots: MarketSnapshotSample[] = [];
  private researchRuns: ResearchRunSample[] = [];

  recordMarketSnapshot(snapshot: MarketSnapshot, provider: string): void {
    const latest = this.marketSnapshots.at(-1);
    if (latest?.sequence === snapshot.sequence && latest.provider === provider) {
      return;
    }

    this.marketSnapshots.push(summarizeSnapshot(snapshot, provider));
    if (this.marketSnapshots.length > MAX_SNAPSHOT_SAMPLES) {
      this.marketSnapshots.splice(0, this.marketSnapshots.length - MAX_SNAPSHOT_SAMPLES);
    }
  }

  recordStrategyLeaderboard(report: StrategyLeaderboardReport): void {
    this.recordResearchRun({
      recordedAt: new Date().toISOString(),
      kind: "strategy-leaderboard",
      provider: report.source.provider,
      mode: report.source.mode,
      snapshotSequence: report.source.snapshotSequence,
      snapshotTime: report.source.snapshotTime,
      itemCount: report.entries.length,
      topSymbols: report.source.tradableSymbols.slice(0, 8),
      summary: report.entries[0]
        ? `${report.entries[0].strategyName} 胜率 ${(report.entries[0].metrics.winRate * 100).toFixed(1)}%`
        : "暂无可用策略结果",
    });
  }

  recordDailyCandidates(report: DailyCandidateReport): void {
    this.recordResearchRun({
      recordedAt: new Date().toISOString(),
      kind: "daily-candidates",
      provider: report.source.provider,
      mode: report.mode,
      snapshotSequence: report.source.snapshotSequence,
      snapshotTime: report.source.snapshotTime,
      itemCount: report.candidates.length,
      topSymbols: report.candidates.slice(0, 8).map((candidate) => candidate.symbol),
      summary: `${report.candidates.filter((candidate) => candidate.action === "paper-buy").length} 个 paper-buy 候选`,
    });
  }

  recordDailyQualityStocks(report: DailyQualityStockReport): void {
    this.recordResearchRun({
      recordedAt: new Date().toISOString(),
      kind: "daily-quality-stocks",
      provider: report.source.provider,
      mode: report.mode,
      snapshotSequence: report.source.snapshotSequence,
      snapshotTime: report.source.snapshotTime,
      itemCount: report.stocks.length,
      topSymbols: report.stocks.slice(0, 8).map((stock) => stock.symbol),
      summary: `${report.stocks.filter((stock) => stock.action === "focus").length} 个 focus 观察标的`,
    });
  }

  getLearningState(): LearningState {
    const providersSeen = unique([
      ...this.marketSnapshots.map((snapshot) => snapshot.provider),
      ...this.researchRuns.map((run) => run.provider),
    ]).sort();
    const symbolsSeen = unique([
      ...this.marketSnapshots.flatMap((snapshot) => snapshot.topSymbols),
      ...this.researchRuns.flatMap((run) => run.topSymbols),
    ]);
    const runCount = (kind: ResearchRunKind) =>
      this.researchRuns.filter((run) => run.kind === kind).length;

    return {
      generatedAt: new Date().toISOString(),
      dataMemory: {
        storage: "in-memory",
        marketSnapshotSamples: this.marketSnapshots.length,
        researchRuns: this.researchRuns.length,
        firstSnapshotTime: this.marketSnapshots[0]?.marketTime ?? null,
        latestSnapshotTime: this.marketSnapshots.at(-1)?.marketTime ?? null,
        providersSeen,
        symbolsSeen: symbolsSeen.length,
        topSymbols: symbolsSeen.slice(0, 12),
      },
      researchLoop: {
        strategyLeaderboardRuns: runCount("strategy-leaderboard"),
        dailyCandidateRuns: runCount("daily-candidates"),
        dailyQualityRuns: runCount("daily-quality-stocks"),
        latestRuns: this.researchRuns.slice(-5).reverse(),
      },
      currentCapability: {
        realtimeQuotes: providersSeen.length > 0,
        historicalBars: false,
        paperExecution: true,
        liveExecution: false,
        statement:
          "当前学习状态来自运行期内存样本，可用于研究观测；尚未接入授权历史 K 线、真实新闻或真实订单执行。",
      },
      nextDataNeeds: [
        "授权历史日线与分钟线缓存，用于样本外验证。",
        "候选入选后的后验收益、最大回撤和成交可行性记录。",
        "真实新闻、资金流和财务因子只读数据源。",
        "同花顺模拟盘官方接口或导出文件说明，不要提交账号密码或 Token。",
      ],
      guardrails: [
        "学习状态不代表真实收益，也不构成投资建议。",
        "所有订单执行仍保持 paper-only；真实交易必须独立权限域、风控和人工确认。",
        "当前内存样本会随服务重启清空，下一阶段再升级为本地文件或数据库缓存。",
      ],
    };
  }

  private recordResearchRun(sample: ResearchRunSample): void {
    this.researchRuns.push(sample);
    if (this.researchRuns.length > MAX_RESEARCH_RUNS) {
      this.researchRuns.splice(0, this.researchRuns.length - MAX_RESEARCH_RUNS);
    }
  }
}

