import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalMarketFeatureStore } from "./externalMarketFeatureStore";

const tempDirs: string[] = [];

function tempFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kairos-external-"));
  tempDirs.push(directory);
  return path.join(directory, "features.json");
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("ExternalMarketFeatureStore", () => {
  it("keeps only the newest bounded rows", () => {
    const store = new ExternalMarketFeatureStore({
      filePath: tempFile(),
      maxRows: 3,
    });
    for (const tradeDate of ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"]) {
      store.upsert({
        tradeDate,
        capturedAt: `${tradeDate}T01:20:00Z`,
        usOvernightReturn: 0.01,
      });
    }

    expect(store.rows().map((row) => row.tradeDate)).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("merges the close label into the same trade-date row", () => {
    const filePath = tempFile();
    const store = new ExternalMarketFeatureStore({ filePath, maxRows: 750 });
    store.upsert({
      tradeDate: "2026-07-17",
      capturedAt: "2026-07-17T01:20:00Z",
      usOvernightReturn: -0.012,
      japanOpenReturn: -0.008,
    });
    store.upsert({
      tradeDate: "2026-07-17",
      capturedAt: "2026-07-17T07:10:00Z",
      hs300CloseReturn: -0.006,
    });

    expect(store.rows()).toHaveLength(1);
    expect(store.rows()[0]).toMatchObject({
      usOvernightReturn: -0.012,
      japanOpenReturn: -0.008,
      hs300CloseReturn: -0.006,
      sourceStatus: "partial",
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toHaveLength(1);
  });

  it("quarantines malformed JSON without touching other data files", () => {
    const filePath = tempFile();
    fs.writeFileSync(filePath, "{broken", "utf8");

    const store = new ExternalMarketFeatureStore({
      filePath,
      maxRows: 750,
      now: () => new Date("2026-07-18T12:00:00Z"),
    });

    expect(store.rows()).toEqual([]);
    const directoryFiles = fs.readdirSync(path.dirname(filePath));
    expect(directoryFiles).toContain("features.json.corrupt-20260718T120000Z");
  });

  it("rejects invalid dates and non-finite feature values", () => {
    const store = new ExternalMarketFeatureStore({
      filePath: tempFile(),
      maxRows: 750,
    });

    expect(() => store.upsert({
      tradeDate: "2026/07/18",
      capturedAt: "2026-07-18T01:20:00Z",
    })).toThrow("tradeDate");
    expect(() => store.upsert({
      tradeDate: "2026-07-18",
      capturedAt: "2026-07-18T01:20:00Z",
      btcOvernightReturn: Number.NaN,
    })).toThrow("finite");
  });
});
