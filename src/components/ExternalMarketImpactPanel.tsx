import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bitcoin,
  Database,
  Globe2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  fetchExternalMarketImpact,
  type ExternalImpactBias,
  type ExternalMarketGroup,
  type ExternalSignalTone,
} from "../lib/tradingApi";
import { getResearchRefreshState } from "../lib/researchQueryPresentation";
import { ResearchQueryState } from "./ResearchQueryState";

const biasLabels: Record<ExternalImpactBias, string> = {
  supportive: "偏支持",
  neutral: "中性",
  restrictive: "偏约束",
  conflicted: "方向冲突",
};
const toneLabels: Record<ExternalSignalTone, string> = {
  positive: "偏强",
  neutral: "中性",
  negative: "偏弱",
  unavailable: "不可用",
};
const groupLabels: Record<ExternalMarketGroup["key"], string> = {
  "us-overnight": "美股隔夜",
  asia: "亚洲市场",
  crypto: "数字资产",
};
const evidenceLabels = {
  "snapshot-only": "快照观察",
  "historically-observed": "历史观察",
  "walk-forward-validated": "滚动验证",
} as const;

function toneClass(tone: ExternalSignalTone): string {
  if (tone === "positive") return "positive";
  if (tone === "negative" || tone === "unavailable") return "negative";
  return "";
}

function biasClass(bias: ExternalImpactBias): string {
  if (bias === "supportive") return "positive";
  if (bias === "restrictive" || bias === "conflicted") return "negative";
  return "";
}

function quotePercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function decimalPercent(value: number | null): string {
  if (value === null) return "样本不足";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function compactNumber(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function ExternalMarketImpactPanel() {
  const query = useQuery({
    queryKey: ["external-market-impact", 500],
    queryFn: ({ signal }) => fetchExternalMarketImpact(500, signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;
  const refreshState = getResearchRefreshState({
    hasData: Boolean(report),
    isError: query.isError,
  });
  const sourceState = refreshState.showStaleWarning
    ? "缓存"
    : report?.sourceStatus === "live-read-only"
      ? "真实只读"
      : report
        ? "降级"
        : "离线";

  return (
    <section className="panel external-market-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">隔夜与亚洲时段 · 500 日严格对齐</span>
          <h2>全球市场对 A 股影响</h2>
        </div>
        <div className="research-panel-actions">
          <span className={`research-source-status ${sourceState === "真实只读" ? "live" : "degraded"}`}>
            <Database size={14} />{sourceState}
          </span>
          <button
            aria-label="刷新全球市场影响研究"
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
        loadingText="正在读取美股、亚洲市场、BTC/ETH 与严格对齐历史…"
        unavailableText="当前没有可保留的全球影响研究，请检查后端与 AkShare 桥接。"
      />

      {report && <>
        <div className="regime-meta-strip external-meta-strip">
          <div><span>对 A 股影响</span><strong className={biasClass(report.aShareImpact.bias)}>{biasLabels[report.aShareImpact.bias]}</strong></div>
          <div><span>证据完整度</span><strong>{report.aShareImpact.confidence} / 100</strong></div>
          <div><span>证据等级</span><strong>{evidenceLabels[report.aShareImpact.evidenceGrade]}</strong></div>
          <div><span>历史样本</span><strong>{report.validation.samples}</strong></div>
          <div><span>数据时间</span><strong>{report.source.fetchedAt ? new Date(report.source.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></div>
        </div>

        <div className="external-group-grid">
          {report.groups.map((group) => (
            <article className="external-group-item" key={group.key}>
              <div className="external-group-heading">
                {group.key === "crypto" ? <Bitcoin size={16} /> : <Globe2 size={16} />}
                <span>{groupLabels[group.key]}</span>
                <strong className={toneClass(group.tone)}>{toneLabels[group.tone]}</strong>
              </div>
              <div className="external-group-value">{quotePercent(group.averageChangePercent)}</div>
              <small>{group.coverage} 个来源 · {group.symbols.join(" / ") || "暂无有效数据"}</small>
            </article>
          ))}
        </div>

        <div className="external-impact-detail">
          <div>
            <span className="section-kicker">当前结论</span>
            <h3>{biasLabels[report.aShareImpact.bias]} · 只读观察</h3>
            {report.aShareImpact.rationale.map((item) => <p key={item}>{item}</p>)}
          </div>
          <dl>
            <div><dt>方向命中率</dt><dd>{report.validation.directionalHitRate === null ? "样本不足" : `${(report.validation.directionalHitRate * 100).toFixed(1)}%`}</dd></div>
            <div><dt>方向对齐收益</dt><dd>{decimalPercent(report.validation.averageNextDayReturn)}</dd></div>
            <div><dt>无条件均值</dt><dd>{decimalPercent(report.validation.unconditionalAverageReturn)}</dd></div>
            <div><dt>增量差值</dt><dd>{decimalPercent(report.validation.incrementalReturn)}</dd></div>
          </dl>
        </div>

        <div className="research-alert regime-source-ok">
          <ShieldCheck size={16} />
          <span>{report.guardrails[3]}</span>
        </div>
        {report.warnings.length > 0 && (
          <div className="research-alert regime-warning">
            <AlertTriangle size={16} />
            <span>数据质量：{report.warnings.slice(0, 3).join("；")}{report.warnings.length > 3 ? `；另 ${report.warnings.length - 3} 项` : ""}</span>
          </div>
        )}

        <div className="external-market-table-wrap">
          {report.markets.length === 0 ? (
            <div className="research-empty">当前没有取得可用全球指数快照。</div>
          ) : (
            <table className="data-table external-market-table">
              <thead><tr><th>市场 / 指数</th><th>最新</th><th>涨跌</th><th>会话日期</th><th>报价类型</th><th>来源</th></tr></thead>
              <tbody>{report.markets.map((item) => <tr key={item.symbol}>
                <td className="symbol-cell"><strong>{item.name}</strong><span className="table-subline">{item.region} · {item.symbol}</span></td>
                <td>{item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td>
                <td className={item.changePercent >= 0 ? "positive" : "negative"}>{quotePercent(item.changePercent)}</td>
                <td>{item.sessionDate ?? "未提供"}<span className="table-subline">{item.timezone}</span></td>
                <td>{item.quoteKind === "daily-close" ? "日收盘" : "快照"}</td>
                <td>{item.source}</td>
              </tr>)}</tbody>
            </table>
          )}
        </div>

        <div className="external-crypto-strip">
          {report.crypto.length === 0 ? <span>BTC/ETH 当前不可用</span> : report.crypto.map((item) => (
            <div key={item.symbol}>
              <strong>{item.name} · {item.symbol}</strong>
              <span>${item.priceUsd.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</span>
              <span className={item.change24hPercent >= 0 ? "positive" : "negative"}>{quotePercent(item.change24hPercent)}</span>
              <small>24h 量 {compactNumber(item.volume24h)}</small>
            </div>
          ))}
        </div>
        <div className="research-source-row"><Activity size={15} /><span>{report.source.globalSnapshotSources.join(" + ") || "全球快照不可用"} · {report.source.globalHistorySource} · {report.source.cryptoSource} · 只读研究</span></div>
      </>}
    </section>
  );
}
