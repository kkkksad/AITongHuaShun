import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { PaperHistoryArchiveReport } from "../../shared/paperHistory";
import { paperHistoryArchiveQueryOptions } from "../lib/researchQueries";
import { ResearchQueryState } from "./ResearchQueryState";

const unavailableLabels = {
  disabled: "长期归档未接入：当前环境没有可用的持久账户归档。",
  unavailable: "归档暂不可用：无法核验当前摘要，请稍后刷新。",
  "waiting-for-account": "等待当前账户归档：旧账户记录已隐藏，下一次采集后再查看。",
} as const;
const blockerLabels: Record<string, string> = {
  "T+1": "T+1限制", "strategy-profile": "策略档位", "adaptive-new-position": "市场新增资格",
  "strategy-route": "策略路由", "lot-size": "整手金额", "cash-check": "现金检查",
  "cash-reservation": "资金占用", "plan-sizing": "计划金额", "defensive-score": "候选评分",
  "same-day-reentry": "当日重复入场", "round-trip-fee-ratio": "往返费用", "entry-persistence": "隔夜持续性",
};
const issueLabels: Record<string, string> = {
  "provider-contract": "来源字段", "provider-timeout": "来源超时", "history-warming": "历史预热",
  "history-queue-full": "历史队列已满", "sector-history-insufficient": "板块历史不足",
  "stock-history-insufficient": "个股历史不足", "provider-warning": "来源警告",
};
function timestamp(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function PaperHistoryArchiveContent({ report, isFetching, onRefresh }: {
  report: PaperHistoryArchiveReport; isFetching: boolean; onRefresh: () => void;
}) {
  const data = report.state === "ready" || report.state === "stale" ? report.data : null;
  return <section className="panel learning-memory-panel paper-history-archive" aria-label="长期 Paper 运行证据">
    <div className="panel-header">
      <div><span className="section-kicker">长期归档</span><h2>Paper 运行证据</h2></div>
      <button type="button" className="secondary-button" disabled={isFetching} onClick={onRefresh} aria-label="刷新长期 Paper 归档">
        <RefreshCw size={14} />{isFetching ? "读取中…" : "刷新"}
      </button>
    </div>
    {report.state === "stale" && <p className="empty-copy" role="status">归档已过期：超过三分钟未更新，以下为保留记录，不能代表当前运行状态。</p>}
    {!data && <p className="empty-copy">{report.state in unavailableLabels ? unavailableLabels[report.state as keyof typeof unavailableLabels] : "归档暂不可用"}</p>}
    {data && <>
      <p>{data.window.fromDate} — {data.window.toDate} · 北京时间 · 最近采集 {timestamp(data.lastObservedAt)}</p>
      <div className="learning-memory-grid">
        <article><span>保留运行记录</span><strong>{data.runCount.toLocaleString("zh-CN")}</strong><small>从 {timestamp(data.firstObservedAt)} 开始观察</small></article>
        <article><span>可确认盘中运行</span><strong>{data.openSessionRuns.toLocaleString("zh-CN")}</strong><small>会话未知 {data.unknownSessionRuns} 条</small></article>
        <article><span>已记录提交尝试</span><strong>{data.submittedAttempts.toLocaleString("zh-CN")}</strong><small>提交字段覆盖 {data.submissionEvidenceRuns} / {data.runCount} 条运行；不代表成交</small></article>
      </div>
      {data.openSessionRuns === 0 && <p className="empty-copy">没有可确认的盘中运行证据，不能据此推断策略没有信号或交易代码故障。{data.unknownSessionRuns > 0 && "部分旧记录的会话未知，未补造为盘中或休市。"}</p>}
      <div className="compare-ranking-table-wrapper paper-history-table-wrapper">
        <table><caption>七日保留运行记录</caption><thead><tr><th>北京时间日期</th><th>运行记录</th><th>盘中</th><th>会话未知</th><th>已记录提交尝试</th></tr></thead>
          <tbody>{data.days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.runs}</td><td>{day.openRuns}</td><td>{day.unknownSessionRuns}</td><td>{day.submissionEvidenceRuns === 0 ? "—" : day.submittedAttempts}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="daily-review-findings">
        <div><strong>记录的门槛阻塞</strong><ul>{data.blockers.map((item) => <li key={item.code}>{blockerLabels[item.code]}：{item.count} 次</li>)}{data.blockers.length === 0 && <li>未保留可确认的门槛计数，不能解释为没有阻塞。</li>}</ul></div>
        <div><strong>研究输入问题</strong><ul>{data.issues.map((item) => <li key={item.code}>{issueLabels[item.code]}：{item.count} 条运行</li>)}{data.issues.length === 0 && <li>未保留输入问题代码，不能解释为全部数据可用。</li>}</ul></div>
      </div>
      <p className="empty-copy">采集周期约一分钟；只统计已持久化的运行记录，无变化轮次可能合并。规则次数可能重复涉及同一候选，并非拒单数；归档不是完整事件日志，不计算胜率或当前市值收益。</p>
    </>}
  </section>;
}

export function PaperHistoryArchivePanel() {
  const query = useQuery(paperHistoryArchiveQueryOptions());
  const report: PaperHistoryArchiveReport = query.data ?? { state: "unavailable", data: null };
  return <>
    <ResearchQueryState hasData={Boolean(query.data)} isError={query.isError} isLoading={query.isLoading}
      dataUpdatedAt={query.dataUpdatedAt} loadingText="正在读取长期 Paper 归档…" unavailableText="长期归档查询暂不可用。" />
    {(query.data || query.isError) && <PaperHistoryArchiveContent report={report} isFetching={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
  </>;
}
