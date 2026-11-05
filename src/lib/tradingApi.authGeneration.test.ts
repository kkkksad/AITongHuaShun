// @vitest-environment node
import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest, authApiRequest, AUTH_EXPIRED_EVENT, login, logout,
  notifyAuthExpired, updatePaperStrategyProfile, verifyLogin,
} from "./tradingApi";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const authPayload = (name: string) => ({
  authenticated: true, csrfToken: `csrf-${name}`,
  user: { username: name, role: "admin" },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function withNativeServer(
  heldPath: string,
  status: number,
  run: (input: {
    bodyStarted: Promise<void>;
    finish: (payload: unknown) => Promise<void>;
    expired: ReturnType<typeof vi.fn>;
    currentToken: () => Promise<string | undefined>;
  }) => Promise<void>,
) {
  const eventTarget = new EventTarget();
  vi.stubGlobal("window", eventTarget);
  notifyAuthExpired();
  const expired = vi.fn();
  eventTarget.addEventListener(AUTH_EXPIRED_EVENT, expired);
  const held = deferred<ServerResponse>();
  const bodyStarted = deferred<void>();
  let hasHeld = false;
  let loginCount = 0;
  let latestToken: string | undefined;
  const server = createServer((request, response) => {
    if (request.url === heldPath && !hasHeld) {
      hasHeld = true;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write("{");
      held.resolve(response);
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/api/auth/login") {
      response.end(JSON.stringify(authPayload(++loginCount === 1 ? "A" : "B")));
    } else if (request.url === "/api/auth/session") {
      response.end(JSON.stringify(authPayload("B")));
    } else {
      latestToken = request.headers["x-csrf-token"] as string | undefined;
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing local port");
  const origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("VITE_API_BASE_URL", origin);
  const nativeText = Response.prototype.text;
  vi.spyOn(Response.prototype, "text").mockImplementation(function (this: Response) {
    if (this.url === origin + heldPath) bodyStarted.resolve();
    return nativeText.call(this);
  });
  try {
    await run({
      bodyStarted: bodyStarted.promise,
      finish: async (payload) => { (await held.promise).end(JSON.stringify(payload).slice(1)); },
      expired,
      currentToken: async () => {
        await authApiRequest("/api/probe/csrf", { method: "POST" });
        return latestToken;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe("authentication generation with native fetch and streamed response bodies", () => {
  it.each([
    { request: "get", renewal: "login" }, { request: "mutation", renewal: "login" },
    { request: "get", renewal: "verify" }, { request: "mutation", renewal: "verify" },
  ] as const)("keeps the new session after an old $request 401 completes following $renewal", async ({ request, renewal }) => {
    const path = request === "get" ? "/api/probe/old" : "/api/account/strategy-profile";
    await withNativeServer(path, 401, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const pending = request === "get" ? apiRequest(path) : updatePaperStrategyProfile("growth");
      const result = pending.catch((error: unknown) => error);
      await bodyStarted;
      if (renewal === "login") await login("B", "fixture");
      else await verifyLogin();
      expect(await currentToken()).toBe("csrf-B");
      await finish({ message: "old request unauthorized" });
      expect(await result).toMatchObject({ status: 401, message: "old request unauthorized" });
      expect(expired).not.toHaveBeenCalled();
      expect(await currentToken()).toBe("csrf-B");
    });
  });

  it("still expires the current session on a current protected 401", async () => {
    await withNativeServer("/api/probe/current", 401, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const result = apiRequest("/api/probe/current").catch((error: unknown) => error);
      await bodyStarted;
      await finish({ message: "current request unauthorized" });
      expect(await result).toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledTimes(1);
      expect(await currentToken()).toBeUndefined();
    });
  });

  it("retains native cancellation while an old 401 body is being read", async () => {
    await withNativeServer("/api/probe/abort", 401, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const controller = new AbortController();
      const result = apiRequest("/api/probe/abort", { signal: controller.signal }).catch((error: unknown) => error);
      await bodyStarted;
      await login("B", "fixture");
      controller.abort();
      await finish({ message: "cancelled old request" });
      expect(await result).toMatchObject({ name: "AbortError" });
      expect(expired).not.toHaveBeenCalled();
      expect(await currentToken()).toBe("csrf-B");
    });
  });

  it.each([200, 401, 500])("does not let an old logout's HTTP %s cleanup clear a new login token", async (status) => {
    await withNativeServer("/api/auth/logout", status, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const result = logout().then(() => undefined, (error: unknown) => error);
      await bodyStarted;
      await login("B", "fixture");
      await finish({ message: "old logout completed" });
      const error = await result;
      if (status !== 200) expect(error).toMatchObject({ status });
      else expect(error).toBeUndefined();
      expect(expired).not.toHaveBeenCalled();
      expect(await currentToken()).toBe("csrf-B");
    });
  });

  it.each([200, 401, 500])("still clears the current logout token after HTTP %s", async (status) => {
    await withNativeServer("/api/auth/logout", status, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const result = logout().catch((error: unknown) => error);
      await bodyStarted;
      await finish({ message: "logout completed" });
      await result;
      expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(await currentToken()).toBeUndefined();
    });
  });

  it("does not let an old verification success replace a new login's token", async () => {
    await withNativeServer("/api/auth/session", 200, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const verification = verifyLogin();
      await bodyStarted;
      await login("B", "fixture");
      await finish(authPayload("A"));
      expect(await verification).toMatchObject({ csrfToken: "csrf-A", user: { username: "A" } });
      expect(expired).not.toHaveBeenCalled();
      expect(await currentToken()).toBe("csrf-B");
    });
  });

  it("does not restore an old verification token after explicit expiry", async () => {
    await withNativeServer("/api/auth/session", 200, async ({ bodyStarted, finish, expired, currentToken }) => {
      await login("A", "fixture");
      const verification = verifyLogin();
      await bodyStarted;
      notifyAuthExpired();
      await finish(authPayload("A"));
      await verification;
      expect(expired).toHaveBeenCalledTimes(1);
      expect(await currentToken()).toBeUndefined();
    });
  });

  it.each(["login", "session"] as const)("keeps the auth $path endpoint's own 401 separate from protected-request expiry", async (path) => {
    await withNativeServer(`/api/auth/${path}`, 401, async ({ bodyStarted, finish, expired, currentToken }) => {
      const pending = path === "login" ? login("A", "fixture") : verifyLogin();
      const result = pending.catch((error: unknown) => error);
      await bodyStarted;
      await finish({ message: "authentication rejected" });
      expect(await result).toMatchObject({ status: 401 });
      expect(expired).not.toHaveBeenCalled();
      expect(await currentToken()).toBeUndefined();
    });
  });
});
