import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseFrozenEntryVolumeContract } from "./frozenEntryVolumeContract";

const input = Buffer.from('{"frozen":"history"}\n');
const declaration = {
  inputSha256: createHash("sha256").update(input).digest("hex"),
  source: "eastmoney-stock-history", volumeUnit: "lots", evidence: "Verified native lots in this frozen input.",
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("offline frozen entry volume declaration", () => {
  it.each(["lots", "shares"])("binds explicit %s to exact input bytes and preserves declaration evidence", volumeUnit => {
    const raw = bytes({ ...declaration, volumeUnit });
    expect(parseFrozenEntryVolumeContract(input, raw)).toEqual({ ...declaration, volumeUnit,
      contractSha256: createHash("sha256").update(raw).digest("hex") });
    expect(input.toString()).toBe('{"frozen":"history"}\n');
  });
  it("rejects even whitespace changes in the frozen data", () => {
    expect(() => parseFrozenEntryVolumeContract(Buffer.concat([input, Buffer.from(" ")]), bytes(declaration))).toThrow(/SHA/);
  });
  it.each([{}, { ...declaration, inputSha256: "bad" }, { ...declaration, inputSha256: "0".repeat(64) },
    { ...declaration, source: "tencent-stock-history" }, { ...declaration, volumeUnit: undefined },
    { ...declaration, volumeUnit: "unknown" }, { ...declaration, evidence: "" },
    { ...declaration, run: "execute instructions" }])("rejects incomplete, mismatched or unsupported declaration %#", value => {
    expect(() => parseFrozenEntryVolumeContract(input, bytes(value))).toThrow();
  });
  it.each([Buffer.alloc(0), Buffer.alloc(4097, " "), Buffer.from("not JSON")])("rejects invalid or unbounded declaration %#", raw => {
    expect(() => parseFrozenEntryVolumeContract(input, raw)).toThrow();
  });
  it("treats evidence as literal data without executing it", () => {
    const evidence = "$(throw Error('must remain literal'))";
    expect(parseFrozenEntryVolumeContract(input, bytes({ ...declaration, evidence })).evidence).toBe(evidence);
  });
});
