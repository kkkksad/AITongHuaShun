import type { SectorSnapshot, SectorSnapshotResponse } from "./marketRegimeResearch";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function identity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Decode this research boundary only; shape validity does not prove source freshness. */
export function normalizeSectorSnapshotResponse(input: unknown): SectorSnapshotResponse {
  const upstreamWarning = record(input) && typeof input.warning === "string" ? input.warning : null;
  const warnings = upstreamWarning ? [upstreamWarning] : [];
  if (!record(input) || input.provider !== "akshare" || !identity(input.source) || !Array.isArray(input.sectors)) {
    warnings.push("行业快照校验：供应方、来源或行业列表无效，保留独立个股研究。");
    return { provider: "akshare", source: "unavailable", fetchedAt: "", sectors: [], warning: warnings.join(" ") };
  }
  const sectors: SectorSnapshot[] = [];
  let invalidSectors = 0, invalidOptionalFields = 0;
  for (const item of input.sectors) {
    if (!record(item) || !identity(item.symbol) || !identity(item.name) ||
      !finite(item.price) || item.price <= 0 || !finite(item.changePercent) || typeof item.updatedAt !== "string") {
      invalidSectors++; continue;
    }
    const optionalNumber = (key: string, valid: (value: number) => boolean = () => true): number | null => {
      const value = item[key];
      if (value === null || value === undefined) return null;
      if (finite(value) && valid(value)) return value;
      invalidOptionalFields++; return null;
    };
    let leaderName: string | null = null;
    if (item.leaderName !== null && item.leaderName !== undefined) {
      if (typeof item.leaderName === "string") leaderName = item.leaderName;
      else invalidOptionalFields++;
    }
    const nonnegative = (value: number) => value >= 0;
    const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
    sectors.push({ symbol: item.symbol, name: item.name, price: item.price, changePercent: item.changePercent,
      updatedAt: item.updatedAt, amount: optionalNumber("amount", nonnegative), turnover: optionalNumber("turnover", nonnegative),
      advancers: optionalNumber("advancers", count), decliners: optionalNumber("decliners", count), leaderName,
      leaderChangePercent: optionalNumber("leaderChangePercent"), mainNetInflow: optionalNumber("mainNetInflow") });
  }
  if (invalidSectors || invalidOptionalFields) warnings.push(
    `行业快照校验：排除 ${invalidSectors} 条无效行业记录，${invalidOptionalFields} 个无效可选字段保留为未知。`,
  );
  return { provider: "akshare", source: input.source, fetchedAt: typeof input.fetchedAt === "string" ? input.fetchedAt : "",
    sectors, warning: warnings.join(" ") || null };
}
