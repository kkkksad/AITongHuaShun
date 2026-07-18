import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  Database,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { DataQualityReport } from "../../shared/trading";
import type { ConnectionState } from "../hooks/useTradingBackend";
import { fetchMarketDataQuality } from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

interface MarketDataQualityStripProps {
  connectionState: ConnectionState;
}

interface MarketDataQualityContentProps {
  isFetching: boolean;
  onRefresh: () => void;
  report: DataQualityReport;
}

export interface MarketQualityView {
  stateLabel: string;
  stateDescription: string;
  coverage: string;
  issueCount: number;
  issueText: string;
  providerLabel: string;
}

const stateLabels: Record<DataQualityReport["qualityState"], string> = {
  healthy: "数据可用",
  degraded: "谨慎使用",
  unusable: "数据不足",
};

const stateDescriptions: Record<DataQualityReport["qualityState"], string> = {
  healthy: "当前报价覆盖和新鲜度满足只读研究需要",
  degraded: "部分报价缺失、陈旧或异常，研究结论需要降级解读",
  unusable: "当前行情不足，不应据此形成研究判断",
};

function formatProvider(provider: string): string {
  if (provider === "akshare") return "AkShare 真实只读";
  if (provider === "mock") return "本地模拟行情";
  return provider;
}

function formatQualityTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "时间未知";
  return timestamp.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function buildMarketQualityView(
  report: DataQualityReport,
): MarketQualityView {
  const missingCount = report.missingSymbols.length;
  const coverageIssueCount = Math.max(
    0,
    report.requestedSymbols - report.validSymbols,
  );
  const invalidCount = Math.max(0, coverageIssueCount - missingCount);
  const { staleCount, anomalyPriceCount, adjustmentWarningCount } = report.score;
  const issueCount = coverageIssueCount + staleCount + anomalyPriceCount +
    adjustmentWarningCount;
  const issueParts = [
    missingCount > 0 ? `缺失 ${missingCount}` : null,
    invalidCount > 0 ? `无效 ${invalidCount}` : null,
    staleCount > 0 ? `陈旧 ${staleCount}` : null,
    anomalyPriceCount > 0 ? `价格异常 ${anomalyPriceCount}` : null,
    adjustmentWarningCount > 0 ? `复权风险 ${adjustmentWarningCount}` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    stateLabel: stateLabels[report.qualityState],
    stateDescription: stateDescriptions[report.qualityState],
    coverage: `${report.validSymbols} / ${report.requestedSymbols}`,
    issueCount,
    issueText: issueParts.length > 0 ? issueParts.join(" · ") : "未发现阻断性问题",
    providerLabel: formatProvider(report.provider),
  };
}

function QualityStateIcon({ state }: { state: DataQualityReport["qualityState"] }) {
  if (state === "healthy") return <ShieldCheck size={16} />;
  if (state === "degraded") return <TriangleAlert size={16} />;
  return <CircleAlert size={16} />;
}

export function MarketDataQualityContent({
  isFetching,
  onRefresh,
  report,
}: MarketDataQualityContentProps) {
  const view = buildMarketQualityView(report);

  return (
    <>
      <div className="market-quality-header">
        <div className="market-quality-title">
          <Database size={18} />
          <div>
            <span className="section-kicker">只读诊断</span>
            <h2>A 股数据质量</h2>
          </div>
        </div>
        <div className="market-quality-actions">
          <span className={`market-quality-state state-${report.qualityState}`}>
            <QualityStateIcon state={report.qualityState} />
            {view.stateLabel}
          </span>
          <button
            aria-label="刷新行情数据质量"
            className="icon-button"
            disabled={isFetching}
            onClick={onRefresh}
            title="刷新"
            type="button"
          >
            <RefreshCw className={isFetching ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="market-quality-grid">
        <div>
          <span>综合质量</span>
          <strong>{report.score.overall}<small> / 100</small></strong>
        </div>
        <div>
          <span>整批新鲜度</span>
          <strong>{report.score.freshness}<small> / 100</small></strong>
        </div>
        <div>
          <span>请求覆盖</span>
          <strong>{view.coverage}</strong>
        </div>
        <div>
          <span>关键问题</span>
          <strong>{view.issueCount}</strong>
        </div>
      </div>

      <div className="market-quality-footer">
        <span>{view.providerLabel} · {formatQualityTime(report.timestamp)}</span>
        <strong>{view.stateDescription}</strong>
        <small>{view.issueText}</small>
      </div>
    </>
  );
}

export function MarketDataQualityStrip({
  connectionState,
}: MarketDataQualityStripProps) {
  const connected = connectionState === "connected";
  const qualityQuery = useQuery({
    queryKey: ["market-data-quality"],
    queryFn: ({ signal }) => fetchMarketDataQuality(signal),
    enabled: connected,
    refetchInterval: connected ? 30_000 : false,
    staleTime: 20_000,
  });

  return (
    <section aria-label="A 股行情数据质量" className="market-data-quality">
      {qualityQuery.data ? (
        <MarketDataQualityContent
          isFetching={qualityQuery.isFetching}
          onRefresh={() => void qualityQuery.refetch()}
          report={qualityQuery.data}
        />
      ) : (
        <div className="market-quality-header">
          <div className="market-quality-title">
            <Database size={18} />
            <div>
              <span className="section-kicker">只读诊断</span>
              <h2>A 股数据质量</h2>
            </div>
          </div>
          <span className="market-quality-state state-unusable">
            <CircleAlert size={16} />
            {connected ? "检查中" : "后端离线"}
          </span>
        </div>
      )}

      {!connected ? (
        <div className="market-quality-offline">后端恢复连接后自动检查行情覆盖与新鲜度</div>
      ) : (
        <ResearchQueryState
          dataUpdatedAt={qualityQuery.dataUpdatedAt}
          hasData={Boolean(qualityQuery.data)}
          isError={qualityQuery.isError}
          isLoading={qualityQuery.isLoading}
          loadingText="正在检查行情覆盖与新鲜度…"
          unavailableText="行情质量接口暂不可用；其他市场模块仍按各自来源状态显示。"
        />
      )}
    </section>
  );
}
