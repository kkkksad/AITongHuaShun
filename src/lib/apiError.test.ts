import { describe, expect, it } from "vitest";
import { ApiRequestError, shouldRetryQuery } from "./apiError";

describe("shouldRetryQuery", () => {
  it("只重试网络错误和服务端错误且最多两次", () => {
    const networkError = new ApiRequestError("网络错误", null, true);
    const serverError = new ApiRequestError("服务端错误", 503, true);

    expect(shouldRetryQuery(0, networkError)).toBe(true);
    expect(shouldRetryQuery(1, serverError)).toBe(true);
    expect(shouldRetryQuery(2, networkError)).toBe(false);
  });

  it("不重试客户端错误、认证错误和未知错误", () => {
    expect(shouldRetryQuery(0, new ApiRequestError("参数错误", 400, false))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError("认证失败", 401, false))).toBe(false);
    expect(shouldRetryQuery(0, new Error("未知错误"))).toBe(false);
  });
});
