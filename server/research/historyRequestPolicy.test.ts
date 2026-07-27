import { describe, expect, it } from "vitest";

import { historyBridgeTimeoutMs } from "./historyRequestPolicy.js";

describe("historyBridgeTimeoutMs", () => {
  it("keeps history bridge waits within a bounded reliability window", () => {
    expect(historyBridgeTimeoutMs(15_000)).toBe(30_000);
    expect(historyBridgeTimeoutMs(1_000)).toBe(8_000);
    expect(historyBridgeTimeoutMs(300_000)).toBe(30_000);
  });
});
