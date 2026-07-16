import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Globe2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  fetchHongKongMarketResearch,
  type HongKongTrend,
} from "../lib/tradingApi";

const trendLabels: Record<HongKongTrend, string> = {
  uptrend: "上升趋势",
  recovering: "修复观察",
  range: "区间震荡",
  weakening: "结构转弱",
  downtrend: "下行趋势",
  "insufficient-data": "数据不足",
};

function signedPercent(value: number | null): string {
  if (value === null) return "未取得";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function quotePercent(value: number | null): string {
  if (value === null) return "未取得";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function probability(value: number | null): string {
  return value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`;
}

function amount(value: number | null): string {
  if (value === null) return "成交额未取得";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿港元`;
  return `${(value / 10_000).toFixed(0)} 万港元`;
}

function trendClass(trend: HongKongTrend): string {
  if (trend === "uptrend" || trend === "recovering") return "gate-pass";
  if (trend === "downtrend" || trend === "weakening") return "gate-blocked";
  return "gate-caution";
}

export function HongKongMarketPanel() {
  const query = useQuery({
    queryKey: ["hong-kong-market", 10, 180],
    queryFn: () => fetchHongKongMarketResearch(10, 180),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;

  return (
    <section className="panel hong-kong-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">港股真实只读行情</span>
          <h2>港股观察</h2>
        </div>
        <button
          aria-label="刷新港股观察"
          className="icon-button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          title="刷新"
          type="button"
        >
          <RefreshCw className={query.isFetching ? "spin" : ""} size={17} />
        </button>
      </div>

      {query.isLoading && (
        <div className="research-empty">正在读取港股快照与前复权日线…</div>
      )}
      {query.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>港股研究暂不可用，请检查 API 与 AkShare 行情桥接。</span>
        </div>
      )}

      {report && (
        <>
          <div className="regime-meta-strip hk-meta-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "降级"}</strong>
            </div>
            <div>
              <span>行情样本</span>
              <strong>{report.source.quoteCount}</strong>
            </div>
            <div>
              <span>历史样本</span>
              <strong>{report.source.historyCount}</strong>
            </div>
            <div>
              <span>历史窗口</span>
              <strong>{report.source.requestedDays} 日</strong>
            </div>
            <div>
              <span>复权</span>
              <strong>前复权</strong>
            </div>
          </div>

          <div className="research-alert regime-source-ok">
            <ShieldCheck size={16} />
            <span>{report.methodology.validationMeaning} 港股研究不会进入 A 股模拟交易。</span>
          </div>

          {report.warnings.length > 0 && (
            <div className="research-alert regime-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings[0]}</span>
            </div>
          )}

          <div className="regime-table-wrap">
            {report.items.length === 0 ? (
              <div className="research-empty">当前没有取得可用港股历史样本。</div>
            ) : (
              <table className="data-table hong-kong-table">
                <thead>
                  <tr>
                    <th>港股</th>
                    <th>最新价</th>
                    <th>趋势</th>
                    <th>5 / 20 / 60 日</th>
                    <th>波动 / 回撤</th>
                    <th>同趋势验证</th>
                    <th>量能</th>
                    <th>依据 / 风险</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.symbol}>
                      <td className="symbol-cell">
                        <strong>{item.name}</strong>
                        <span className="table-subline">
                          {item.symbol} · {item.barCount} 根
                        </span>
                      </td>
                      <td className={(item.changePercent ?? 0) >= 0 ? "positive" : "negative"}>
                        <strong>{item.price?.toFixed(2) ?? "未取得"}</strong>
                        <span className="table-subline">{quotePercent(item.changePercent)}</span>
                      </td>
                      <td>
                        <span className={`rank-badge ${trendClass(item.trend)}`}>
                          {trendLabels[item.trend]}
                        </span>
                        <span className="table-subline">规则分 {item.score.toFixed(0)}</span>
                      </td>
                      <td>
                        {signedPercent(item.factors.return5d)} / {signedPercent(item.factors.return20d)}
                        <span className="table-subline">60 日 {signedPercent(item.factors.return60d)}</span>
                      </td>
                      <td>
                        年化 {(item.factors.annualizedVolatility20d * 100).toFixed(1)}%
                        <span className="table-subline negative">
                          高点回撤 {signedPercent(item.factors.drawdownFrom20DayHigh)}
                        </span>
                      </td>
                      <td>
                        上涨 {probability(item.validation.upProbability5d)}
                        <span className="table-subline">
                          {item.validation.samples} 个样本 · 均值 {signedPercent(item.validation.averageForwardReturn5d)}
                        </span>
                      </td>
                      <td>
                        {item.factors.volumeRatio5d.toFixed(2)}x
                        <span className="table-subline">{amount(item.amount)}</span>
                      </td>
                      <td className="regime-reason-cell">
                        {item.evidence[0] ?? item.riskFlags[0]}
                        {item.riskFlags[0] && item.evidence[0] && (
                          <span className="table-subline negative">{item.riskFlags[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="research-source-row">
            <Globe2 size={15} />
            <span>
              {report.source.quoteSource} + {report.source.historySource} · 更新 {report.source.fetchedAt
                ? new Date(report.source.fetchedAt).toLocaleString("zh-CN")
                : "未知"} · 不读取港股账户
            </span>
          </div>
        </>
      )}
    </section>
  );
}
