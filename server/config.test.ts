/**
 * 配置层测试 —— 验证环境变量解析、默认值、和边界条件。
 * 覆盖 config.ts 中所有环境变量的校验逻辑。
 */
import { describe, expect, it } from "vitest";

// ── Mock process.env before importing config ──
// We need to be careful: config loads at import time via loadEnv.
// Since vitest runs in Node environment, we can manipulate process.env
// and then dynamically re-evaluate. For simplicity, we test the schema directly.

import { z } from "zod";

// Replicate the envSchema from config.ts for testing (without dotenv side effects)
const envSchema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
  API_DOCS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MARKET_MODE: z.enum(["mock", "paper", "live"]).default("mock"),
  MARKET_DATA_PROVIDER: z.enum(["mock", "akshare"]).default("mock"),
  MARKET_TICK_MS: z.coerce.number().int().min(250).default(1000),
  MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  MARKET_SYMBOLS: z
    .string()
    .default("600519,000858,300750,601318,000001,600036,002594,688981"),
  AKSHARE_BRIDGE_URL: z.string().url().default("http://127.0.0.1:8800"),
  AKSHARE_BRIDGE_TOKEN: z.string().default(""),
  TRADING_STARTING_CASH: z.coerce.number().positive().default(1_000_000),
  MAX_ORDER_NOTIONAL: z.coerce.number().positive().default(100_000),
  MAX_POSITION_WEIGHT: z.coerce.number().min(0.01).max(1).default(0.25),
  MAX_DAILY_LOSS: z.coerce.number().min(0.001).max(1).default(0.05),
  COMMISSION_RATE: z.coerce.number().min(0).max(0.05).default(0.0003),
  MIN_COMMISSION: z.coerce.number().min(0).default(5),
  SLIPPAGE_BPS: z.coerce.number().min(0).max(500).default(5),
  REAL_TRADING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  STORE_BACKEND: z.enum(["memory", "json"]).default("memory"),
  DATA_DIR: z.string().default("./data"),
  CIRCUIT_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).max(50).default(5),
  CIRCUIT_MAX_DAILY_DRAWDOWN: z.coerce.number().min(0.01).max(0.5).default(0.08),
  CIRCUIT_COOLDOWN_MINUTES: z.coerce.number().int().min(5).max(480).default(15),
  CIRCUIT_RECOVERY_MINUTES: z.coerce.number().int().min(0).max(120).default(5),
  DYNAMIC_POSITION_SCALING: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MAX_DRAWDOWN_REDUCTION_FACTOR: z.coerce.number().min(0.1).max(1.0).default(0.25),
});

function parse(overrides: Record<string, string | undefined> = {}) {
  // Merge overrides with defaults for required fields
  const env = {
    // Provide all required defaults that have no zod default
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined)
    ),
  };
  return envSchema.parse(env);
}

describe("ServerConfig", () => {
  describe("defaults", () => {
    it("returns sensible defaults for an empty environment", () => {
      const config = parse();
      expect(config.API_HOST).toBe("127.0.0.1");
      expect(config.API_PORT).toBe(8787);
      expect(config.MARKET_MODE).toBe("mock");
      expect(config.MARKET_DATA_PROVIDER).toBe("mock");
      expect(config.MARKET_TICK_MS).toBe(1000);
      expect(config.TRADING_STARTING_CASH).toBe(1_000_000);
      expect(config.MAX_ORDER_NOTIONAL).toBe(100_000);
      expect(config.MAX_POSITION_WEIGHT).toBe(0.25);
      expect(config.MAX_DAILY_LOSS).toBe(0.05);
      expect(config.COMMISSION_RATE).toBe(0.0003);
      expect(config.MIN_COMMISSION).toBe(5);
      expect(config.SLIPPAGE_BPS).toBe(5);
      expect(config.REAL_TRADING_ENABLED).toBe(false);
      expect(config.STORE_BACKEND).toBe("memory");
      expect(config.DATA_DIR).toBe("./data");
    });

    it("has default market symbols as comma-separated string", () => {
      const config = parse();
      expect(config.MARKET_SYMBOLS).toContain("600519");
      expect(config.MARKET_SYMBOLS).toContain("000858");
      const symbols = config.MARKET_SYMBOLS.split(",");
      expect(symbols.length).toBeGreaterThanOrEqual(4);
    });

    it("has all 8 default market symbols", () => {
      const config = parse();
      const symbols = config.MARKET_SYMBOLS.split(",");
      expect(symbols).toEqual([
        "600519", "000858", "300750", "601318",
        "000001", "600036", "002594", "688981",
      ]);
    });

    it("circuit breaker defaults are sensible", () => {
      const config = parse();
      expect(config.CIRCUIT_MAX_CONSECUTIVE_LOSSES).toBe(5);
      expect(config.CIRCUIT_MAX_DAILY_DRAWDOWN).toBe(0.08);
      expect(config.CIRCUIT_COOLDOWN_MINUTES).toBe(15);
      expect(config.CIRCUIT_RECOVERY_MINUTES).toBe(5);
    });

    it("dynamic position scaling defaults to enabled", () => {
      const config = parse();
      expect(config.DYNAMIC_POSITION_SCALING).toBe(true);
      expect(config.MAX_DRAWDOWN_REDUCTION_FACTOR).toBe(0.25);
    });

    it("rate limit defaults", () => {
      const config = parse();
      expect(config.RATE_LIMIT_MAX).toBe(120);
      expect(config.RATE_LIMIT_WINDOW_MS).toBe(60_000);
    });

    it("AkShare bridge defaults", () => {
      const config = parse();
      expect(config.AKSHARE_BRIDGE_URL).toBe("http://127.0.0.1:8800");
      expect(config.AKSHARE_BRIDGE_TOKEN).toBe("");
    });

    it("API docs enabled by default", () => {
      const config = parse();
      expect(config.API_DOCS_ENABLED).toBe(true);
    });

    it("WEB_ORIGIN defaults to localhost vite dev URL", () => {
      const config = parse();
      expect(config.WEB_ORIGIN).toBe("http://127.0.0.1:4173");
    });
  });

  describe("overrides", () => {
    it("respects API_PORT override", () => {
      const config = parse({ API_PORT: "9000" });
      expect(config.API_PORT).toBe(9000);
    });

    it("respects MARKET_MODE paper override", () => {
      const config = parse({ MARKET_MODE: "paper" });
      expect(config.MARKET_MODE).toBe("paper");
    });

    it("respects MARKET_DATA_PROVIDER akshare", () => {
      const config = parse({ MARKET_DATA_PROVIDER: "akshare" });
      expect(config.MARKET_DATA_PROVIDER).toBe("akshare");
    });

    it("respects custom trading cash", () => {
      const config = parse({ TRADING_STARTING_CASH: "500000" });
      expect(config.TRADING_STARTING_CASH).toBe(500_000);
    });

    it("respects custom commission rate", () => {
      const config = parse({ COMMISSION_RATE: "0.00025" });
      expect(config.COMMISSION_RATE).toBe(0.00025);
    });

    it("respects custom slippage", () => {
      const config = parse({ SLIPPAGE_BPS: "10" });
      expect(config.SLIPPAGE_BPS).toBe(10);
    });

    it("respects STORE_BACKEND json", () => {
      const config = parse({ STORE_BACKEND: "json" });
      expect(config.STORE_BACKEND).toBe("json");
    });

    it("respects DATA_DIR override", () => {
      const config = parse({ DATA_DIR: "/var/data/trading" });
      expect(config.DATA_DIR).toBe("/var/data/trading");
    });

    it("respects custom circuit breaker config", () => {
      const config = parse({
        CIRCUIT_MAX_CONSECUTIVE_LOSSES: "10",
        CIRCUIT_MAX_DAILY_DRAWDOWN: "0.15",
        CIRCUIT_COOLDOWN_MINUTES: "30",
        CIRCUIT_RECOVERY_MINUTES: "10",
      });
      expect(config.CIRCUIT_MAX_CONSECUTIVE_LOSSES).toBe(10);
      expect(config.CIRCUIT_MAX_DAILY_DRAWDOWN).toBe(0.15);
      expect(config.CIRCUIT_COOLDOWN_MINUTES).toBe(30);
      expect(config.CIRCUIT_RECOVERY_MINUTES).toBe(10);
    });

    it("can disable dynamic position scaling", () => {
      const config = parse({ DYNAMIC_POSITION_SCALING: "false" });
      expect(config.DYNAMIC_POSITION_SCALING).toBe(false);
    });

    it("respects MAX_DRAWDOWN_REDUCTION_FACTOR", () => {
      const config = parse({ MAX_DRAWDOWN_REDUCTION_FACTOR: "0.5" });
      expect(config.MAX_DRAWDOWN_REDUCTION_FACTOR).toBe(0.5);
    });

    it("respects custom market symbols", () => {
      const config = parse({ MARKET_SYMBOLS: "600519,300750" });
      expect(config.MARKET_SYMBOLS).toBe("600519,300750");
    });

    it("respects MARKET_TICK_MS", () => {
      const config = parse({ MARKET_TICK_MS: "500" });
      expect(config.MARKET_TICK_MS).toBe(500);
    });

    it("respects MARKET_DATA_TIMEOUT_MS", () => {
      const config = parse({ MARKET_DATA_TIMEOUT_MS: "30000" });
      expect(config.MARKET_DATA_TIMEOUT_MS).toBe(30_000);
    });

    it("respects custom rate limit", () => {
      const config = parse({ RATE_LIMIT_MAX: "60", RATE_LIMIT_WINDOW_MS: "30000" });
      expect(config.RATE_LIMIT_MAX).toBe(60);
      expect(config.RATE_LIMIT_WINDOW_MS).toBe(30_000);
    });

    it("respects AkShare bridge URL and token", () => {
      const config = parse({
        AKSHARE_BRIDGE_URL: "http://10.0.0.1:9999",
        AKSHARE_BRIDGE_TOKEN: "secret-token-123",
      });
      expect(config.AKSHARE_BRIDGE_URL).toBe("http://10.0.0.1:9999");
      expect(config.AKSHARE_BRIDGE_TOKEN).toBe("secret-token-123");
    });

    it("can disable API docs", () => {
      const config = parse({ API_DOCS_ENABLED: "false" });
      expect(config.API_DOCS_ENABLED).toBe(false);
    });
  });

  describe("real trading guard", () => {
    it("REAL_TRADING_ENABLED defaults to false", () => {
      const config = parse();
      expect(config.REAL_TRADING_ENABLED).toBe(false);
    });

    it("can set REAL_TRADING_ENABLED to true", () => {
      const config = parse({ REAL_TRADING_ENABLED: "true" });
      expect(config.REAL_TRADING_ENABLED).toBe(true);
    });

    it("MARKET_MODE live does not automatically enable real trading", () => {
      const config = parse({ MARKET_MODE: "live" });
      expect(config.MARKET_MODE).toBe("live");
      expect(config.REAL_TRADING_ENABLED).toBe(false);
    });
  });

  describe("boundary values", () => {
    it("accepts minimum API_PORT", () => {
      const config = parse({ API_PORT: "1" });
      expect(config.API_PORT).toBe(1);
    });

    it("accepts maximum position weight (1.0 = 100%)", () => {
      const config = parse({ MAX_POSITION_WEIGHT: "1" });
      expect(config.MAX_POSITION_WEIGHT).toBe(1);
    });

    it("accepts minimum position weight (0.01 = 1%)", () => {
      const config = parse({ MAX_POSITION_WEIGHT: "0.01" });
      expect(config.MAX_POSITION_WEIGHT).toBe(0.01);
    });

    it("accepts zero commission rate", () => {
      const config = parse({ COMMISSION_RATE: "0" });
      expect(config.COMMISSION_RATE).toBe(0);
    });

    it("accepts max commission rate", () => {
      const config = parse({ COMMISSION_RATE: "0.05" });
      expect(config.COMMISSION_RATE).toBe(0.05);
    });

    it("accepts zero slippage", () => {
      const config = parse({ SLIPPAGE_BPS: "0" });
      expect(config.SLIPPAGE_BPS).toBe(0);
    });

    it("accepts max slippage", () => {
      const config = parse({ SLIPPAGE_BPS: "500" });
      expect(config.SLIPPAGE_BPS).toBe(500);
    });

    it("accepts minimum MARKET_TICK_MS (250ms)", () => {
      const config = parse({ MARKET_TICK_MS: "250" });
      expect(config.MARKET_TICK_MS).toBe(250);
    });

    it("accepts minimum MARKET_DATA_TIMEOUT_MS (1000ms)", () => {
      const config = parse({ MARKET_DATA_TIMEOUT_MS: "1000" });
      expect(config.MARKET_DATA_TIMEOUT_MS).toBe(1000);
    });

    it("accepts min circuit breaker values", () => {
      const config = parse({
        CIRCUIT_MAX_CONSECUTIVE_LOSSES: "1",
        CIRCUIT_MAX_DAILY_DRAWDOWN: "0.01",
        CIRCUIT_COOLDOWN_MINUTES: "5",
        CIRCUIT_RECOVERY_MINUTES: "0",
      });
      expect(config.CIRCUIT_MAX_CONSECUTIVE_LOSSES).toBe(1);
      expect(config.CIRCUIT_MAX_DAILY_DRAWDOWN).toBe(0.01);
      expect(config.CIRCUIT_COOLDOWN_MINUTES).toBe(5);
      expect(config.CIRCUIT_RECOVERY_MINUTES).toBe(0);
    });

    it("accepts max circuit breaker values", () => {
      const config = parse({
        CIRCUIT_MAX_CONSECUTIVE_LOSSES: "50",
        CIRCUIT_MAX_DAILY_DRAWDOWN: "0.5",
        CIRCUIT_COOLDOWN_MINUTES: "480",
        CIRCUIT_RECOVERY_MINUTES: "120",
      });
      expect(config.CIRCUIT_MAX_CONSECUTIVE_LOSSES).toBe(50);
      expect(config.CIRCUIT_MAX_DAILY_DRAWDOWN).toBe(0.5);
      expect(config.CIRCUIT_COOLDOWN_MINUTES).toBe(480);
      expect(config.CIRCUIT_RECOVERY_MINUTES).toBe(120);
    });

    it("accepts max drawdown reduction factor at boundaries", () => {
      expect(parse({ MAX_DRAWDOWN_REDUCTION_FACTOR: "0.1" }).MAX_DRAWDOWN_REDUCTION_FACTOR).toBe(0.1);
      expect(parse({ MAX_DRAWDOWN_REDUCTION_FACTOR: "1.0" }).MAX_DRAWDOWN_REDUCTION_FACTOR).toBe(1.0);
    });

    it("accepts zero min commission", () => {
      expect(parse({ MIN_COMMISSION: "0" }).MIN_COMMISSION).toBe(0);
    });
  });

  describe("validation errors", () => {
    it("rejects negative API_PORT", () => {
      expect(() => parse({ API_PORT: "-1" })).toThrow();
    });

    it("rejects zero API_PORT", () => {
      expect(() => parse({ API_PORT: "0" })).toThrow();
    });

    it("rejects invalid MARKET_MODE", () => {
      expect(() => parse({ MARKET_MODE: "production" })).toThrow();
    });

    it("rejects invalid MARKET_DATA_PROVIDER", () => {
      expect(() => parse({ MARKET_DATA_PROVIDER: "bloomberg" })).toThrow();
    });

    it("rejects invalid STORE_BACKEND", () => {
      expect(() => parse({ STORE_BACKEND: "postgres" })).toThrow();
    });

    it("rejects MAX_POSITION_WEIGHT > 1", () => {
      expect(() => parse({ MAX_POSITION_WEIGHT: "1.5" })).toThrow();
    });

    it("rejects MAX_POSITION_WEIGHT < 0.01", () => {
      expect(() => parse({ MAX_POSITION_WEIGHT: "0.001" })).toThrow();
    });

    it("rejects COMMISSION_RATE > 0.05", () => {
      expect(() => parse({ COMMISSION_RATE: "0.1" })).toThrow();
    });

    it("rejects negative COMMISSION_RATE", () => {
      expect(() => parse({ COMMISSION_RATE: "-0.01" })).toThrow();
    });

    it("rejects SLIPPAGE_BPS > 500", () => {
      expect(() => parse({ SLIPPAGE_BPS: "600" })).toThrow();
    });

    it("rejects negative TRADING_STARTING_CASH", () => {
      expect(() => parse({ TRADING_STARTING_CASH: "-1000" })).toThrow();
    });

    it("rejects zero TRADING_STARTING_CASH", () => {
      expect(() => parse({ TRADING_STARTING_CASH: "0" })).toThrow();
    });

    it("rejects MARKET_TICK_MS below 250", () => {
      expect(() => parse({ MARKET_TICK_MS: "100" })).toThrow();
    });

    it("rejects MARKET_DATA_TIMEOUT_MS below 1000", () => {
      expect(() => parse({ MARKET_DATA_TIMEOUT_MS: "500" })).toThrow();
    });

    it("rejects CIRCUIT_MAX_CONSECUTIVE_LOSSES > 50", () => {
      expect(() => parse({ CIRCUIT_MAX_CONSECUTIVE_LOSSES: "100" })).toThrow();
    });

    it("rejects CIRCUIT_MAX_CONSECUTIVE_LOSSES < 1", () => {
      expect(() => parse({ CIRCUIT_MAX_CONSECUTIVE_LOSSES: "0" })).toThrow();
    });

    it("rejects CIRCUIT_MAX_DAILY_DRAWDOWN > 0.5", () => {
      expect(() => parse({ CIRCUIT_MAX_DAILY_DRAWDOWN: "0.6" })).toThrow();
    });

    it("rejects CIRCUIT_COOLDOWN_MINUTES < 5", () => {
      expect(() => parse({ CIRCUIT_COOLDOWN_MINUTES: "1" })).toThrow();
    });

    it("rejects invalid WEB_ORIGIN (not a URL)", () => {
      expect(() => parse({ WEB_ORIGIN: "not-a-url" })).toThrow();
    });

    it("rejects invalid AKSHARE_BRIDGE_URL", () => {
      expect(() => parse({ AKSHARE_BRIDGE_URL: "not-a-url" })).toThrow();
    });
  });

  describe("environment variable coercion", () => {
    it("coerces string numbers to int for API_PORT", () => {
      const config = parse({ API_PORT: "8080" });
      expect(typeof config.API_PORT).toBe("number");
      expect(config.API_PORT).toBe(8080);
    });

    it("coerces string numbers to float for COMMISSION_RATE", () => {
      const config = parse({ COMMISSION_RATE: "0.0005" });
      expect(typeof config.COMMISSION_RATE).toBe("number");
      expect(config.COMMISSION_RATE).toBe(0.0005);
    });

    it("coerces boolean strings to actual booleans", () => {
      const trueConfig = parse({ REAL_TRADING_ENABLED: "true" });
      expect(typeof trueConfig.REAL_TRADING_ENABLED).toBe("boolean");
      expect(trueConfig.REAL_TRADING_ENABLED).toBe(true);

      const falseConfig = parse({ REAL_TRADING_ENABLED: "false" });
      expect(falseConfig.REAL_TRADING_ENABLED).toBe(false);
    });

    it("coerces MARKET_SYMBOLS single symbol to string", () => {
      const config = parse({ MARKET_SYMBOLS: "600519" });
      expect(typeof config.MARKET_SYMBOLS).toBe("string");
      expect(config.MARKET_SYMBOLS).toBe("600519");
    });
  });

  describe("exported getConfig", () => {
    it("getConfig is a function", async () => {
      // Dynamic import to test the real getConfig
      const { getConfig } = await import("./config");
      expect(typeof getConfig).toBe("function");
    });

    it("getConfig returns an object with expected shape", async () => {
      const { getConfig } = await import("./config");
      const config = getConfig();
      expect(typeof config).toBe("object");
      expect(typeof config.API_HOST).toBe("string");
      expect(typeof config.API_PORT).toBe("number");
      expect(typeof config.MARKET_MODE).toBe("string");
      expect(typeof config.REAL_TRADING_ENABLED).toBe("boolean");
    });
  });
});
