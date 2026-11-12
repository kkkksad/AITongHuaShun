import { createHash } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.literal("eastmoney-stock-history"),
  volumeUnit: z.enum(["lots", "shares"]),
  evidence: z.string().trim().min(1).max(2000),
}).strict();
export type FrozenDailyVolumeUnit = z.infer<typeof schema>["volumeUnit"];

/** Offline declaration binds a human-verified unit to bytes, not just a provider name. */
export function parseFrozenEntryVolumeContract(input: Uint8Array, declaration: Uint8Array) {
  if (declaration.byteLength === 0 || declaration.byteLength > 4096) throw Error("Invalid volume declaration size");
  const contract = schema.parse(JSON.parse(Buffer.from(declaration).toString("utf8").replace(/^\uFEFF/, "")));
  if (createHash("sha256").update(input).digest("hex") !== contract.inputSha256) {
    throw Error("Frozen input SHA does not match volume declaration");
  }
  return Object.freeze({ ...contract, contractSha256: createHash("sha256").update(declaration).digest("hex") });
}
