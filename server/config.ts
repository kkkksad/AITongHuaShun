import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

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
  AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_USERNAME: z.string().default(""),
  AUTH_PASSWORD: z.string().default(""),
  JWT_SECRET: z.string().default(""),
  AUTH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
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
  TRADING_SEED_PORTFOLIO: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
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
  PAPER_AUTO_EXECUTION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PAPER_AUTO_EXECUTION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(60_000),
  PAPER_AUTO_EXECUTION_TRADE_WINDOW_ONLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  PAPER_AUTO_EXECUTION_MAX_ORDERS_PER_RUN: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(1),
  PAPER_AUTO_EXECUTION_MAX_DAILY_ORDERS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(4),
  PAPER_AUTO_EXECUTION_CASH_RESERVE_RATIO: z.coerce
    .number()
    .min(0)
    .max(0.5)
    .default(0.1),
  STORE_BACKEND: z.enum(["memory", "json"]).default("memory"),
  DATA_DIR: z.string().default("./data"),
  TRADING_HISTORY_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(7),
  RESEARCH_DATA_DIR: z.string().default("./data/research"),
  RESEARCH_MAX_SYMBOLS: z.coerce.number().int().min(10).max(5000).default(200),
  RESEARCH_HISTORY_DAYS: z.coerce.number().int().min(60).max(3650).default(756),
  RESEARCH_MAX_CACHE_MB: z.coerce.number().int().min(64).max(20_000).default(512),
  RESEARCH_STORE_RAW_NEWS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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

export type ServerConfig = ReturnType<typeof getConfig>;

export function getConfig() {
  const config = envSchema.parse(process.env);
  if (config.AUTH_ENABLED) {
    if (!config.AUTH_USERNAME.trim()) {
      throw new Error("AUTH_ENABLED=true requires AUTH_USERNAME");
    }
    if (config.AUTH_PASSWORD.length < 12) {
      throw new Error("AUTH_ENABLED=true requires AUTH_PASSWORD with at least 12 characters");
    }
    if (config.JWT_SECRET.length < 32) {
      throw new Error("AUTH_ENABLED=true requires JWT_SECRET with at least 32 characters");
    }
  }
  return config;
}
