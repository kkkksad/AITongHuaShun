import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AlertChannel,
  AlertService,
  ConsoleChannel,
  WebhookChannel,
  getAlertService,
  resetAlertService,
} from "./alertService";

// ── Helpers ───────────────────────────────────────────────────

function createMockChannel(name: string): AlertChannel & { calls: unknown[][] } {
  const channel: AlertChannel & { calls: unknown[][] } = {
    name,
    calls: [],
    async send(level, title, message) {
      channel.calls.push([level, title, message]);
    },
  };
  return channel;
}

// ── ConsoleChannel ────────────────────────────────────────────

describe("ConsoleChannel", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("name 为 'console'", () => {
    const channel = new ConsoleChannel();
    expect(channel.name).toBe("console");
  });

  it("info 级别输出包含 ℹ️ 前缀", async () => {
    const channel = new ConsoleChannel();
    await channel.send("info", "测试标题", "这是一条信息");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    const logOutput = consoleLogSpy.mock.calls[0][0] as string;
    expect(logOutput).toContain("ℹ️");
    expect(logOutput).toContain("[测试标题]");
    expect(logOutput).toContain("这是一条信息");
  });

  it("warn 级别输出包含 ⚠️ 前缀", async () => {
    const channel = new ConsoleChannel();
    await channel.send("warn", "警告标题", "这是警告");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);

    const logOutput = consoleLogSpy.mock.calls[0][0] as string;
    expect(logOutput).toContain("⚠️");
  });

  it("critical 级别同时输出到 console.error", async () => {
    const channel = new ConsoleChannel();
    await channel.send("critical", "严重标题", "严重错误");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    const errOutput = consoleErrorSpy.mock.calls[0][0] as string;
    expect(errOutput).toContain("🔴 CRITICAL");
    expect(errOutput).toContain("严重标题");
  });
});

// ── WebhookChannel ────────────────────────────────────────────

describe("WebhookChannel", () => {
  it("默认 platform 为 dingtalk", () => {
    const channel = new WebhookChannel({
      url: "https://oapi.dingtalk.com/robot/send?access_token=test",
    });
    expect(channel.name).toBe("webhook:dingtalk");
  });

  it("支持企业微信 platform", () => {
    const channel = new WebhookChannel({
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
      platform: "wecom",
    });
    expect(channel.name).toBe("webhook:wecom");
  });

  it("支持自定义超时", () => {
    const channel = new WebhookChannel({
      url: "https://example.com/webhook",
      timeoutMs: 3000,
    });
    // 构造成功即通过
    expect(channel.name).toBe("webhook:dingtalk");
  });

  it("send 产生 POST 请求到正确 URL", async () => {
    // 使用 fetch mock
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock;

    try {
      const channel = new WebhookChannel({
        url: "https://oapi.dingtalk.com/robot/send?access_token=abc",
      });
      await channel.send("warn", "熔断预警", "连续亏损接近阈值");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [urlArg, initArg] = fetchMock.mock.calls[0];
      expect(urlArg).toBe(
        "https://oapi.dingtalk.com/robot/send?access_token=abc",
      );
      expect(initArg.method).toBe("POST");
      expect(initArg.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(initArg.body as string);
      expect(body.msgtype).toBe("markdown");
      expect(body.markdown.title).toBe("熔断预警");
      expect(body.markdown.text).toContain("连续亏损接近阈值");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("请求失败时输出错误日志且不抛异常", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockRejectedValue(new Error("网络错误"));
    globalThis.fetch = fetchMock;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const channel = new WebhookChannel({
        url: "https://bad.url/webhook",
      });
      // 不应抛出异常
      await channel.send("critical", "严重错误", "服务不可用");

      expect(errorSpy).toHaveBeenCalled();
      const errMsg = errorSpy.mock.calls[0].join(" ");
      expect(errMsg).toContain("网络错误");
    } finally {
      globalThis.fetch = originalFetch;
      errorSpy.mockRestore();
    }
  });
});

// ── AlertService ──────────────────────────────────────────────

describe("AlertService", () => {
  beforeEach(() => {
    resetAlertService();
  });

  it("getAlertService 返回单例", () => {
    const svc1 = getAlertService();
    const svc2 = getAlertService();
    expect(svc1).toBe(svc2);
  });

  it("resetAlertService 重置单例", () => {
    const svc1 = getAlertService();
    resetAlertService();
    const svc2 = getAlertService();
    expect(svc1).not.toBe(svc2);
  });

  it("初始渠道列表为空", () => {
    const svc = getAlertService();
    expect(svc.getChannelNames()).toEqual([]);
  });

  it("addChannel 添加渠道并支持链式调用", () => {
    const svc = getAlertService();
    const ch = createMockChannel("test");
    svc.addChannel(ch);
    expect(svc.getChannelNames()).toEqual(["test"]);
  });

  it("removeChannel 移除指定渠道", () => {
    const svc = getAlertService();
    const ch1 = createMockChannel("ch1");
    const ch2 = createMockChannel("ch2");
    svc.addChannel(ch1).addChannel(ch2);
    svc.removeChannel("ch1");
    expect(svc.getChannelNames()).toEqual(["ch2"]);
  });

  it("setMinLevel 低于阈值的告警不发送", async () => {
    const svc = getAlertService();
    svc.setMinLevel("warn");
    const ch = createMockChannel("mock");
    svc.addChannel(ch);

    await svc.send("info", "信息", "不应该发送");
    expect(ch.calls).toHaveLength(0);

    await svc.send("warn", "警告", "应该发送");
    expect(ch.calls).toHaveLength(1);

    await svc.send("critical", "严重", "应该发送");
    expect(ch.calls).toHaveLength(2);
  });

  it("send 调用所有已注册渠道", async () => {
    const svc = getAlertService();
    const ch1 = createMockChannel("console");
    const ch2 = createMockChannel("webhook");
    svc.addChannel(ch1).addChannel(ch2);

    await svc.send("critical", "熔断触发", "日内回撤已超过阈值");

    expect(ch1.calls).toHaveLength(1);
    expect(ch1.calls[0]).toEqual(["critical", "熔断触发", "日内回撤已超过阈值"]);

    expect(ch2.calls).toHaveLength(1);
    expect(ch2.calls[0]).toEqual(["critical", "熔断触发", "日内回撤已超过阈值"]);
  });

  it("某个渠道失败不影响其他渠道发送", async () => {
    const svc = getAlertService();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const good = createMockChannel("good");
    const bad: AlertChannel = {
      name: "bad",
      async send() {
        throw new Error("发送失败");
      },
    };

    svc.addChannel(good).addChannel(bad);
    await svc.send("warn", "测试", "部分失败场景");

    expect(good.calls).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

// ── 多 Channel 集成测试 ──────────────────────────────────────

describe("多 Channel 集成", () => {
  beforeEach(() => {
    resetAlertService();
  });

  it("ConsoleChannel + WebhookChannel 同时工作", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Mock fetch for webhook
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    try {
      const svc = getAlertService();
      svc.addChannel(new ConsoleChannel());
      svc.addChannel(
        new WebhookChannel({ url: "https://example.com/webhook" }),
      );

      await svc.send("critical", "风控熔断", "日内回撤超过8%");

      // ConsoleChannel 有输出
      expect(logSpy).toHaveBeenCalled();
      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain("🔴");
      expect(logMsg).toContain("风控熔断");

      // WebhookChannel 发送了 POST
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      logSpy.mockRestore();
    }
  });

  it("riskEngine 典型调用模式", async () => {
    const svc = getAlertService();
    const ch = createMockChannel("mock");
    svc.addChannel(ch);

    // 模拟 riskEngine 熔断时调用
    await svc.send(
      "critical",
      "熔断器触发",
      `CIRCUIT_BREAKER_TRIPPED: 连续亏损 5 次，等待冷却`,
    );

    expect(ch.calls).toHaveLength(1);
    const [level, title, msg] = ch.calls[0];
    expect(level).toBe("critical");
    expect(title).toBe("熔断器触发");
    expect(msg).toContain("CIRCUIT_BREAKER_TRIPPED");
  });
});
