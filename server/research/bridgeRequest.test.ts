import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BridgeRequestError,
  bridgeErrorMessage,
  clearBridgeRequestCache,
  fetchBridgeJson,
} from "./bridgeRequest";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchBridgeJson", () => {
  afterEach(() => {
    clearBridgeRequestCache();
    vi.useRealTimers();
  });

  it("deduplicates identical in-flight reads and reuses them until the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T01:00:00.000Z"));
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse({ sequence: 1 }),
    );
    const input = {
      url: "http://127.0.0.1:8800/api/market/history?symbols=600519",
      timeoutMs: 1_000,
      cacheTtlMs: 5_000,
      fetchImpl,
    };

    const [first, second] = await Promise.all([
      fetchBridgeJson<{ sequence: number }>(input),
      fetchBridgeJson<{ sequence: number }>(input),
    ]);
    const third = await fetchBridgeJson<{ sequence: number }>(input);

    expect(first).toEqual({ sequence: 1 });
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_001);
    await fetchBridgeJson(input);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("evicts a rejected cached read so the next refresh can recover", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const input = {
      url: "http://127.0.0.1:8800/api/recoverable",
      timeoutMs: 1_000,
      cacheTtlMs: 5_000,
      fetchImpl,
    };

    await expect(fetchBridgeJson(input)).rejects.toMatchObject({ code: "network" });
    await expect(fetchBridgeJson(input)).resolves.toEqual({ recovered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps cached reads isolated by bearer-token scope", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ scope: "alpha" }))
      .mockResolvedValueOnce(jsonResponse({ scope: "beta" }));
    const input = {
      url: "http://127.0.0.1:8800/api/scoped-research",
      timeoutMs: 1_000,
      cacheTtlMs: 5_000,
      fetchImpl,
    };

    const alpha = await fetchBridgeJson({ ...input, token: "token-alpha" });
    const beta = await fetchBridgeJson({ ...input, token: "token-beta" });
    const alphaAgain = await fetchBridgeJson({ ...input, token: "token-alpha" });

    expect(alpha).toEqual({ scope: "alpha" });
    expect(beta).toEqual({ scope: "beta" });
    expect(alphaAgain).toBe(alpha);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns JSON and sends only the optional bearer token", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

    await expect(fetchBridgeJson<{ ok: boolean }>({
      url: "http://127.0.0.1:8800/api/health",
      token: "bridge-secret",
      timeoutMs: 1_000,
      fetchImpl,
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/api/health",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer bridge-secret",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps bounded HTTP detail without exposing arbitrary response fields", async () => {
    const detail = `  参数错误 ${"x".repeat(300)}  `;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      detail,
      token: "must-not-appear",
    }, 400));

    const error = await fetchBridgeJson({
      url: "http://127.0.0.1:8800/api/test?secret=query-value",
      timeoutMs: 1_000,
      fetchImpl,
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(BridgeRequestError);
    const requestError = error as BridgeRequestError;
    expect(requestError.code).toBe("http");
    expect(requestError.message).toMatch(/^行情桥返回 HTTP 400: 参数错误 /);
    expect(requestError.message.length).toBeLessThan(280);
    expect(requestError.message).not.toContain("must-not-appear");
    expect(requestError.message).not.toContain("query-value");
  });

  it("normalizes native fetch failures without leaking the raw message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const error = await fetchBridgeJson({
      url: "http://127.0.0.1:8800/api/test",
      timeoutMs: 1_000,
      fetchImpl,
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(BridgeRequestError);
    const requestError = error as BridgeRequestError;
    expect(requestError.code).toBe("network");
    expect(bridgeErrorMessage(requestError)).toBe("无法连接行情桥，请确认行情服务已启动");
    expect(bridgeErrorMessage(requestError)).not.toContain("fetch failed");
  });

  it("reports a bounded timeout and aborts the bridge request", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }));

    const request = fetchBridgeJson({
      url: "http://127.0.0.1:8800/api/test",
      timeoutMs: 250,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const assertion = expect(request).rejects.toMatchObject({
      code: "timeout",
      message: "连接行情桥超时（250ms）",
    });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("classifies invalid JSON as a response format error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }));

    await expect(fetchBridgeJson({
      url: "http://127.0.0.1:8800/api/test",
      timeoutMs: 1_000,
      fetchImpl,
    })).rejects.toMatchObject({
      code: "invalid-json",
      message: "行情桥返回了无法解析的 JSON",
    });
  });

  it("uses a safe generic message for unknown errors", () => {
    expect(bridgeErrorMessage(new Error("secret raw failure"))).toBe("行情桥请求失败");
  });
});
