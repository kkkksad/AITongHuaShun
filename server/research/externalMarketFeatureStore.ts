import * as fs from "node:fs";
import * as path from "node:path";

export interface ExternalMarketFeatureRow {
  tradeDate: string;
  capturedAt: string;
  usOvernightReturn: number | null;
  japanOpenReturn: number | null;
  koreaOpenReturn: number | null;
  hongKongOpenReturn: number | null;
  btcOvernightReturn: number | null;
  ethOvernightReturn: number | null;
  hs300CloseReturn: number | null;
  sourceStatus: "complete" | "partial";
}

export type ExternalMarketFeatureUpdate = Pick<
  ExternalMarketFeatureRow,
  "tradeDate" | "capturedAt"
> & Partial<Omit<ExternalMarketFeatureRow, "tradeDate" | "capturedAt" | "sourceStatus">>;

interface ExternalMarketFeatureStoreOptions {
  filePath: string;
  maxRows: number;
  now?: () => Date;
}

const featureKeys = [
  "usOvernightReturn",
  "japanOpenReturn",
  "koreaOpenReturn",
  "hongKongOpenReturn",
  "btcOvernightReturn",
  "ethOvernightReturn",
  "hs300CloseReturn",
] as const;

function emptyRow(update: ExternalMarketFeatureUpdate): ExternalMarketFeatureRow {
  return {
    tradeDate: update.tradeDate,
    capturedAt: update.capturedAt,
    usOvernightReturn: null,
    japanOpenReturn: null,
    koreaOpenReturn: null,
    hongKongOpenReturn: null,
    btcOvernightReturn: null,
    ethOvernightReturn: null,
    hs300CloseReturn: null,
    sourceStatus: "partial",
  };
}

function rowStatus(row: ExternalMarketFeatureRow): "complete" | "partial" {
  return featureKeys.every((key) => row[key] !== null) ? "complete" : "partial";
}

function validateUpdate(update: ExternalMarketFeatureUpdate): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(update.tradeDate)) {
    throw new Error("External market feature tradeDate must use YYYY-MM-DD.");
  }
  if (!Number.isFinite(Date.parse(update.capturedAt))) {
    throw new Error("External market feature capturedAt must be an ISO timestamp.");
  }
  for (const key of featureKeys) {
    const value = update[key];
    if (value !== undefined && value !== null && !Number.isFinite(value)) {
      throw new Error(`External market feature ${key} must be finite or null.`);
    }
  }
}

function validatePersistedRows(value: unknown): ExternalMarketFeatureRow[] {
  if (!Array.isArray(value)) {
    throw new Error("External market feature file must contain an array.");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("External market feature row must be an object.");
    }
    const record = candidate as Record<string, unknown>;
    const update: ExternalMarketFeatureUpdate = {
      tradeDate: String(record.tradeDate ?? ""),
      capturedAt: String(record.capturedAt ?? ""),
    };
    for (const key of featureKeys) {
      const value = record[key];
      if (value === null || typeof value === "number") {
        update[key] = value;
      } else {
        throw new Error(`External market feature ${key} has an invalid type.`);
      }
    }
    validateUpdate(update);
    const row = { ...emptyRow(update), ...update } as ExternalMarketFeatureRow;
    row.sourceStatus = rowStatus(row);
    return row;
  });
}

function quarantineSuffix(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(".000", "");
}

export class ExternalMarketFeatureStore {
  private readonly filePath: string;
  private readonly maxRows: number;
  private readonly now: () => Date;
  private data: ExternalMarketFeatureRow[] = [];

  constructor(options: ExternalMarketFeatureStoreOptions) {
    if (!Number.isInteger(options.maxRows) || options.maxRows < 1 || options.maxRows > 5000) {
      throw new Error("External market feature maxRows must be an integer from 1 to 5000.");
    }
    this.filePath = path.resolve(options.filePath);
    this.maxRows = options.maxRows;
    this.now = options.now ?? (() => new Date());
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.load();
  }

  rows(): ExternalMarketFeatureRow[] {
    return this.data.map((row) => ({ ...row }));
  }

  upsert(update: ExternalMarketFeatureUpdate): ExternalMarketFeatureRow[] {
    validateUpdate(update);
    const existing = this.data.find((row) => row.tradeDate === update.tradeDate);
    const merged = {
      ...(existing ?? emptyRow(update)),
      ...update,
    } as ExternalMarketFeatureRow;
    merged.sourceStatus = rowStatus(merged);
    this.data = [
      ...this.data.filter((row) => row.tradeDate !== update.tradeDate),
      merged,
    ]
      .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
      .slice(-this.maxRows);
    this.persist();
    return this.rows();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.data = validatePersistedRows(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown,
      )
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
        .slice(-this.maxRows);
    } catch {
      const quarantinePath = `${this.filePath}.corrupt-${quarantineSuffix(this.now())}`;
      fs.renameSync(this.filePath, quarantinePath);
      this.data = [];
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
  }
}
