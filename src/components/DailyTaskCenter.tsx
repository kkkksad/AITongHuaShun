import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDashed,
  Clock3,
  ListChecks,
  RefreshCw,
} from "lucide-react";
import { buildDailyTaskCenterModel, type DailyTaskState } from "../lib/dailyTaskCenter";
import {
  fetchDailyMarketReview,
  fetchPaperAutoExecutionStatus,
  fetchPaperTradingPlan,
} from "../lib/tradingApi";

interface DailyTaskCenterProps {
  onOpenLearning: () => void;
  onOpenMarket: () => void;
  onOpenOrders: () => void;
}

const taskIcons = {
  done: Check,
  current: Clock3,
  pending: CircleDashed,
  attention: AlertTriangle,
} satisfies Record<DailyTaskState, typeof Check>;

function currency(value: number | null): string {
  if (value === null) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null): string {
  if (value === null) return "--";
  return `${(value * 100).toFixed(0)}%`;
}

function count(value: number | null): string {
  return value === null ? "--" : String(value);
}

export function DailyTaskCenter({
  onOpenLearning,
  onOpenMarket,
  onOpenOrders,
}: DailyTaskCenterProps) {
  const planQuery = useQuery({
    queryKey: ["paper-trading-plan"],
    queryFn: fetchPaperTradingPlan,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const reviewQuery = useQuery({
    queryKey: ["daily-market-review"],
    queryFn: fetchDailyMarketReview,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const executionQuery = useQuery({
    queryKey: ["paper-auto-execution-status"],
    queryFn: fetchPaperAutoExecutionStatus,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const model = buildDailyTaskCenterModel({
    plan: planQuery.data,
    review: reviewQuery.data,
    execution: executionQuery.data,
  });
  const queries = [planQuery, reviewQuery, executionQuery];
  const isFetching = queries.some((query) => query.isFetching);
  const hasError = queries.some((query) => query.isError);
  const hasAnyData = model.dataSources.available > 0;

  function refreshAll() {
    void Promise.all(queries.map((query) => query.refetch()));
  }

  return (
    <section className="panel daily-task-center">
      <div className="panel-header daily-task-center-header">
        <div>
          <span className="section-kicker">每日任务中心</span>
          <h2>{model.phase.label}</h2>
          <p>{model.phase.detail}</p>
        </div>
        <div className="daily-task-center-header-actions">
          <span className="task-data-badge">
            {model.dataSources.available}/{model.dataSources.total} 数据就绪
          </span>
          <button
            aria-label="刷新每日任务中心"
            className="icon-button"
            disabled={isFetching}
            onClick={refreshAll}
            title="刷新每日任务中心"
            type="button"
          >
            <RefreshCw className={isFetching ? "spin" : undefined} size={17} />
          </button>
        </div>
      </div>

      {!hasAnyData && isFetching && (
        <div className="research-empty">正在汇总 Paper 计划、盘面复盘和执行器状态…</div>
      )}
      {hasError && (
        <div className="research-alert regime-warning" role="status">
          <AlertTriangle size={16} />
          <span>
            部分任务数据暂时不可用，当前继续展示 {model.dataSources.available} 份可用结果。
          </span>
        </div>
      )}

      <div className="daily-task-center-layout">
        <div aria-label="今日任务阶段" className="daily-task-list" role="list">
          {model.tasks.map((task) => {
            const Icon = taskIcons[task.state];
            return (
              <article className={`daily-task-row task-${task.state}`} key={task.id} role="listitem">
                <span className="daily-task-icon"><Icon size={15} /></span>
                <div>
                  <strong>{task.label}</strong>
                  <p>{task.detail}</p>
                </div>
                <span className="daily-task-state">
                  {task.state === "done" && "完成"}
                  {task.state === "current" && "当前"}
                  {task.state === "pending" && "待办"}
                  {task.state === "attention" && "复核"}
                </span>
              </article>
            );
          })}
        </div>

        <div className="daily-task-focus">
          <div className="daily-task-status-grid">
            <div>
              <span>Paper 执行器</span>
              <strong className={`tone-${model.execution.tone}`}>{model.execution.label}</strong>
              <small>{model.execution.detail}</small>
            </div>
            <div>
              <span>市场状态</span>
              <strong className={`tone-${model.market.tone}`}>{model.market.label}</strong>
              <small>
                新增仓位：{model.market.allowNewPositions === null
                  ? "待确认"
                  : model.market.allowNewPositions ? "允许 Paper 观察" : "暂停"}
              </small>
            </div>
            <div>
              <span>计划质量</span>
              <strong className={`tone-${model.plan.tone}`}>{model.plan.label}</strong>
              <small>{model.plan.detail}</small>
            </div>
            <div>
              <span>盘后结论</span>
              <strong className={`tone-${model.review.tone}`}>{model.review.label}</strong>
              <small>{model.review.detail}</small>
            </div>
          </div>

          {model.plan.blockedReasons.length > 0 && (
            <div className="daily-task-blockers">
              <AlertTriangle size={15} />
              <span>主要拦截：{model.plan.blockedReasons.join(" · ")}</span>
            </div>
          )}

          <div className="daily-task-next">
            <div>
              <span>下一步</span>
              <strong>{model.nextAction}</strong>
            </div>
            <div className="daily-task-actions" aria-label="任务快捷入口">
              <button className="secondary-button" onClick={onOpenMarket} type="button">
                市场研判 <ArrowRight size={14} />
              </button>
              <button className="secondary-button" onClick={onOpenOrders} type="button">
                订单复核 <ArrowRight size={14} />
              </button>
              <button className="secondary-button" onClick={onOpenLearning} type="button">
                研究管线 <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="daily-task-metrics">
        <div><span>Paper 权益</span><strong>{currency(model.account.equity)}</strong></div>
        <div><span>现金 / 仓位</span><strong>{currency(model.account.cash)} / {percent(model.account.investedRatio)}</strong></div>
        <div><span>提交 / 成交 / 拒绝</span><strong>{count(model.orders.submitted)} / {count(model.orders.filled)} / {count(model.orders.rejected)}</strong></div>
        <div><span>费用 / 阶段余量</span><strong>{currency(model.orders.commission)} / {count(model.orders.remaining)} 笔</strong></div>
      </div>

      <div className="daily-task-footnote">
        <ListChecks size={14} />
        <span>
          仅汇总真实只读行情与本地 Paper 记录，真实交易关闭
          {model.updatedAt ? ` · 最近更新 ${new Date(model.updatedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
        </span>
      </div>
    </section>
  );
}
