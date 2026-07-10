import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Minus,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { TradingSignal } from "../../shared/trading";
import type { Alert, AlertLevel } from "../../server/notifications/types";

// ── 类型 ──────────────────────────────────────────────────

export interface NotificationsPanelProps {
  /** 告警列表 */
  alerts?: Alert[];
  /** 交易信号列表 */
  signals?: TradingSignal[];
  /** 面板加载状态 */
  loading?: boolean;
}

// ── 级别配置 ──────────────────────────────────────────────

const levelConfig: Record<
  AlertLevel,
  { icon: typeof AlertTriangle; colorClass: string; label: string }
> = {
  critical: {
    icon: ShieldAlert,
    colorClass: "notif-panel-level-critical",
    label: "严重",
  },
  warn: {
    icon: AlertTriangle,
    colorClass: "notif-panel-level-warn",
    label: "警告",
  },
  info: {
    icon: Bell,
    colorClass: "notif-panel-level-info",
    label: "信息",
  },
};

const alertTypeLabels: Record<string, string> = {
  risk_circuit_breaker: "风控熔断",
  risk_large_loss: "大额亏损",
  risk_drawdown_warning: "回撤预警",
  trade_abnormal: "异常交易",
  trade_rejected: "交易被拒",
  system_error: "系统错误",
  system_startup: "系统启动",
  system_shutdown: "系统关闭",
  account_margin_call: "保证金不足",
  market_data_stale: "行情延迟",
  custom: "自定义",
};

// ── 工具函数 ──────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}小时前`;
    return d.toLocaleDateString("zh-CN");
  } catch {
    return iso;
  }
}

function confidencePct(c: number): string {
  return `${(c * 100).toFixed(0)}%`;
}

// ── 子组件：信号置信度进度条 ──────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="notif-panel-confidence">
      <span className="notif-panel-confidence-label">置信度</span>
      <div className="notif-panel-confidence-track">
        <div
          className="notif-panel-confidence-fill"
          style={{ width: `${(value * 100).toFixed(0)}%` }}
        />
      </div>
      <span className="notif-panel-confidence-value">{confidencePct(value)}</span>
    </div>
  );
}

// ── 子组件：告警条目 ──────────────────────────────────────

function AlertItem({ alert }: { alert: Alert }) {
  const config = levelConfig[alert.level] ?? levelConfig.info;
  const Icon = config.icon;
  return (
    <div className={`notif-panel-item ${config.colorClass}`}>
      <div className="notif-panel-item-icon">
        <Icon size={16} />
      </div>
      <div className="notif-panel-item-body">
        <div className="notif-panel-item-header">
          <span className={`notif-panel-level-tag ${config.colorClass}`}>
            {config.label}
          </span>
          <span className="notif-panel-badge">
            {alertTypeLabels[alert.type] ?? "系统告警"}
          </span>
          <span className="notif-panel-time">
            {formatRelativeTime(alert.timestamp)}
          </span>
        </div>
        <p className="notif-panel-item-title">{alert.title}</p>
        <p className="notif-panel-item-desc">{alert.message}</p>
      </div>
    </div>
  );
}

// ── 子组件：交易信号条目 ──────────────────────────────────

function SignalItem({ signal }: { signal: TradingSignal }) {
  const isBuy = signal.direction === "buy";
  const isSell = signal.direction === "sell";

  return (
    <div
      className={`notif-panel-item ${isBuy ? "notif-panel-signal-buy" : isSell ? "notif-panel-signal-sell" : "notif-panel-signal-hold"}`}
    >
      <div className="notif-panel-item-icon">
        {isBuy ? (
          <TrendingUp size={16} />
        ) : isSell ? (
          <TrendingDown size={16} />
        ) : (
          <Minus size={16} />
        )}
      </div>
      <div className="notif-panel-item-body">
        <div className="notif-panel-item-header">
          <span
            className={`notif-panel-direction-tag ${isBuy ? "notif-panel-direction-buy" : isSell ? "notif-panel-direction-sell" : "notif-panel-direction-hold"}`}
          >
            {signal.direction === "buy" ? (
              <ArrowUp size={10} />
            ) : signal.direction === "sell" ? (
              <ArrowDown size={10} />
            ) : null}
            {isBuy ? "买入建议" : isSell ? "卖出建议" : "持有"}
          </span>
          <span className="notif-panel-badge">{signal.strategyName}</span>
          <span className="notif-panel-time">
            {formatRelativeTime(signal.timestamp)}
          </span>
        </div>
        <p className="notif-panel-item-title">
          {signal.symbol} · ¥{signal.price.toFixed(2)}
        </p>
        <p className="notif-panel-item-desc">{signal.reason}</p>
        <ConfidenceBar value={signal.confidence} />
      </div>
    </div>
  );
}

// ── 空状态 ────────────────────────────────────────────────

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="notif-panel-empty">
      <div className="notif-panel-empty-icon">{icon}</div>
      <p className="notif-panel-empty-title">{title}</p>
      <p className="notif-panel-empty-desc">{description}</p>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────

export function NotificationsPanel({
  alerts = [],
  signals = [],
  loading = false,
}: NotificationsPanelProps) {
  // 按时间倒序排列
  const sortedAlerts = [...alerts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const sortedSignals = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <section className="notif-panel">
      {/* 面板头部 */}
      <div className="notif-panel-header">
        <div>
          <span className="section-kicker">通知中心</span>
          <h2 className="notif-panel-title">告警与信号</h2>
        </div>
        <Bell size={20} className="notif-panel-header-icon" />
      </div>

      {loading ? (
        <div className="notif-panel-loading">
          <BarChart3 size={24} className="notif-panel-spinner" />
          <span>加载中...</span>
        </div>
      ) : (
        <div className="notif-panel-body">
          {/* ── 告警区域 ── */}
          <div className="notif-panel-section">
            <div className="notif-panel-section-header">
              <ShieldAlert size={16} />
              <h3>最近告警</h3>
              {sortedAlerts.length > 0 && (
                <span className="notif-panel-count">{sortedAlerts.length}</span>
              )}
            </div>
            <div className="notif-panel-list">
              {sortedAlerts.length === 0 ? (
                <EmptyState
                  icon={<ShieldAlert size={28} />}
                  title="暂无告警"
                  description="风控系统运行正常，暂无异常告警"
                />
              ) : (
                sortedAlerts.slice(0, 10).map((alert) => (
                  <AlertItem key={alert.id} alert={alert} />
                ))
              )}
            </div>
          </div>

          {/* ── 交易信号区域 ── */}
          <div className="notif-panel-section">
            <div className="notif-panel-section-header">
              <Zap size={16} />
              <h3>交易信号</h3>
              {sortedSignals.length > 0 && (
                <span className="notif-panel-count">{sortedSignals.length}</span>
              )}
            </div>
            <div className="notif-panel-list">
              {sortedSignals.length === 0 ? (
                <EmptyState
                  icon={<Zap size={28} />}
                  title="暂无信号"
                  description="策略运行中，等待交易信号生成"
                />
              ) : (
                sortedSignals.slice(0, 10).map((signal) => (
                  <SignalItem key={signal.id} signal={signal} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 底部统计 */}
      {!loading && (sortedAlerts.length > 0 || sortedSignals.length > 0) && (
        <div className="notif-panel-footer">
          <span>
            共 {sortedAlerts.length} 条告警 · {sortedSignals.length} 条信号
          </span>
        </div>
      )}
    </section>
  );
}
