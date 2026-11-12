import { describe, expect, it } from "vitest";
import { buildStockHistoryCoverage, copyStockHistoryCoverage, type StockHistoryCoverage } from "./stockHistoryCoverage";

const evidence = (): StockHistoryCoverage => ({
  scope: "regime-stock-history" as const, asOf: "2026-11-12T06:00:00.000Z",
  selectedSymbols: ["600010", "600011", "600012"],
  returnedSymbols: ["600010", "600011"], acceptedSymbols: ["600011"], usableSymbols: [],
});

describe("stock history identity boundary", () => {
  it.each([
    undefined, null, {}, { ...evidence(), scope: "other" },
    { ...evidence(), asOf: "2026-02-30T06:00:00.000Z" },
    { ...evidence(), asOf: "2026-11-12T06:00:00Z" },
    { ...evidence(), selectedSymbols: ["600010", "600010"] },
    { ...evidence(), selectedSymbols: Array(13).fill("600010") },
    { ...evidence(), selectedSymbols: ["https://provider.test/?token=SECRET"] },
    { ...evidence(), returnedSymbols: ["600013"] },
    { ...evidence(), returnedSymbols: ["600011", "600010"] },
    { ...evidence(), acceptedSymbols: ["600012"] },
    { ...evidence(), usableSymbols: ["600010"] },
    { ...evidence(), usableSymbols: null },
  ])("keeps invalid or legacy identity evidence unknown: %j", value => {
    expect(copyStockHistoryCoverage(value)).toBeUndefined();
  });

  it("whitelists fields and copies every collection before the audit can retain it", () => {
    const input = { ...evidence(), token: "SECRET", rawResponse: { url: "https://provider.test" } };
    const output = copyStockHistoryCoverage(input)!;
    expect(output).toEqual(evidence());
    input.selectedSymbols[0] = "000001";
    input.returnedSymbols.length = 0;
    input.acceptedSymbols.push("600012");
    input.usableSymbols.push("600011");
    expect(output).toEqual(evidence());
    output.selectedSymbols[1] = "000002";
    expect(input.selectedSymbols[1]).toBe("600011");
    expect(JSON.stringify(output)).not.toMatch(/SECRET|provider\.test|rawResponse/);
  });

  it("preserves an observed empty universe and its original cutoff", () => {
    const value = buildStockHistoryCoverage({ asOf: new Date(evidence().asOf), selectedSymbols: [],
      stockHistory: { provider: "akshare", series: [{ symbol: "600010" }] }, acceptedSymbols: [], usableSymbols: [] });
    expect(value).toEqual({ scope: "regime-stock-history", asOf: evidence().asOf,
      selectedSymbols: [], returnedSymbols: [], acceptedSymbols: [], usableSymbols: [] });
  });

  it("accepts twelve unique selected identities without expanding to response outsiders", () => {
    const selectedSymbols = Array.from({ length: 12 }, (_, i) => `6000${String(i).padStart(2, "0")}`);
    const value = buildStockHistoryCoverage({ asOf: new Date(evidence().asOf), selectedSymbols,
      stockHistory: { provider: "akshare", series: [...selectedSymbols.map(symbol => ({ symbol })), { symbol: "000001" }] },
      acceptedSymbols: selectedSymbols, usableSymbols: selectedSymbols.slice(1) });
    expect(value?.selectedSymbols).toEqual(selectedSymbols);
    expect(value?.returnedSymbols).toEqual(selectedSymbols);
    expect(value?.usableSymbols).toEqual(selectedSymbols.slice(1));
  });
});
