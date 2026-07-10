/** 告警级别 */
export type AlertLevel = "info" | "warn" | "critical";

/** 告警类型 */
export type AlertType =
  | "risk_circuit_breaker" // 风控熔断
  | "risk_large_loss" // 大额亏损
  | "risk_drawdown_warning" // 回撤预警
  | "trade_abnormal" // 异常交易
  | "trade_rejected" // 交易被拒
  | "system_error" // 系统错误
  | "system_startup" // 系统启动
  | "system_shutdown" // 系统关闭
  | "account_margin_call" // 保证金不足
  | "market_data_stale" // 行情数据延迟/过期
  | "custom"; // 自定义

/** 告警消息 */
export interface Alert {
  /** 唯一ID */
  id: string;
  /** 告警级别 */
  level: AlertLevel;
  /** 告警类型 */
  type: AlertType;
  /** 告警标题 */
  title: string;
  /** 告警详情 */
  message: string;
  /** 触发时间 */
  timestamp: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/** 通知渠道 */
export type NotificationChannel = "console" | "dingtalk" | "email" | "custom";

/** 通知渠道配置 */
export interface ChannelConfig {
  /** 渠道名称 */
  channel: NotificationChannel;
  /** 是否启用 */
  enabled: boolean;
  /** 渠道特定配置 */
  options?: Record<string, unknown>;
}

/** 通知服务配置 */
export interface NotificationConfig {
  /** 启用的通知渠道 */
  channels: ChannelConfig[];
  /** 最小告警级别（低于此级别的告警不发送） */
  minLevel: AlertLevel;
}

/** 通知发送者接口 — 每个渠道实现此接口 */
export interface NotificationSender {
  readonly channel: NotificationChannel;
  send(alert: Alert): Promise<void>;
}
