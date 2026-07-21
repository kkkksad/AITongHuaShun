import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bitcoin,
  Database,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  fetchCryptoMarketResearch,
  type CryptoMarketResearchReport,
  type ExternalCryptoItem,
  type ExternalSignalTone,
} from "../lib/tradingApi";
import { getResearchRefreshState } from "../lib/researchQueryPresentation";
import { ResearchQueryState } from "./ResearchQueryState";

const toneLabels: Record<ExternalSignalTone, string> = {
  positive: "风险偏好偏强",
  neutral: "风险偏好中性",
  negative: "风险偏好偏弱",
  unavailable: "当前不可用",
};

export interface CryptoPanelRow extends ExternalCryptoItem {
  rangePosition: number | null;
}

export function buildCryptoPanelRows(
  report: CryptoMarketResearchReport | undefined,
): CryptoPanelRow[] {
  return (report?.crypto ?? []).map((item) => ({
    ...item,
    rangePosition:
      item.high24h !== null &&
      item.low24h !== null &&
      item.high24h > item.low24h
        ? Math.max(0, Math.min(1,
            (item.priceUsd - item.low24h) / (item.high24h - item.low24h),
          ))
        : null,
  }));
}

function formatUsd(value: number | null): string {
  if (value === null) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompact(value: number | null): string {
  if (value === null) return "--";
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function CryptoMarketPanel() {
  const query = useQuery({
    queryKey: ["crypto-market"],
    queryFn: ({ signal }) => fetchCryptoMarketResearch(signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;
  const rows = buildCryptoPanelRows(report);
  const refreshState = getResearchRefreshState({
    hasData: Boolean(report),
    isError: query.isError,
  });
  const sourceLabel = refreshState.showStaleWarning
    ? "缓存"
    : report?.sourceStatus === "live-read-only"
      ? "真实只读"
      : report
        ? "降级"
        : "离线";
  const cryptoRationale = report?.aShareContext.summary ??
    "数字资产只作为全球风险偏好的辅助证据，不单独改变 A 股策略方向。";

  return (
    <section className="panel crypto-market-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">全球风险偏好 · 美元计价</span>
          <h2>数字资产观察</h2>
        </div>
        <div className="research-panel-actions">
          <span className={`research-source-status ${sourceLabel === "真实只读" ? "live" : "degraded"}`}>
            <Database size={14} />{sourceLabel}
          </span>
          <button
            aria-label="刷新数字资产快照"
            className="icon-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            title="刷新"
            type="button"
          >
            <RefreshCw className={query.isFetching ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <ResearchQueryState
        dataUpdatedAt={query.dataUpdatedAt}
        hasData={Boolean(report)}
        isError={query.isError}
        isLoading={query.isLoading}
        loadingText="正在读取 BTC/ETH 快照…"
        unavailableText="数字资产快照暂不可用，请检查后端与行情桥接。"
      />

      {report && (
        <>
          <div className="crypto-summary-strip">
            <div>
              <span>当前状态</span>
              <strong>{toneLabels[report.market.tone]}</strong>
            </div>
            <div>
              <span>有效来源</span>
              <strong>{report.market.coverage}</strong>
            </div>
            <div>
              <span>平均 24h 涨跌</span>
              <strong className={(report.market.averageChangePercent ?? 0) >= 0 ? "positive" : "negative"}>
                {report.market.averageChangePercent == null
                  ? "--"
                  : formatPercent(report.market.averageChangePercent)}
              </strong>
            </div>
            <div>
              <span>数据时间</span>
              <strong>{report.market.asOf ? new Date(report.market.asOf).toLocaleString("zh-CN", { hour12: false }) : "--"}</strong>
            </div>
          </div>

          <div className="crypto-quote-grid">
            {rows.map((item) => (
              <article className="crypto-quote-item" key={item.symbol}>
                <div className="crypto-quote-heading">
                  <Bitcoin size={18} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.symbol} · USD</span>
                  </div>
                  <strong className={item.change24hPercent >= 0 ? "positive" : "negative"}>
                    {formatPercent(item.change24hPercent)}
                  </strong>
                </div>
                <div className="crypto-quote-price">{formatUsd(item.priceUsd)}</div>
                <dl className="crypto-quote-details">
                  <div><dt>24h 高</dt><dd>{formatUsd(item.high24h)}</dd></div>
                  <div><dt>24h 低</dt><dd>{formatUsd(item.low24h)}</dd></div>
                  <div><dt>区间位置</dt><dd>{item.rangePosition === null ? "--" : `${(item.rangePosition * 100).toFixed(0)}%`}</dd></div>
                  <div><dt>24h 成交量</dt><dd>{formatCompact(item.volume24h)}</dd></div>
                </dl>
                <small>{item.source} · {new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</small>
              </article>
            ))}
            {rows.length === 0 && (
              <div className="research-empty">BTC/ETH 当前没有有效报价，不使用静态价格补位。</div>
            )}
          </div>

          <div className="crypto-impact-band">
            <Activity size={17} />
            <div>
              <strong>对 A 股的辅助观察</strong>
              <span>{cryptoRationale}</span>
            </div>
          </div>

          <div className="research-alert regime-source-ok">
            <ShieldCheck size={16} />
            <span>本模块只读，不提供数字资产账户、订单或收益预测。</span>
          </div>
          {report.warnings.some((warning) => /BTC|ETH|数字资产|crypto/i.test(warning)) && (
            <div className="research-alert regime-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings.filter((warning) => /BTC|ETH|数字资产|crypto/i.test(warning)).slice(0, 2).join("；")}</span>
            </div>
          )}
          <div className="research-source-row">
            <Database size={15} />
            <span>{report.source.name} · {report.source.itemCount} 个快照 · 只读研究</span>
          </div>
        </>
      )}
    </section>
  );
}
