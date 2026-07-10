import { useMemo } from "react";
import {
  Bell,
  BriefcaseBusiness,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { AccountSnapshot, PositionSnapshot } from "../../shared/trading";

interface DashboardProps {
  account?: AccountSnapshot;
  positions: PositionSnapshot[];
  /** 最近告警数量（用于风险状态徽标） */
  alertCount?: number;
}

function cny(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

/**
 * 风险状态枚举
 */
type RiskLevel = "normal" | "warning" | "critical" | "unknown";

function getRiskLevel(account?: AccountSnapshot): RiskLevel {
  if (!account) return "unknown";
  if (account.paused) return "critical";
  if (account.riskUtilization > 0.8) return "critical";
  if (account.riskUtilization > 0.5) return "warning";
  if (account.dailyPnlPercent < -0.03) return "warning";
  return "normal";
}

const riskLabels: Record<RiskLevel, { label: string; className: string }> = {
  normal: { label: "正常", className: "risk-normal" },
  warning: { label: "关注", className: "risk-warning" },
  critical: { label: "危险", className: "risk-critical" },
  unknown: { label: "—", className: "risk-unknown" },
};

export function Dashboard({ account, positions, alertCount = 0 }: DashboardProps) {
  const riskLevel = useMemo(() => getRiskLevel(account), [account]);

  // 持仓总市值
  const totalMarketValue = useMemo(
    () => positions.reduce((sum, p) => sum + p.marketValue, 0),
    [positions],
  );

  // 持仓盈亏
  const totalUnrealizedPnl = useMemo(
    () => positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
    [positions],
  );

  if (!account) {
    return (
      <section className="dashboard-panel">
        <div className="dashboard-loading">
          <div className="page-loader-spinner" />
          <p>正在加载账户数据…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-panel">
      {/* 主卡片行 */}
      <div className="dashboard-cards">
        {/* 总权益 */}
        <article className="dashboard-card">
          <div className="dashboard-card-icon equity">
            <Wallet size={20} />
          </div>
          <div className="dashboard-card-body">
            <span className="dashboard-card-label">总权益</span>
            <strong className="dashboard-card-value">{cny(account.equity)}</strong>
            <small className="dashboard-card-detail">
              可用 {cny(account.cash)} · 市值 {cny(account.marketValue)}
            </small>
          </div>
        </article>

        {/* 日收益 */}
        <article className="dashboard-card">
          <div
            className={`dashboard-card-icon ${account.dailyPnl >= 0 ? "profit" : "loss"}`}
          >
            {account.dailyPnl >= 0 ? (
              <TrendingUp size={20} />
            ) : (
              <TrendingDown size={20} />
            )}
          </div>
          <div className="dashboard-card-body">
            <span className="dashboard-card-label">今日收益</span>
            <strong
              className={`dashboard-card-value ${account.dailyPnl >= 0 ? "positive" : "negative"}`}
            >
              {account.dailyPnl >= 0 ? "+" : ""}
              {cny(account.dailyPnl)}
              <span className="dashboard-pnl-pct">
                （{pct(account.dailyPnlPercent)}）
              </span>
            </strong>
            <small className="dashboard-card-detail">
              未实现盈亏 {totalUnrealizedPnl >= 0 ? "+" : ""}
              {cny(totalUnrealizedPnl)}
            </small>
          </div>
        </article>

        {/* 持仓数 */}
        <article className="dashboard-card">
          <div className="dashboard-card-icon positions">
            <BriefcaseBusiness size={20} />
          </div>
          <div className="dashboard-card-body">
            <span className="dashboard-card-label">持仓数量</span>
            <strong className="dashboard-card-value">
              {positions.length}
              <span className="dashboard-pos-unit"> 只标的</span>
            </strong>
            <small className="dashboard-card-detail">
              持仓总市值 {cny(totalMarketValue)}
            </small>
          </div>
        </article>

        {/* 风险状态 */}
        <article className="dashboard-card">
          <div
            className={`dashboard-card-icon ${riskLevel === "normal" ? "risk-ok" : riskLevel === "warning" ? "risk-warn" : riskLevel === "critical" ? "risk-danger" : ""}`}
          >
            <Bell size={20} />
          </div>
          <div className="dashboard-card-body">
            <span className="dashboard-card-label">
              风险状态
              {alertCount > 0 && (
                <span className="dashboard-alert-badge">{alertCount}</span>
              )}
            </span>
            <strong
              className={`dashboard-card-value ${riskLabels[riskLevel].className}`}
            >
              {riskLabels[riskLevel].label}
            </strong>
            <small className="dashboard-card-detail">
              风险利用率 {pct(account.riskUtilization)}
              {account.paused ? " · 已暂停" : ""}
            </small>
          </div>
        </article>
      </div>

      {/* 次级指标行 */}
      <div className="dashboard-sub-row">
        <div className="dashboard-sub-item">
          <span>已实现盈亏</span>
          <strong className={account.realizedPnl >= 0 ? "positive" : "negative"}>
            {account.realizedPnl >= 0 ? "+" : ""}
            {cny(account.realizedPnl)}
          </strong>
        </div>
        <div className="dashboard-sub-item">
          <span>收益率</span>
          <strong className={account.dailyPnlPercent >= 0 ? "positive" : "negative"}>
            {pct(account.dailyPnlPercent)}
          </strong>
        </div>
        <div className="dashboard-sub-item">
          <span>账户ID</span>
          <strong>{account.accountId}</strong>
        </div>
        <div className="dashboard-sub-item">
          <span>模式</span>
          <strong className={account.mode === "live" ? "negative" : ""}>
            {account.mode === "mock" ? "模拟" : account.mode === "paper" ? "纸交易" : "实盘"}
          </strong>
        </div>
      </div>
    </section>
  );
}
