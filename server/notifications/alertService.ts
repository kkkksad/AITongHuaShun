import type { AlertLevel } from "./types";

// ── 告警渠道接口 ──────────────────────────────────────────────

export interface AlertChannel {
  /** 渠道名称 */
  readonly name: string;
  /** 发送告警 */
  send(level: AlertLevel, title: string, message: string): Promise<void>;
}

// ── ConsoleChannel ────────────────────────────────────────────

export class ConsoleChannel implements AlertChannel {
  readonly name = "console";

  async send(level: AlertLevel, title: string, message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const prefix = this.levelPrefix(level);
    console.log(`[${timestamp}] ${prefix}[${title}] ${message}`);
    if (level === "critical") {
      console.error(
        `[${timestamp}] 🔴 CRITICAL: ${title} — ${message}`,
      );
    }
  }

  private levelPrefix(level: AlertLevel): string {
    switch (level) {
      case "info":
        return "ℹ️ ";
      case "warn":
        return "⚠️ ";
      case "critical":
        return "🔴 ";
    }
  }
}

// ── WebhookChannel（钉钉 / 企业微信） ─────────────────────────

export interface WebhookChannelConfig {
  /** webhook URL */
  url: string;
  /** 平台类型：dingtalk | wecom */
  platform?: "dingtalk" | "wecom";
  /** 请求超时毫秒数 */
  timeoutMs?: number;
}

export class WebhookChannel implements AlertChannel {
  readonly name: string;
  private readonly url: string;
  private readonly platform: "dingtalk" | "wecom";
  private readonly timeoutMs: number;

  constructor(config: WebhookChannelConfig) {
    this.url = config.url;
    this.platform = config.platform ?? "dingtalk";
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.name = `webhook:${this.platform}`;
  }

  async send(level: AlertLevel, title: string, message: string): Promise<void> {
    const payload = this.buildPayload(level, title, message);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(
          `[WebhookChannel] ${this.platform} 发送失败: HTTP ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      console.error(
        `[WebhookChannel] ${this.platform} 发送异常: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPayload(
    level: AlertLevel,
    title: string,
    message: string,
  ): Record<string, unknown> {
    const markdownContent = this.buildMarkdown(level, title, message);

    if (this.platform === "dingtalk") {
      return {
        msgtype: "markdown",
        markdown: {
          title,
          text: markdownContent,
        },
      };
    }

    // 企业微信
    return {
      msgtype: "markdown",
      markdown: {
        content: markdownContent,
      },
    };
  }

  private buildMarkdown(level: AlertLevel, title: string, message: string): string {
    const levelLabel = this.levelLabel(level);
    const levelColor = this.levelColor(level);
    const timestamp = new Date().toISOString();

    return [
      `## ${levelLabel} ${title}`,
      "",
      `> 级别: <font color="${levelColor}">${levelLabel}</font>`,
      `> 时间: ${timestamp}`,
      "",
      message,
    ].join("\n");
  }

  private levelLabel(level: AlertLevel): string {
    switch (level) {
      case "info":
        return "ℹ️ 信息";
      case "warn":
        return "⚠️ 警告";
      case "critical":
        return "🔴 严重";
    }
  }

  private levelColor(level: AlertLevel): string {
    switch (level) {
      case "info":
        return "info";
      case "warn":
        return "warning";
      case "critical":
        return "red";
    }
  }
}

// ── AlertService ──────────────────────────────────────────────

export class AlertService {
  private channels: AlertChannel[] = [];
  /** 低于此级别的告警不发送 */
  private minLevel: AlertLevel = "info";

  /** 添加一个通知渠道 */
  addChannel(channel: AlertChannel): this {
    this.channels.push(channel);
    return this;
  }

  /** 移除指定名称的渠道 */
  removeChannel(name: string): this {
    this.channels = this.channels.filter((ch) => ch.name !== name);
    return this;
  }

  /** 设置最低告警级别 */
  setMinLevel(level: AlertLevel): this {
    this.minLevel = level;
    return this;
  }

  /** 获取所有渠道名称 */
  getChannelNames(): string[] {
    return this.channels.map((ch) => ch.name);
  }

  /**
   * 发送告警到所有渠道。
   * riskEngine / 策略可直接调用此方法。
   */
  async send(
    level: AlertLevel,
    title: string,
    message: string,
  ): Promise<void> {
    if (!this.shouldSend(level)) {
      return;
    }

    const results = await Promise.allSettled(
      this.channels.map((channel) => channel.send(level, title, message)),
    );

    // 记录失败的渠道
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.error(
          `[AlertService] 渠道 "${this.channels[i].name}" 发送失败:`,
          result.reason,
        );
      }
    }
  }

  private shouldSend(level: AlertLevel): boolean {
    const levels: AlertLevel[] = ["info", "warn", "critical"];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }
}

// ── 单例 ──────────────────────────────────────────────────────

let instance: AlertService | null = null;

export function getAlertService(): AlertService {
  if (!instance) {
    instance = new AlertService();
  }
  return instance;
}

/** 重置单例（仅供测试使用） */
export function resetAlertService(): void {
  instance = null;
}
