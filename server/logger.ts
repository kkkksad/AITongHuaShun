/**
 * 结构化日志系统
 *
 * 功能：
 * - 日志级别：DEBUG < INFO < WARN < ERROR
 * - 结构化输出：JSON 格式，包含 timestamp、level、module、message、data
 * - 文件轮转：按日期自动创建新日志文件，保留最近 N 天
 * - 双输出：控制台（彩色）+ 文件（JSON）
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── 类型定义 ──────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface LoggerConfig {
  /** 最低输出级别（低于此级别的日志不输出） */
  minLevel?: LogLevel;
  /** 日志文件目录（为空则不写文件） */
  logDir?: string;
  /** 日志文件前缀 */
  filePrefix?: string;
  /** 保留最近 N 天的日志文件 */
  maxDays?: number;
  /** 是否输出到控制台 */
  console?: boolean;
  /** 控制台是否使用彩色输出 */
  colorize?: boolean;
}

// ── 级别权重 ──────────────────────────────────────────────

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── ANSI 颜色 ─────────────────────────────────────────────

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const COLOR_RESET = "\x1b[0m";
const COLOR_DIM = "\x1b[2m";

// ── Logger 实现 ───────────────────────────────────────────

export class Logger {
  private readonly config: Required<LoggerConfig>;
  private currentLogFilePath: string = "";

  constructor(config: LoggerConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? "info",
      logDir: config.logDir ?? "",
      filePrefix: config.filePrefix ?? "app",
      maxDays: config.maxDays ?? 7,
      console: config.console ?? true,
      colorize: config.colorize ?? true,
    };

    if (this.config.logDir) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
      this.cleanOldFiles();
    }
  }

  /** 创建带模块名的子 Logger */
  child(module: string): ScopedLogger {
    return new ScopedLogger(this, module);
  }

  // ── 核心日志方法 ─────────────────────────────────────

  log(
    level: LogLevel,
    module: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.config.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
      error: error
        ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
        : undefined,
    };

    if (this.config.console) {
      this.writeConsole(entry);
    }

    if (this.config.logDir) {
      this.writeFile(entry);
    }
  }

  debug(module: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", module, message, data);
  }

  info(module: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", module, message, data);
  }

  warn(module: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", module, message, data);
  }

  error(
    module: string,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    this.log("error", module, message, data, error);
  }

  // ── 控制台输出 ───────────────────────────────────────

  private writeConsole(entry: LogEntry): void {
    const color = this.config.colorize ? COLORS[entry.level] : "";
    const dim = this.config.colorize ? COLOR_DIM : "";
    const reset = this.config.colorize ? COLOR_RESET : "";

    const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const prefix = `${dim}${time}${reset} ${color}${entry.level.toUpperCase().padEnd(5)}${reset}`;
    const mod = `${dim}[${entry.module}]${reset}`;
    const line = `${prefix} ${mod} ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataStr = JSON.stringify(entry.data);
      console.log(line, dim + dataStr + reset);
    } else {
      console.log(line);
    }

    if (entry.error) {
      console.log(`${dim}${entry.error}${reset}`);
    }
  }

  // ── 文件输出（同步写入，保证测试可靠性）──────────────

  private getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${this.config.filePrefix}-${date}.log`;
    return path.join(this.config.logDir!, filename);
  }

  private writeFile(entry: LogEntry): void {
    const filePath = this.getLogFilePath();

    // 日期切换时清理旧文件
    if (filePath !== this.currentLogFilePath) {
      this.currentLogFilePath = filePath;
      this.cleanOldFiles();
    }

    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
  }

  private cleanOldFiles(): void {
    if (!this.config.logDir) return;

    try {
      const prefix = this.config.filePrefix;
      const maxAgeMs = this.config.maxDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const files = fs.readdirSync(this.config.logDir);
      for (const file of files) {
        if (!file.startsWith(prefix) || !file.endsWith(".log")) continue;

        const filePath = path.join(this.config.logDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // 单个文件操作失败不影响整体
        }
      }
    } catch {
      // 清理失败不阻塞日志写入
    }
  }

  /** 获取当前日志文件路径（用于调试和测试） */
  get currentLogFile(): string | null {
    if (!this.config.logDir) return null;
    return this.currentLogFilePath || this.getLogFilePath();
  }

  /** 刷新并关闭（同步写模式下为 no-op，保留以兼容接口） */
  close(): void {
    // no-op: 同步写入无需 flush
  }
}

// ── 模块作用域 Logger ─────────────────────────────────────

export class ScopedLogger {
  constructor(
    private readonly parent: Logger,
    private readonly module: string,
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.parent.debug(this.module, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.parent.info(this.module, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.parent.warn(this.module, message, data);
  }

  error(message: string, data?: Record<string, unknown>, error?: Error): void {
    this.parent.error(this.module, message, data, error);
  }

  /** 创建子模块 Logger */
  child(subModule: string): ScopedLogger {
    return new ScopedLogger(this.parent, `${this.module}:${subModule}`);
  }
}

// ── 默认单例 ──────────────────────────────────────────────

let defaultLogger: Logger | null = null;

export function getLogger(config?: LoggerConfig): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger(config);
  }
  return defaultLogger;
}

export function resetLogger(): void {
  if (defaultLogger) {
    defaultLogger.close();
    defaultLogger = null;
  }
}
