import { describe, expect, it } from "vitest";
import { ApiRequestError, shouldRetryQuery } from "./apiError";

describe("shouldRetryQuery", () => {
  it("retries network and 5xx failures at most twice", () => {
    expect(shouldRetryQuery(0, new ApiRequestError("offline", null, true))).toBe(true);
    expect(shouldRetryQuery(1, new ApiRequestError("server", 503, true))).toBe(true);
    expect(shouldRetryQuery(2, new ApiRequestError("server", 503, true))).toBe(false);
  });

  it("does not retry authentication, other 4xx, or malformed responses", () => {
    expect(shouldRetryQuery(0, new ApiRequestError("auth", 401, false))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError("bad request", 400, false))).toBe(false);
    expect(shouldRetryQuery(0, new Error("invalid JSON"))).toBe(false);
  });
});
