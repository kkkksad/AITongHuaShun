import { describe, expect, it, vi } from "vitest";
import { WxPusherClient } from "./wxPusherClient";

const TEST_SPT = "SPT_testToken123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WxPusherClient", () => {
  it("posts a text message to the official simple-push endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 1000,
      msg: "processed",
      success: true,
    }));
    const client = new WxPusherClient({
      spt: TEST_SPT,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.send({
      summary: "KAIROS paper plan",
      content: "Simulation-only reminder",
    })).resolves.toEqual({ provider: "wxpusher", accepted: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wxpusher.zjiecode.com/api/send/message/simple-push");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      content: "Simulation-only reminder",
      summary: "KAIROS paper plan",
      contentType: 1,
      spt: TEST_SPT,
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects provider responses whose code is not 1000 without leaking the SPT", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 1001,
      msg: `invalid token ${TEST_SPT}`,
      success: false,
    }));
    const client = new WxPusherClient({
      spt: TEST_SPT,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await client.send({ summary: "test", content: "test" })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("provider code 1001");
    expect((error as Error).message).not.toContain(TEST_SPT);
  });

  it("reports HTTP failures without response bodies or credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      `upstream included ${TEST_SPT}`,
      { status: 503 },
    ));
    const client = new WxPusherClient({
      spt: TEST_SPT,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await client.send({ summary: "test", content: "test" })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toBe("WxPusher request failed with HTTP 503");
    expect((error as Error).message).not.toContain(TEST_SPT);
  });

  it("aborts requests that exceed the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: string, request: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      },
    ));
    const client = new WxPusherClient({
      spt: TEST_SPT,
      timeoutMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.send({ summary: "test", content: "test" }))
      .rejects.toThrow("WxPusher request timed out after 5 ms");
  });
});
