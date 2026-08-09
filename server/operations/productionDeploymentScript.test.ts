import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production deployment script", () => {
  it("validates an uploaded archive before replacing the current source", () => {
    const script = readFileSync(
      resolve(process.cwd(), "deploy/update-server.sh"),
      "utf8",
    );

    const extraction = script.indexOf('tar -xzf "${archive}" -C "${SOURCE_STAGING}"');
    const sourceRemoval = script.indexOf('find "${ROOT}" -mindepth 1 -maxdepth 1');

    expect(extraction).toBeGreaterThan(-1);
    expect(sourceRemoval).toBeGreaterThan(extraction);
    expect(script).toContain('Release archive is missing ${required}.');
    expect(script).toContain('cp -a "${SOURCE_STAGING}/." "${ROOT}/"');
  });
});
