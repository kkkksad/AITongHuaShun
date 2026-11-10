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

function elapsed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "未知";
  return value >= 1000 ? `${(value / 1000).toFixed(3)} 秒` : `${value} 毫秒`;
}
const sessionLabels: Record<string, string> = {
  open: "盘中", "pre-market": "盘前", "lunch-break": "午休", "after-hours": "盘后",
  weekend: "周末", holiday: "休市", "calendar-unavailable": "日历未知",
};

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
      {data.latestRuns.length > 0 && <>
        <div className="compare-ranking-table-wrapper paper-history-table-wrapper">
          <table><caption>最近运行耗时（最多20条保留记录）</caption>
            <thead><tr><th>北京时间</th><th>会话</th><th>总耗时</th><th>研究</th><th>通知</th><th>准备/提交</th></tr></thead>
            <tbody>{data.latestRuns.slice(0, 20).map((run, index) => <tr key={`${run.occurredAt}-${index}`}>
              <td>{timestamp(run.occurredAt)}</td><td>{run.session ? sessionLabels[run.session] : "未知"}</td>
              <td>{elapsed(run.timing?.totalMs)}</td><td>{elapsed(run.timing?.researchMs)}</td>
              <td>{elapsed(run.timing?.notificationMs)}</td><td>{elapsed(run.timing?.executionMs)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="empty-copy">耗时按单调时钟记录，区别于两条记录间隔；总耗时不含最终运行审计写盘。研究可能命中缓存，准备/提交包含预检且不代表成交，通知耗时不代表发送成功。旧记录、未运行阶段或无效样本为未知；合并后的样本不代表完整分布。</p>
        <div className="compare-ranking-table-wrapper paper-history-table-wrapper">
          <table><caption>最近新增标的漏斗（最多20条保留记录）</caption>
            <thead><tr><th>北京时间</th><th>扫描去重</th><th>前12考虑</th><th>已有持仓</th><th>新标的</th>
              <th>策略资格</th><th>独立金额</th><th>最终拟买</th><th>全局新增许可</th></tr></thead>
            <tbody>{data.latestRuns.slice(0, 20).map((run, index) => <tr key={`${run.occurredAt}-${index}`}>
              <td>{timestamp(run.occurredAt)}</td><td>{run.newPositionFunnel?.scannerCandidateCount ?? "未知"}</td>
              <td>{run.newPositionFunnel?.consideredCandidateCount ?? "未知"}</td><td>{run.newPositionFunnel?.existingPositionCount ?? "未知"}</td>
              <td>{run.newPositionFunnel?.newSymbolCount ?? "未知"}</td><td>{run.newPositionFunnel?.eligibleNewSymbolCount ?? "未知"}</td>
              <td>{run.newPositionFunnel?.individuallySizedNewSymbolCount ?? "未知"}</td><td>{run.newPositionFunnel?.plannedBuyCount ?? "未知"}</td>
              <td>{run.newPositionFunnel ? run.newPositionFunnel.allowNewPositions ? "允许评估新增" : "不允许新增" : "未知"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="empty-copy">扫描去重后的本轮排序前12只，分开已有持仓与新标的；策略资格和独立金额只统计新标的。独立金额按初始预算逐只计算，不代表同批资金充足；拟买不是提交或成交，全局许可仍需逐笔风控。旧记录或无效漏斗为未知，未补造为零。</p>
      </>}
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
