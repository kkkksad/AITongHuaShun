import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Logger, getLogger, resetLogger, type LogLevel } from "./logger";

// ── 辅助函数 ──────────────────────────────────────────────

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `logger-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readLogFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}

// ── 测试 ──────────────────────────────────────────────────

describe("Logger", () => {
  it("should create a Logger with default config", () => {
    const logger = new Logger();
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.currentLogFile).toBeNull();
  });

  it("should create a Logger with custom minLevel", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ minLevel: "warn", console: true });
    logger.info("test", "this should not appear");
    logger.debug("test", "this should also not appear");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.length).toBe(0);

    spy.mockRestore();
  });

  it("should output at or above minLevel", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ minLevel: "warn", console: true });
    logger.warn("test", "warning message");
    logger.error("test", "error message");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("warning message"))).toBe(true);
    expect(calls.some((s) => s.includes("error message"))).toBe(true);

    spy.mockRestore();
  });

  it("should include module name in log output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: true });
    logger.info("myModule", "hello world");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[myModule]"))).toBe(true);

    spy.mockRestore();
  });

  it("should include data in log output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: true });
    logger.info("api", "request received", {
      method: "POST",
      path: "/api/orders",
      statusCode: 201,
    });

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("POST"))).toBe(true);
    expect(calls.some((s) => s.includes("/api/orders"))).toBe(true);

    spy.mockRestore();
  });

  it("should write log entries to file", () => {
    const dir = tempDir();
    try {
      const logger = new Logger({
        logDir: dir,
        filePrefix: "test",
        console: false,
      });

      logger.info("test", "first message");
      logger.warn("test", "second message", { key: "value" });

      const logPath = logger.currentLogFile!;
      expect(fs.existsSync(logPath)).toBe(true);

      const entries = readLogFile(logPath);
      expect(entries.length).toBeGreaterThanOrEqual(2);

      const parsed = entries.map((e) => JSON.parse(e));
      expect(parsed.some((e) => e.message === "first message")).toBe(true);
      expect(parsed.some((e) => e.message === "second message")).toBe(true);
      expect(parsed.some((e) => e.data?.key === "value")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should write structured JSON entries", () => {
    const dir = tempDir();
    try {
      const logger = new Logger({
        logDir: dir,
        filePrefix: "struct",
        console: false,
      });

      logger.info("module", "test message", { userId: "abc123" });

      const entries = readLogFile(logger.currentLogFile!);
      const parsed = entries.map((e) => JSON.parse(e));

      for (const entry of parsed) {
        expect(entry).toHaveProperty("timestamp");
        expect(entry).toHaveProperty("level");
        expect(entry).toHaveProperty("module");
        expect(entry).toHaveProperty("message");
        expect(typeof entry.timestamp).toBe("string");
        expect(["debug", "info", "warn", "error"]).toContain(entry.level);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should include error stack in log entry", () => {
    const dir = tempDir();
    try {
      const logger = new Logger({
        logDir: dir,
        filePrefix: "error",
        console: false,
      });

      const err = new Error("test failure");
      logger.error("module", "something went wrong", {}, err);

      const entries = readLogFile(logger.currentLogFile!);
      const errorEntries = entries
        .map((e) => JSON.parse(e))
        .filter((e: { level: string }) => e.level === "error");

      expect(errorEntries.length).toBeGreaterThanOrEqual(1);
      expect(errorEntries[0].error).toContain("test failure");
      expect(errorEntries[0].error).toContain("Error:");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should support ScopedLogger via child()", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: true });
    const apiLogger = logger.child("api");
    apiLogger.info("request received");
    apiLogger.warn("rate limit approaching");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[api]"))).toBe(true);
    expect(calls.some((s) => s.includes("request received"))).toBe(true);
    expect(calls.some((s) => s.includes("rate limit approaching"))).toBe(true);

    spy.mockRestore();
  });

  it("should support nested ScopedLogger", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: true });
    const apiLogger = logger.child("api");
    const orderLogger = apiLogger.child("orders");
    orderLogger.info("order created");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("[api:orders]"))).toBe(true);

    spy.mockRestore();
  });

  it("should filter by level correctly for all levels", () => {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    for (const minLevel of levels) {
      spy.mockClear();
      const logger = new Logger({ minLevel, console: true });

      logger.debug("test", "debug msg");
      logger.info("test", "info msg");
      logger.warn("test", "warn msg");
      logger.error("test", "error msg");

      const calls = spy.mock.calls.map((c) => c.join(" "));

      for (const level of levels) {
        const keyword = `${level} msg`;
        const shouldAppear = LEVEL_WEIGHT(level) >= LEVEL_WEIGHT(minLevel);
        expect(calls.some((s) => s.includes(keyword))).toBe(shouldAppear);
      }
    }

    spy.mockRestore();
  });

  it("should support getLogger singleton", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const log1 = getLogger({ console: true, minLevel: "info" });
    const log2 = getLogger({ console: true, minLevel: "warn" });

    // Singleton — same instance
    expect(log1).toBe(log2);

    log1.info("test", "from log1");
    log2.info("test", "from log2");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("from log1"))).toBe(true);
    expect(calls.some((s) => s.includes("from log2"))).toBe(true);

    resetLogger();
    spy.mockRestore();
  });

  it("should create log file with date-based name", () => {
    const dir = tempDir();
    try {
      const logger = new Logger({
        logDir: dir,
        filePrefix: "rotate",
        console: false,
        maxDays: 7,
      });

      logger.info("test", "entry in file");

      const logPath = logger.currentLogFile!;
      expect(fs.existsSync(logPath)).toBe(true);

      // File name should match pattern like rotate-2026-07-10.log
      const basename = path.basename(logPath);
      expect(basename).toMatch(/^rotate-\d{4}-\d{2}-\d{2}\.log$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should clean old log files based on mtime (not filename)", () => {
    const dir = tempDir();
    try {
      // Create a file with a very old modification time
      const oldFile = path.join(dir, "test-old-2000-01-01.log");
      fs.writeFileSync(oldFile, '{"old":true}\n');

      // Set mtime to 30 days ago
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, thirtyDaysAgo, thirtyDaysAgo);

      // Logger with maxDays=7 should clean files older than 7 days
      const logger = new Logger({
        logDir: dir,
        filePrefix: "test-old",
        console: false,
        maxDays: 7,
      });

      logger.info("test", "current log");

      // Old file should be cleaned (30 days > 7 days max)
      expect(fs.existsSync(oldFile)).toBe(false);

      // Current log should exist
      expect(fs.existsSync(logger.currentLogFile!)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should not fail when logDir does not exist (auto-create)", () => {
    const dir = path.join(os.tmpdir(), `nonexistent-${Date.now()}`);
    try {
      expect(fs.existsSync(dir)).toBe(false);

      const logger = new Logger({
        logDir: dir,
        filePrefix: "test",
        console: false,
      });

      logger.info("test", "created dir implicitly");

      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(logger.currentLogFile!)).toBe(true);
    } finally {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("should handle console disabled mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: false });
    logger.info("test", "no console output");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.length).toBe(0);

    spy.mockRestore();
  });

  it("should handle colorize disabled mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = new Logger({ console: true, colorize: false });
    logger.info("test", "plain output");

    const calls = spy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((s) => s.includes("INFO"))).toBe(true);
    // No ANSI codes
    expect(calls.every((s) => !s.includes("\x1b["))).toBe(true);

    spy.mockRestore();
  });

  it("should escape special characters in JSON data", () => {
    const dir = tempDir();
    try {
      const logger = new Logger({
        logDir: dir,
        filePrefix: "escape",
        console: false,
      });

      logger.info("test", "special chars", {
        text: 'hello "world"\nnewline',
        nested: { key: "value" },
      });

      const entries = readLogFile(logger.currentLogFile!);
      // Should be valid JSON
      for (const entry of entries) {
        expect(() => JSON.parse(entry)).not.toThrow();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 测试辅助 ──────────────────────────────────────────────

function LEVEL_WEIGHT(level: LogLevel): number {
  return { debug: 0, info: 1, warn: 2, error: 3 }[level];
}
