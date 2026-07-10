import {
  Calendar,
  DollarSign,
  PlayCircle,
  PauseCircle,
  Target,
  TrendingUp,
  TrendingDown,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { dcaPlans } from "../data/mockData";
import type { DcaPlan } from "../types";

const intervalLabels: Record<DcaPlan["interval"], string> = {
  daily: "每日",
  weekly: "每周",
  biweekly: "双周",
  monthly: "每月",
};

const statusLabels: Record<DcaPlan["status"], string> = {
  active: "运行中",
  paused: "已暂停",
  completed: "已完成",
};

const statusColors: Record<DcaPlan["status"], string> = {
  active: "status-dot",
  paused: "status-dot amber",
  completed: "status-dot",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function PositionPlan() {
  const [plans] = useState<DcaPlan[]>(dcaPlans);

  const totalInvested = plans.reduce((sum, p) => sum + p.currentInvested, 0);
  const totalValue = plans.reduce((sum, p) => sum + p.currentValue, 0);
  const totalPnl = totalValue - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="page-stack">
      {/* Summary Card */}
      <section className="panel position-plan-hero">
        <div className="panel-header">
          <div>
            <span className="section-kicker">建仓计划</span>
            <h2>定投管理</h2>
          </div>
          <button className="primary-button" type="button">
            <Plus size={16} />
            <span>新建计划</span>
          </button>
        </div>
        <div className="dca-summary-grid">
          <div className="dca-summary-item">
            <DollarSign size={18} />
            <span>总投入</span>
            <strong>{formatMoney(totalInvested)}</strong>
          </div>
          <div className="dca-summary-item">
            <TrendingUp size={18} />
            <span>当前市值</span>
            <strong>{formatMoney(totalValue)}</strong>
          </div>
          <div className="dca-summary-item">
            <Target size={18} />
            <span>浮动盈亏</span>
            <strong className={totalPnl >= 0 ? "positive" : "negative"}>
              {formatPercent(totalPnlPercent)}
            </strong>
          </div>
          <div className="dca-summary-item">
            <Calendar size={18} />
            <span>活跃计划</span>
            <strong>{plans.filter((p) => p.status === "active").length} 个</strong>
          </div>
        </div>
      </section>

      {/* Plan Cards */}
      <div className="dca-plans-grid">
        {plans.map((plan) => {
          const progressPct =
            plan.totalAmount > 0
              ? Math.min(100, (plan.currentInvested / plan.totalAmount) * 100)
              : 0;

          return (
            <article key={plan.id} className="panel dca-plan-card">
              <div className="dca-plan-header">
                <div>
                  <span className="section-kicker">
                    {plan.symbol} · {intervalLabels[plan.interval]}
                  </span>
                  <h3>{plan.name}</h3>
                  <p>{plan.symbolName}</p>
                </div>
                <span className={statusColors[plan.status]} />
              </div>

              {/* Progress Bar */}
              <div className="dca-progress-section">
                <div className="dca-progress-header">
                  <span>定投进度</span>
                  <span>
                    {formatMoney(plan.currentInvested)} / {formatMoney(plan.totalAmount)}
                  </span>
                </div>
                <div className="dca-progress-bar">
                  <div
                    className="dca-progress-fill"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Key Metrics */}
              <div className="dca-metrics-row">
                <div>
                  <span>持仓数量</span>
                  <strong>{plan.currentShares.toLocaleString()} 股</strong>
                </div>
                <div>
                  <span>平均成本</span>
                  <strong>¥{plan.averageCost.toFixed(3)}</strong>
                </div>
                <div>
                  <span>盈亏</span>
                  <strong className={plan.profitPercent >= 0 ? "positive" : "negative"}>
                    {formatPercent(plan.profitPercent)}
                  </strong>
                </div>
              </div>

              {/* Stop/Take Profit Rules */}
              <div className="dca-rules-row">
                {plan.takeProfitPercent > 0 && (
                  <span className="dca-rule take-profit">
                    <TrendingUp size={12} />
                    止盈 {plan.takeProfitPercent}%
                  </span>
                )}
                {plan.stopLossPercent > 0 && (
                  <span className="dca-rule stop-loss">
                    <TrendingDown size={12} />
                    止损 {plan.stopLossPercent}%
                  </span>
                )}
                {plan.takeProfitPercent === 0 && plan.stopLossPercent === 0 && (
                  <span className="dca-rule no-rule">无限期持有</span>
                )}
              </div>

              {/* Actions */}
              <div className="dca-plan-actions">
                <span className="dca-status-badge">{statusLabels[plan.status]}</span>
                <div>
                  {plan.status === "active" ? (
                    <button className="text-button" type="button">
                      <PauseCircle size={14} />
                      暂停
                    </button>
                  ) : plan.status === "paused" ? (
                    <button className="text-button" type="button">
                      <PlayCircle size={14} />
                      恢复
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
