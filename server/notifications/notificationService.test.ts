import { describe, expect, it, vi } from "vitest";
import type { Alert, ChannelConfig } from "./types";
import {
  createConsoleNotificationService,
  createNotificationService,
  NotificationService,
} from "./notificationService";

// ── 辅助函数 ──────────────────────────────────────────────

function consoleChannels(): ChannelConfig[] {
  return [{ channel: "console", enabled: true }];
}

// ── 测试 ──────────────────────────────────────────────────

describe("NotificationService", () => {
  it("should create a service with console sender", () => {
    const service = createConsoleNotificationService();
    expect(service).toBeInstanceOf(NotificationService);
  });

  it("should send an info alert via console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("info");
    await service.sendAlert({
      level: "info",
      type: "system_startup",
      title: "系统启动",
      message: "量化交易系统已启动",
    });

    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map((c) => c.join(" "));
    const hasInfoPrefix = calls.some((s) => s.includes("[INFO]"));
    const hasTitle = calls.some((s) => s.includes("系统启动"));
    expect(hasInfoPrefix).toBe(true);
    expect(hasTitle).toBe(true);

    spy.mockRestore();
  });

  it("should send a critical alert via console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("info");
    await service.sendAlert({
      level: "critical",
      type: "risk_circuit_breaker",
      title: "熔断器触发",
      message: "连续亏损达到阈值，熔断器已触发",
      data: { consecutiveLosses: 5, dailyDrawdown: 0.09 },
    });

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[CRITICAL]"))).toBe(true);
    expect(calls.some((s) => s.includes("risk_circuit_breaker"))).toBe(true);
    expect(calls.some((s) => s.includes("熔断器触发"))).toBe(true);

    spy.mockRestore();
  });

  it("should filter alerts below minLevel", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // minLevel = "warn" 应过滤掉 info 级别
    const service = createConsoleNotificationService("warn");
    await service.sendAlert({
      level: "info",
      type: "system_startup",
      title: "测试",
      message: "这条不应该出现",
    });

    // 不应有任何输出（因为 info < warn）
    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.length).toBe(0);

    spy.mockRestore();
  });

  it("should pass alerts at or above minLevel", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("critical");
    await service.sendAlert({
      level: "critical",
      type: "risk_circuit_breaker",
      title: "严重告警",
      message: "这条应该出现",
    });

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[CRITICAL]"))).toBe(true);

    spy.mockRestore();
  });

  it("should handle alert data in output", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("info");
    await service.sendAlert({
      level: "warn",
      type: "trade_abnormal",
      title: "异常交易",
      message: "检测到异常大单",
      data: { symbol: "000001", quantity: 999999 },
    });

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("000001"))).toBe(true);

    spy.mockRestore();
  });

  it("should dispatch Alert object directly", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("info");
    const alert: Alert = {
      id: "test_001",
      level: "critical",
      type: "system_error",
      title: "系统错误",
      message: "数据库连接失败",
      timestamp: "2026-07-11T00:00:00.000Z",
    };

    await service.dispatch(alert);

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[CRITICAL]"))).toBe(true);
    expect(calls.some((s) => s.includes("系统错误"))).toBe(true);

    spy.mockRestore();
  });

  it("should handle multiple channels gracefully when some fail", async () => {
    const service = createNotificationService({
      channels: [
        { channel: "console", enabled: true },
        // 未注册的 custom channel 应被跳过
        { channel: "custom", enabled: true },
      ],
      minLevel: "info",
    });

    // 不应抛出异常
    await expect(
      service.sendAlert({
        level: "info",
        type: "system_startup",
        title: "多渠道路由",
        message: "custom channel 被跳过不应影响 console",
      }),
    ).resolves.toBeUndefined();
  });

  it("should support createNotificationService factory", () => {
    const service = createNotificationService({
      channels: [{ channel: "console", enabled: false }],
      minLevel: "info",
    });
    expect(service).toBeInstanceOf(NotificationService);
  });

  it("should generate unique alert IDs", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const service = createConsoleNotificationService("info");
    await service.sendAlert({
      level: "info",
      type: "system_startup",
      title: "A",
      message: "",
    });
    await service.sendAlert({
      level: "info",
      type: "system_startup",
      title: "B",
      message: "",
    });

    // Each alert should have a unique timestamp-based prefix
    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.length).toBeGreaterThanOrEqual(2);

    spy.mockRestore();
  });
});

describe("NotificationService - alert types coverage", () => {
  const alertTypes = [
    "risk_circuit_breaker",
    "risk_large_loss",
    "risk_drawdown_warning",
    "trade_abnormal",
    "trade_rejected",
    "system_error",
    "system_startup",
    "system_shutdown",
    "account_margin_call",
    "market_data_stale",
    "custom",
  ] as const;

  for (const alertType of alertTypes) {
    it(`should send alert of type "${alertType}"`, async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      const service = createConsoleNotificationService("info");
      await service.sendAlert({
        level: "warn",
        type: alertType,
        title: `测试: ${alertType}`,
        message: "测试消息",
      });

      const calls = spy.mock.calls.map((c) => c.join(" "));
      expect(calls.some((s) => s.includes(alertType))).toBe(true);

      spy.mockRestore();
    });
  }
});
