import type {
  Alert,
  AlertLevel,
  AlertType,
  ChannelConfig,
  NotificationChannel,
  NotificationConfig,
  NotificationSender,
} from "./types";

// ── 默认配置 ──────────────────────────────────────────────

const LEVEL_WEIGHT: Record<AlertLevel, number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

function shouldSend(alertLevel: AlertLevel, minLevel: AlertLevel): boolean {
  return LEVEL_WEIGHT[alertLevel] >= LEVEL_WEIGHT[minLevel];
}

// ── 渠道实现: Console ─────────────────────────────────────

class ConsoleSender implements NotificationSender {
  readonly channel: NotificationChannel = "console";

  async send(alert: Alert): Promise<void> {
    const prefix = {
      info: "[INFO]",
      warn: "[WARN]",
      critical: "[CRITICAL]",
    }[alert.level];

    console.log(
      `${prefix} ${alert.timestamp} | ${alert.type} | ${alert.title}`,
    );
    console.log(`  ${alert.message}`);
    if (alert.data) {
      console.log(`  data:`, JSON.stringify(alert.data, null, 2));
    }
  }
}

// ── 渠道实现: DingTalk ────────────────────────────────────

interface DingTalkConfig {
  webhookUrl: string;
  secret?: string;
}

class DingTalkSender implements NotificationSender {
  readonly channel: NotificationChannel = "dingtalk";
  private readonly webhookUrl: string;
  private readonly secret?: string;

  constructor(config: DingTalkConfig) {
    this.webhookUrl = config.webhookUrl;
    this.secret = config.secret;
  }

  async send(alert: Alert): Promise<void> {
    const title = `[${alert.level.toUpperCase()}] ${alert.title}`;
    const text = `### ${title}\n\n**类型**: ${alert.type}\n\n**时间**: ${alert.timestamp}\n\n${alert.message}${alert.data ? `\n\n**数据**: \`\`\`json\n${JSON.stringify(alert.data, null, 2)}\n\`\`\`` : ""}`;

    const payload: Record<string, unknown> = {
      msgtype: "markdown",
      markdown: { title, text },
    };

    try {
      const url = this.secret
        ? this.signUrl(this.webhookUrl, this.secret)
        : this.webhookUrl;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `[DingTalkSender] 发送失败: HTTP ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      console.error(`[DingTalkSender] 发送异常:`, err);
    }
  }

  /** 钉钉加签（如配置了 secret） */
  private signUrl(webhookUrl: string, _secret: string): string {
    // 简化实现：返回原始 URL
    // 生产环境应实现 HMAC-SHA256 签名并拼接 timestamp 和 sign 参数
    return webhookUrl;
  }
}

// ── 渠道实现: Email ───────────────────────────────────────

interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  from: string;
  to: string[];
}

class EmailSender implements NotificationSender {
  readonly channel: NotificationChannel = "email";
  private readonly config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async send(alert: Alert): Promise<void> {
    // 简化实现：通过控制台输出模拟邮件发送
    // 生产环境可集成 nodemailer 或调用邮件 API
    console.log(
      `[EmailSender] 模拟发送邮件`,
      JSON.stringify({
        from: this.config.from,
        to: this.config.to,
        subject: `[${alert.level.toUpperCase()}] ${alert.title}`,
        body: `${alert.message}\n\n类型: ${alert.type}\n时间: ${alert.timestamp}`,
      }),
    );
  }
}

// ── 通知服务 ──────────────────────────────────────────────

export class NotificationService {
  private readonly config: NotificationConfig;
  private readonly senders: Map<NotificationChannel, NotificationSender> =
    new Map();

  constructor(config: NotificationConfig) {
    this.config = config;
  }

  /** 注册通知渠道发送者 */
  registerSender(sender: NotificationSender): void {
    this.senders.set(sender.channel, sender);
  }

  /** 从 ChannelConfig 数组初始化渠道 */
  initializeFromConfig(channelConfigs: ChannelConfig[]): void {
    for (const cc of channelConfigs) {
      if (!cc.enabled) continue;

      switch (cc.channel) {
        case "console":
          this.registerSender(new ConsoleSender());
          break;
        case "dingtalk":
          this.registerSender(
            new DingTalkSender(
              (cc.options as DingTalkConfig) ?? { webhookUrl: "" },
            ),
          );
          break;
        case "email":
          this.registerSender(
            new EmailSender(
              (cc.options as EmailConfig) ?? {
                smtpHost: "",
                smtpPort: 587,
                username: "",
                password: "",
                from: "",
                to: [],
              },
            ),
          );
          break;
        default:
          // custom channel — skip (caller must register manually)
          break;
      }
    }
  }

  /** 创建并发送告警 */
  async sendAlert(params: {
    level: AlertLevel;
    type: AlertType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const alert: Alert = {
      id: this.generateId(),
      level: params.level,
      type: params.type,
      title: params.title,
      message: params.message,
      timestamp: new Date().toISOString(),
      data: params.data,
    };

    await this.dispatch(alert);
  }

  /** 直接发送已有的 Alert 对象 */
  async dispatch(alert: Alert): Promise<void> {
    if (!shouldSend(alert.level, this.config.minLevel)) {
      return;
    }

    const promises: Promise<void>[] = [];

    for (const cc of this.config.channels) {
      if (!cc.enabled) continue;

      const sender = this.senders.get(cc.channel);
      if (sender) {
        promises.push(
          sender.send(alert).catch((err) => {
            console.error(
              `[NotificationService] 渠道 ${cc.channel} 发送失败:`,
              err,
            );
          }),
        );
      }
    }

    await Promise.allSettled(promises);
  }

  private generateId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ── 便捷工厂函数 ──────────────────────────────────────────

/** 创建默认的 NotificationService（仅控制台） */
export function createConsoleNotificationService(
  minLevel: AlertLevel = "info",
): NotificationService {
  const config: NotificationConfig = {
    channels: [{ channel: "console", enabled: true }],
    minLevel,
  };
  const service = new NotificationService(config);
  service.initializeFromConfig(config.channels);
  return service;
}

/** 根据完整配置创建 NotificationService */
export function createNotificationService(
  config: NotificationConfig,
): NotificationService {
  const service = new NotificationService(config);
  service.initializeFromConfig(config.channels);
  return service;
}
