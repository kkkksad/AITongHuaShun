import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Database,
  Gauge,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type {
  ApiPerformanceSnapshot,
  ApiPerformanceState,
  RoutePerformanceSnapshot,
} from "../../shared/systemMonitoring";
import { fetchApiPerformance } from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

interface SystemMonitorContentProps {
  isFetching: boolean;
  onRefresh: () => void;
  report: ApiPerformanceSnapshot;
}

const statePresentation: Record<
  ApiPerformanceState,
  { label: string; tone: "neutral" | "positive" | "warning" | "danger" }
> = {
  idle: { label: "等待业务样本", tone: "neutral" },
  healthy: { label: "API 运行健康", tone: "positive" },
  degraded: { label: "API 需要关注", tone: "warning" },
  critical: { label: "API 存在异常", tone: "danger" },
};

function formatMilliseconds(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "时间未知";
  return timestamp.toLocaleTimeString("zh-CN", { hour12: false });
}

function providerLabel(provider: string): string {
  if (provider === "akshare") return "AkShare 真实只读";
  if (provider === "mock") return "本地模拟行情";
  return provider;
}

function qualityLabel(state: ApiPerformanceSnapshot["runtime"]["marketQuality"]["state"]): string {
  if (state === "healthy") return "数据可用";
  if (state === "degraded") return "谨慎使用";
  return "数据不足";
}

function statusTone(status: number): string {
  if (status === 429 || status >= 500) return "danger";
  if (status >= 400) return "warning";
  return "positive";
}

function StateIcon({ state }: { state: ApiPerformanceState }) {
  if (state === "healthy") return <ShieldCheck size={18} />;
  if (state === "idle") return <Activity size={18} />;
  return <AlertTriangle size={18} />;
}

function RouteRow({ route }: { route: RoutePerformanceSnapshot }) {
  return (
    <tr>
      <td><span className="system-route-method">{route.method}</span></td>
      <td><code>{route.route}</code></td>
      <td>{route.requestCount}</td>
      <td>{formatMilliseconds(route.averageMs)}ms</td>
      <td><strong>{formatMilliseconds(route.p95Ms)}ms</strong></td>
      <td>{route.failureCount}</td>
      <td>
        <span className={`system-status-code tone-${statusTone(route.lastStatus)}`}>
          {route.lastStatus}
        </span>
      </td>
    </tr>
  );
}

export function SystemMonitorContent({
  isFetching,
  onRefresh,
  report,
}: SystemMonitorContentProps) {
  const presentation = statePresentation[report.state];
  const quality = report.runtime.marketQuality;

  return (
    <section className="system-monitor" aria-label="API 性能与运行诊断">
      <div className="system-monitor-header">
        <div>
          <span className="section-kicker">运行诊断</span>
          <h2>API 性能与数据链路</h2>
          <p>最近有限样本 · 更新于 {formatTime(report.generatedAt)}</p>
        </div>
        <div className="system-monitor-header-actions">
          <span className={`system-monitor-state tone-${presentation.tone}`}>
            <StateIcon state={report.state} />
            {presentation.label}
          </span>
          <button
            aria-label="刷新系统性能诊断"
            className="icon-button"
            disabled={isFetching}
            onClick={onRefresh}
            title="刷新"
            type="button"
          >
            <RefreshCw className={isFetching ? "spin" : undefined} size={17} />
          </button>
        </div>
      </div>

      <div className="system-monitor-summary">
        <article>
          <span><Server size={15} />API 状态</span>
          <strong className={`tone-${presentation.tone}`}>{presentation.label}</strong>
          <small>{report.totals.inFlight} 个请求处理中</small>
        </article>
        <article>
          <span><Gauge size={15} />P95 延迟</span>
          <strong>{formatMilliseconds(report.totals.p95Ms)}ms</strong>
          <small>平均 {formatMilliseconds(report.totals.averageMs)}ms</small>
        </article>
        <article>
          <span><AlertTriangle size={15} />服务失败率</span>
          <strong className={report.totals.failures > 0 ? "tone-warning" : "tone-positive"}>
            {formatPercent(report.totals.failureRate)}
          </strong>
          <small>{report.totals.failures} 次失败 · {report.totals.slowRequests} 次慢请求</small>
        </article>
        <article>
          <span><Activity size={15} />业务请求</span>
          <strong>{report.totals.requests}</strong>
          <small>{report.routes.length} 条路由有样本</small>
        </article>
      </div>

      <div className="system-runtime-strip">
        <div>
          <span><Database size={14} />行情源</span>
          <strong>{providerLabel(report.runtime.marketDataProvider)}</strong>
          <small>{report.runtime.mode} · {report.runtime.realTradingEnabled ? "真实交易已启用" : "真实交易关闭"}</small>
        </div>
        <div>
          <span>行情质量</span>
          <strong className={`quality-${quality.state}`}>{qualityLabel(quality.state)} · {quality.overall}/100</strong>
          <small>新鲜度 {quality.freshness}/100 · 问题 {quality.issueCount}</small>
        </div>
        <div>
          <span>请求覆盖</span>
          <strong>{quality.validSymbols} / {quality.requestedSymbols}</strong>
          <small>有效报价 / 请求标的</small>
        </div>
        <div>
          <span><Wifi size={14} />实时通道</span>
          <strong>{report.runtime.websocketConnections} 个连接</strong>
          <small>{report.totals.inFlight} 个 API 请求在途</small>
        </div>
      </div>

      {report.recommendations.length > 0 && (
        <div
          className={`system-recommendations state-${report.state}`}
          aria-label="诊断建议"
        >
          {report.state === "healthy" ? (
            <ShieldCheck size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <div>
            <strong>当前建议</strong>
            {report.recommendations.map((recommendation) => (
              <p key={recommendation}>{recommendation}</p>
            ))}
          </div>
        </div>
      )}

      <div className="system-route-section">
        <div className="system-route-heading">
          <div>
            <span className="section-kicker">路由窗口</span>
            <h3>慢接口与失败定位</h3>
          </div>
          <small>
            最多 {report.window.maxRoutes} 条路由 · 每路由 {report.window.samplesPerRoute} 个样本
          </small>
        </div>

        {report.routes.length === 0 ? (
          <div className="system-monitor-empty" role="status">
            <Gauge size={19} />
            <div>
              <strong>等待业务样本</strong>
              <span>浏览市场、策略或账户页面后显示接口耗时</span>
            </div>
          </div>
        ) : (
          <div className="system-route-table-wrap">
            <table className="system-route-table">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>路由</th>
                  <th>请求</th>
                  <th>平均</th>
                  <th>P95</th>
                  <th>失败</th>
                  <th>最近</th>
                </tr>
              </thead>
              <tbody>
                {report.routes.slice(0, 12).map((route) => (
                  <RouteRow key={`${route.method}-${route.route}`} route={route} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="system-monitor-footnote">
        <ShieldCheck size={14} />
        <span>仅保存路由模板、状态和有限耗时样本，不记录查询值、请求正文、响应正文或凭据</span>
      </div>
    </section>
  );
}

export function SystemMonitor() {
  const performanceQuery = useQuery({
    queryKey: ["api-performance"],
    queryFn: ({ signal }) => fetchApiPerformance(signal),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  return (
    <div className="system-monitor-shell">
      {performanceQuery.data ? (
        <SystemMonitorContent
          isFetching={performanceQuery.isFetching}
          onRefresh={() => void performanceQuery.refetch()}
          report={performanceQuery.data}
        />
      ) : (
        <section className="system-monitor system-monitor-loading">
          <div>
            <span className="section-kicker">运行诊断</span>
            <h2>API 性能与数据链路</h2>
          </div>
        </section>
      )}
      <ResearchQueryState
        dataUpdatedAt={performanceQuery.dataUpdatedAt}
        hasData={Boolean(performanceQuery.data)}
        isError={performanceQuery.isError}
        isLoading={performanceQuery.isLoading}
        loadingText="正在汇总 API 性能和行情质量…"
        unavailableText="性能诊断暂不可用，请确认后端服务已更新并保持连接。"
      />
    </div>
  );
}
