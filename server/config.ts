import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env.local", override: false });
loadEnv({ path: ".env", override: false });

const envSchema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
  MARKET_MODE: z.enum(["mock", "paper", "live"]).default("mock"),
  MARKET_TICK_MS: z.coerce.number().int().min(250).default(1000),
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
});

export type ServerConfig = ReturnType<typeof getConfig>;

export function getConfig() {
  return envSchema.parse(process.env);
}
