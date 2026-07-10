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
  /** 交易数据持久化后端: "memory" | "json" */
  STORE_BACKEND: z.enum(["memory", "json"]).default("memory"),
  /** JSON 存储目录（仅 STORE_BACKEND=json 时生效） */
  DATA_DIR: z.string().default("./data"),
  /** ── 增强风控配置 ── */
  /** 连续亏损次数触发熔断 */
  CIRCUIT_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).max(50).default(5),
  /** 日内最大回撤比例触发熔断 */
  CIRCUIT_MAX_DAILY_DRAWDOWN: z.coerce.number().min(0.01).max(0.5).default(0.08),
  /** 熔断冷却时间（分钟） */
  CIRCUIT_COOLDOWN_MINUTES: z.coerce.number().int().min(5).max(480).default(15),
  /** 恢复观察期（分钟） */
  CIRCUIT_RECOVERY_MINUTES: z.coerce.number().int().min(0).max(120).default(5),
  /** 是否启用动态仓位缩放 */
  DYNAMIC_POSITION_SCALING: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** 最大回撤时仓位缩减至原始权重的比例 */
  MAX_DRAWDOWN_REDUCTION_FACTOR: z.coerce.number().min(0.1).max(1.0).default(0.25),
});

export type ServerConfig = ReturnType<typeof getConfig>;

export function getConfig() {
  return envSchema.parse(process.env);
}
