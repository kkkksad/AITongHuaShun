/** Bounded audit evidence; raw provider errors may contain URLs or credentials. */
const ISSUE_LABELS = {
  "provider-contract": "历史接口参数与供应商SDK不兼容。",
  "provider-timeout": "历史研究来源或桥接请求超时。",
  "history-warming": "部分历史序列仍在后台预热。",
  "history-queue-full": "历史请求队列已满，部分序列等待后续读取。",
  "sector-history-insufficient": "具备足够日线的板块不足两个。",
  "stock-history-insufficient": "缺少具备足够历史日线的个股。",
  "provider-warning": "研究来源存在未分类或未展开的警告，原始错误未写入交易审计。",
} as const;

type ResearchInputIssue = keyof typeof ISSUE_LABELS;

export interface ResearchInputDiagnostics {
  sectorCount: number;
  stockCount: number;
  usableStockCount: number;
  issues: ResearchInputIssue[];
}

export function buildResearchInputDiagnostics(input: {
  sectorOutlooks: readonly unknown[];
  stockRegimes: ReadonlyArray<{ regime: string }>;
  warnings: readonly string[];
}): ResearchInputDiagnostics {
  const sectorCount = input.sectorOutlooks.length;
  const usableStockCount = input.stockRegimes.filter(
    (stock) => stock.regime !== "insufficient-data",
  ).length;
  const issues: ResearchInputIssue[] = [];
  const classified = new Set<ResearchInputIssue>();
  let hasUnexpandedWarning = input.warnings.length > 8;
  for (const raw of input.warnings.slice(0, 8)) {
    if (raw.length > 2_000) hasUnexpandedWarning = true;
    const warning = raw.slice(0, 2_000);
    const contract = /unexpected keyword argument|unexpected argument|不支持.*参数/i.test(warning);
    const timeout = !contract && /超时|\btimeout\b|\btimed out\b/i.test(warning);
    const warming = /预热|冷启动|warming/i.test(warning);
    const queueFull = /队列上限|queue.*(?:full|limit)/i.test(warning);
    if (contract) classified.add("provider-contract");
    if (timeout) classified.add("provider-timeout");
    if (warming) classified.add("history-warming");
    if (queueFull) classified.add("history-queue-full");
    const coverageExplainsWarning =
      (sectorCount === 0 && warning.trim() === "没有板块具备至少 61 根有效日线。") ||
      (usableStockCount === 0 && warning.trim() === "没有候选股票具备至少 61 根有效历史日线。");
    if (!contract && !timeout && !warming && !queueFull && !coverageExplainsWarning) {
      hasUnexpandedWarning = true;
    }
  }
  for (const issue of ["provider-contract", "provider-timeout", "history-warming", "history-queue-full"] as const) {
    if (classified.has(issue)) issues.push(issue);
  }
  if (sectorCount < 2) issues.push("sector-history-insufficient");
  if (usableStockCount === 0) issues.push("stock-history-insufficient");
  const boundedIssues = hasUnexpandedWarning
    ? [...issues.slice(0, 3), "provider-warning" as const]
    : issues.slice(0, 4);
  return { sectorCount, stockCount: input.stockRegimes.length, usableStockCount, issues: boundedIssues };
}

export function describeResearchInputDiagnostics(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  const validCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 1_000;
  if (!validCount(data.sectorCount) || !validCount(data.stockCount) ||
    !validCount(data.usableStockCount) || data.usableStockCount > data.stockCount ||
    !Array.isArray(data.issues)) return [];
  const messages = [...new Set(data.issues.slice(0, 4).flatMap((issue: unknown) =>
    typeof issue === "string" && Object.hasOwn(ISSUE_LABELS, issue)
      ? [ISSUE_LABELS[issue as ResearchInputIssue]] : [],
  ))];
  return [
    `历史覆盖：${data.sectorCount} 个板块，${data.usableStockCount}/${data.stockCount} 只个股具备足够日线。`,
    ...messages,
  ];
}
