import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import type { TradingSignal } from "../../shared/trading";
import type { Alert } from "../../server/notifications/types";

// ── 模拟告警数据（生产环境应从 WebSocket/API 获取） ──────
export interface NotificationItem {
  id: string;
  type: "alert" | "signal";
  timestamp: string;
  // 告警字段
  alertLevel?: Alert["level"];
  alertTitle?: string;
  alertMessage?: string;
  alertType?: Alert["type"];
  // 信号字段
  signalDirection?: TradingSignal["direction"];
  signalSymbol?: string;
  signalStrength?: number;
  signalReason?: string;
  signalStrategy?: string;
}

interface NotificationCenterProps {
  /** 通知列表 */
  notifications: NotificationItem[];
  /** 未读数量 */
  unreadCount?: number;
  /** 点击通知回调 */
  onNotificationClick?: (item: NotificationItem) => void;
  /** 清除所有通知 */
  onClearAll?: () => void;
  /** 关闭回调 */
  onDismiss?: (id: string) => void;
}

function formatTime(iso: string): string {
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

const alertLevelStyles: Record<string, { icon: typeof AlertTriangle; className: string }> = {
  critical: { icon: AlertTriangle, className: "notif-level-critical" },
  warn: { icon: AlertTriangle, className: "notif-level-warn" },
  info: { icon: CheckCircle, className: "notif-level-info" },
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

export function NotificationCenter({
  notifications,
  unreadCount = 0,
  onNotificationClick,
  onClearAll,
  onDismiss,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="notification-center">
      {/* 铃铛按钮 */}
      <button
        aria-label={`通知中心（${unreadCount} 条未读）`}
        className="notif-bell"
        onClick={toggle}
        type="button"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <>
          {/* 背景遮罩（移动端/点击外部关闭） */}
          <div className="notif-backdrop" onClick={close} role="presentation" />

          <div className="notif-dropdown">
            {/* 头部 */}
            <div className="notif-header">
              <h3>通知中心</h3>
              <div className="notif-header-actions">
                {onClearAll && notifications.length > 0 && (
                  <button
                    className="notif-clear-btn"
                    onClick={() => {
                      onClearAll();
                    }}
                    type="button"
                  >
                    清空全部
                  </button>
                )}
                <button
                  aria-label="关闭通知中心"
                  className="notif-close-btn"
                  onClick={close}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div className="notif-list">
              {notifications.length === 0 ? (
                <div className="notif-empty">
                  <Bell size={32} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
                  <p>暂无通知</p>
                  <span>当有告警或交易信号时会在这里显示</span>
                </div>
              ) : (
                notifications.map((item) => (
                  <div
                    className="notif-item"
                    key={item.id}
                    onClick={() => onNotificationClick?.(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onNotificationClick?.(item);
                      }
                    }}
                  >
                    {/* 左侧图标 */}
                    {item.type === "signal" ? (
                      <div
                        className={`notif-icon ${item.signalDirection === "buy" ? "signal-buy" : item.signalDirection === "sell" ? "signal-sell" : "signal-hold"}`}
                      >
                        {item.signalDirection === "buy" ? (
                          <TrendingUp size={15} />
                        ) : item.signalDirection === "sell" ? (
                          <TrendingDown size={15} />
                        ) : (
                          <Zap size={15} />
                        )}
                      </div>
                    ) : (
                      (() => {
                        const style =
                          alertLevelStyles[item.alertLevel ?? "info"] ??
                          alertLevelStyles.info;
                        return (
                          <div className={`notif-icon ${style.className}`}>
                            <style.icon size={15} />
                          </div>
                        );
                      })()
                    )}

                    {/* 内容 */}
                    <div className="notif-content">
                      <div className="notif-title-row">
                        <span className="notif-type-badge">
                          {item.type === "signal"
                            ? "交易信号"
                            : alertTypeLabels[item.alertType ?? "custom"] ?? "系统告警"}
                        </span>
                        <span className="notif-time">{formatTime(item.timestamp)}</span>
                      </div>
                      <p className="notif-title">
                        {item.type === "signal"
                          ? `${item.signalStrategy ?? "策略"} · ${item.signalSymbol ?? "—"} ${item.signalDirection === "buy" ? "买入" : item.signalDirection === "sell" ? "卖出" : "持有"}`
                          : item.alertTitle ?? "系统告警"}
                      </p>
                      <p className="notif-desc">
                        {item.type === "signal"
                          ? item.signalReason ?? "—"
                          : item.alertMessage ?? "—"}
                      </p>
                      {item.type === "signal" && item.signalStrength != null && (
                        <div className="notif-signal-strength">
                          <span>信号强度</span>
                          <div className="notif-strength-bar">
                            <div
                              className="notif-strength-fill"
                              style={{ width: `${(item.signalStrength ?? 0) * 100}%` }}
                            />
                          </div>
                          <span>{((item.signalStrength ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </div>

                    {/* 跳转图标 */}
                    <ArrowUpRight size={14} className="notif-goto" />

                    {/* 关闭按钮 */}
                    {onDismiss && (
                      <button
                        aria-label="关闭此通知"
                        className="notif-dismiss"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismiss(item.id);
                        }}
                        type="button"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 底部 */}
            {notifications.length > 0 && (
              <div className="notif-footer">
                <span>
                  共 {notifications.length} 条通知
                  {unreadCount > 0 && ` · ${unreadCount} 条未读`}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
