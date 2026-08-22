import { describe, expect, it } from "vitest";
import { isTrustedWebSocketOrigin } from "./webOrigin";

const configuredOrigin = "https://124.221.165.45";

describe("trusted WebSocket origin", () => {
  it("accepts the configured origin", () => {
    expect(isTrustedWebSocketOrigin({
      headers: { origin: configuredOrigin },
      configuredOrigin,
      trustProxy: true,
    })).toBe(true);
  });

  it("accepts the public host supplied by a trusted HTTPS proxy", () => {
    expect(isTrustedWebSocketOrigin({
      headers: {
        origin: "https://kairosq.cn",
        host: "kairosq.cn",
        "x-forwarded-proto": "https",
      },
      configuredOrigin,
      trustProxy: true,
    })).toBe(true);
  });

  it("does not derive an extra origin when the proxy is untrusted", () => {
    expect(isTrustedWebSocketOrigin({
      headers: {
        origin: "https://kairosq.cn",
        host: "kairosq.cn",
        "x-forwarded-proto": "https",
      },
      configuredOrigin,
      trustProxy: false,
    })).toBe(false);
  });

  it("rejects a different host and malformed origins", () => {
    expect(isTrustedWebSocketOrigin({
      headers: {
        origin: "https://attacker.example",
        host: "kairosq.cn",
        "x-forwarded-proto": "https",
      },
      configuredOrigin,
      trustProxy: true,
    })).toBe(false);
    expect(isTrustedWebSocketOrigin({
      headers: { origin: "null", host: "kairosq.cn" },
      protocol: "https",
      configuredOrigin,
      trustProxy: true,
    })).toBe(false);
  });
});
