import { createHash } from "node:crypto";
import type { MarketSnapshot } from "../../shared/trading";
import type { TradingSystem } from "../system";
import { ResearchResultCache } from "./researchResultCache";
import {
  buildStrategyLeaderboard,
  type StrategyLeaderboardReport,
} from "./strategyLeaderboard";

const LEADERBOARD_TTL_MS = 30_000;
const leaderboardCaches = new WeakMap<TradingSystem, ResearchResultCache<StrategyLeaderboardReport>>();

/** Reuse only identical read-only research inputs, never account or order state. */
export function buildCachedStrategyLeaderboard(input: {
  system: TradingSystem;
  snapshot: MarketSnapshot;
  bars?: number;
  seed?: number;
  requestedSymbols?: string[];
}): Promise<StrategyLeaderboardReport> {
  let cache = leaderboardCaches.get(input.system);
  if (!cache) {
    cache = new ResearchResultCache<StrategyLeaderboardReport>({ maxEntries: 8 });
    leaderboardCaches.set(input.system, cache);
  }
  const provider = input.system.marketDataProvider;
  const bars = input.bars ?? 90;
  const seed = input.seed ?? 42;
  const requestedSymbols = input.requestedSymbols ?? [];
  // Quote order, time, sequence and every serialized field can affect the
  // synthetic sample or quality report; do not reduce this to symbol identity.
  const key = createHash("sha256").update(JSON.stringify({
    snapshot: input.snapshot,
    provider,
    bars,
    seed,
    requestedSymbols,
  })).digest("hex");
  return cache.getOrCreate(key, LEADERBOARD_TTL_MS, () => buildStrategyLeaderboard(
    input.snapshot,
    provider,
    bars,
    seed,
    requestedSymbols,
  ));
}
