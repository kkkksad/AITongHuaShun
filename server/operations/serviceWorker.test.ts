import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const origin = "https://kairos.example";
const currentCache = "kairos-v3";

interface WorkerRequest { url: string; method: string; mode: string }
type FetchInput = WorkerRequest | string;
type WorkerEvent = {
  request?: WorkerRequest;
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
};

function response(body: string, contentType = "text/html", status = 200, type = "basic") {
  const result = new Response(body, { status, headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  Object.defineProperty(result, "type", { value: type });
  return result;
}

function json(body: unknown, status = 200) {
  return response(JSON.stringify(body), "application/json", status);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createWorker(options: {
  network?: (request: FetchInput) => Response | Promise<Response>;
  deletionGate?: Promise<void>;
} = {}) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const cacheCalls: string[] = [];
  const lifecycle: string[] = [];
  const key = (request: FetchInput) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const fetch = vi.fn(async (request: FetchInput) => options.network
    ? options.network(request)
    : response(`asset:${key(request)}`, key(request).endsWith(".json") ? "application/json" : "text/html"));
  function store(name: string) {
    let items = stores.get(name);
    if (!items) { items = new Map(); stores.set(name, items); }
    return items;
  }
  const caches = {
    open: vi.fn(async (name: string) => {
      cacheCalls.push(`open:${name}`);
      return {
        match: async (request: FetchInput) => {
          cacheCalls.push(`match:${name}`);
          return store(name).get(key(request))?.clone();
        },
        put: async (request: FetchInput, value: Response) => {
          cacheCalls.push(`put:${name}`);
          store(name).set(key(request), value.clone());
        },
        addAll: async (paths: string[]) => {
          const results = await Promise.all(paths.map(async (path) => ({ path, value: await fetch(path) })));
          if (results.some(({ value }) => !value.ok)) throw new Error("precache failed");
          results.forEach(({ path, value }) => { store(name).set(key(path), value.clone()); });
        },
      };
    }),
    match: vi.fn(async (request: FetchInput) => {
      cacheCalls.push("match:all");
      for (const items of stores.values()) {
        const cached = items.get(key(request));
        if (cached) return cached.clone();
      }
      return undefined;
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => {
      if (options.deletionGate) await options.deletionGate;
      lifecycle.push(`delete:${name}`);
      return stores.delete(name);
    }),
  };
  const skipWaiting = vi.fn(async () => { lifecycle.push("skip"); });
  const claim = vi.fn(async () => { lifecycle.push("claim"); });
  runInNewContext(source, {
    self: {
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => listeners.set(name, handler),
      location: { origin }, skipWaiting, clients: { claim },
    }, caches, fetch, URL, Response,
  });
  function dispatch(name: string, request?: WorkerRequest) {
    let result: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.get(name)!({ request, respondWith: (value) => { result = value; }, waitUntil: (value) => { waits.push(value); } });
    return { intercepted: result !== undefined, result, waits };
  }
  async function request(path: string, { method = "GET", mode = "cors" } = {}) {
    const input = { url: new URL(path, origin).href, method, mode };
    const event = dispatch("fetch", input);
    const result = await (event.result ?? fetch(input));
    await Promise.all(event.waits);
    await Promise.resolve();
    return { response: result, intercepted: event.intercepted };
  }
  async function lifecycleEvent(name: string) {
    const event = dispatch(name);
    await Promise.all(event.waits);
  }
  return { request, dispatch, lifecycleEvent, fetch, caches, cacheCalls, lifecycle, stores, store, skipWaiting, claim, key };
}

describe("production service worker cache boundary", () => {
  it("reads fresh account state on every no-store API request", async () => {
    let cash = 20_000;
    const worker = createWorker({ network: () => json({ cash }) });
    expect(await (await worker.request("/api/account")).response.json()).toEqual({ cash: 20_000 });
    cash = 8_000;
    expect(await (await worker.request("/api/account")).response.json()).toEqual({ cash: 8_000 });
    expect(worker.fetch).toHaveBeenCalledTimes(2);
    expect(worker.cacheCalls).toEqual([]);
  });

  it("passes an expired session 401 through after an earlier authenticated response", async () => {
    let authenticated = true;
    const worker = createWorker({ network: () => authenticated ? json({ authenticated: true }) : json({ message: "unauthorized" }, 401) });
    expect((await worker.request("/api/auth/session")).response.status).toBe(200);
    authenticated = false;
    expect((await worker.request("/api/auth/session")).response.status).toBe(401);
    expect(worker.cacheCalls).toEqual([]);
  });

  it("refreshes orders after a successful mutation", async () => {
    let orders: string[] = [];
    const worker = createWorker({ network: (request) => {
      if (typeof request !== "string" && request.method === "POST") { orders = ["paper-order"]; return json({ ok: true }); }
      return json(orders);
    } });
    expect(await (await worker.request("/api/orders?limit=50")).response.json()).toEqual([]);
    await worker.request("/api/orders", { method: "POST" });
    expect(await (await worker.request("/api/orders?limit=50")).response.json()).toEqual(["paper-order"]);
    expect(worker.cacheCalls).toEqual([]);
  });

  it.each([
    ["/api/account?refresh=1", "cors", "GET"],
    ["/api/account", "navigate", "GET"],
    ["/api", "navigate", "GET"],
    ["/metrics", "navigate", "GET"],
    ["/unknown", "navigate", "GET"],
    ["/unknown.json", "cors", "GET"],
    ["https://other.example/assets/vendor.js", "cors", "GET"],
    ["https://other.example/market", "navigate", "GET"],
    ["/assets/app.js", "cors", "POST"],
    ["/manifest.json", "cors", "HEAD"],
  ])("does not intercept or touch caches for %s (%s %s)", async (path, mode, method) => {
    const worker = createWorker();
    const result = await worker.request(path, { mode, method });
    expect(result.intercepted).toBe(false);
    expect(worker.cacheCalls).toEqual([]);
    expect(worker.fetch).toHaveBeenCalledTimes(1);
  });

  it("never serves a legacy private response when an API is offline", async () => {
    const worker = createWorker({ network: async () => { throw new Error("offline"); } });
    worker.store("kairos-v2").set(worker.key("/api/account"), json({ cash: 20_000 }));
    await expect(worker.request("/api/account")).rejects.toThrow("offline");
    expect(worker.cacheCalls).toEqual([]);
  });

  it.each(["/market?tab=stock", "/strategy", "/account", "/learning", "/settings/", "/", "/index.html"])("keeps HTML navigation available offline for %s", async (path) => {
    let offline = false;
    const worker = createWorker({ network: async () => { if (offline) throw new Error("offline"); return response("<html>shell</html>"); } });
    expect((await worker.request(path, { mode: "navigate" })).intercepted).toBe(true);
    offline = true;
    expect(await (await worker.request(path, { mode: "navigate" })).response.text()).toBe("<html>shell</html>");
    expect(worker.store(currentCache).has(worker.key(path))).toBe(true);
  });

  it("uses the current app shell for an uncached known route while offline", async () => {
    const worker = createWorker({ network: async () => { throw new Error("offline"); } });
    worker.store(currentCache).set(worker.key("/"), response("<html>current shell</html>"));
    worker.store("other-app").set(worker.key("/market"), response("<html>unrelated</html>"));
    expect(await (await worker.request("/market", { mode: "navigate" })).response.text()).toBe("<html>current shell</html>");
  });

  it.each(["/manifest.json", "/icon-192.svg", "/icon-512.svg"])("caches approved public static resource %s", async (path) => {
    const worker = createWorker({ network: () => response("static", "image/svg+xml") });
    expect(await (await worker.request(path)).response.text()).toBe("static");
    expect(await (await worker.request(path)).response.text()).toBe("static");
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.store(currentCache).has(worker.key(path))).toBe(true);
  });

  it("keeps hashed assets network-first with a current-cache offline fallback", async () => {
    let version = "first";
    const worker = createWorker({ network: async () => { if (version === "offline") throw new Error("offline"); return response(version, "text/javascript"); } });
    expect(await (await worker.request("/assets/app-hash.js")).response.text()).toBe("first");
    version = "second";
    expect(await (await worker.request("/assets/app-hash.js")).response.text()).toBe("second");
    version = "offline";
    expect(await (await worker.request("/assets/app-hash.js")).response.text()).toBe("second");
    expect(worker.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns an unavailable response for uncached approved resources while offline", async () => {
    const worker = createWorker({ network: async () => { throw new Error("offline"); } });
    for (const [path, mode] of [["/market", "navigate"], ["/assets/missing.js", "cors"], ["/icon-192.svg", "cors"]]) {
      const result = await worker.request(path, { mode });
      expect(result.intercepted).toBe(true);
      expect(result.response.status).toBe(408);
    }
  });

  it("does not overwrite a usable cached bundle with an HTTP error", async () => {
    let state = "ready";
    const worker = createWorker({ network: async () => {
      if (state === "offline") throw new Error("offline");
      return state === "ready" ? response("usable", "text/javascript") : response("failure", "text/html", 500);
    } });
    expect(await (await worker.request("/assets/stable.js")).response.text()).toBe("usable");
    state = "failed";
    expect((await worker.request("/assets/stable.js")).response.status).toBe(500);
    state = "offline";
    expect(await (await worker.request("/assets/stable.js")).response.text()).toBe("usable");
  });

  it.each([
    ["/market", "navigate", 500, "text/html", "basic"],
    ["/market", "navigate", 200, "application/json", "basic"],
    ["/assets/app.js", "cors", 404, "text/javascript", "basic"],
    ["/manifest.json", "cors", 401, "application/json", "basic"],
    ["/icon-192.svg", "cors", 200, "image/svg+xml", "cors"],
  ])("does not cache unsuitable response for %s (%s %s %s %s)", async (path, mode, status, contentType, type) => {
    const worker = createWorker({ network: () => response("network", contentType, status, type) });
    expect((await worker.request(path, { mode })).response.status).toBe(status);
    expect((await worker.request(path, { mode })).response.status).toBe(status);
    expect(worker.fetch).toHaveBeenCalledTimes(2);
    expect([...worker.stores.values()].every((items) => items.size === 0)).toBe(true);
  });

  it("finishes approved pre-cache reads before skipWaiting", async () => {
    const gate = deferred();
    const worker = createWorker({ network: async (request) => {
      if (request === "/index.html") await gate.promise;
      return response("<html>shell</html>");
    } });
    const installed = worker.lifecycleEvent("install");
    await Promise.resolve();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    gate.resolve();
    await installed;
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    expect([...worker.store(currentCache).keys()]).toContain(worker.key("/index.html"));
  });

  it("does not precache failed responses or non-HTML app shells", async () => {
    const worker = createWorker({ network: (request) => request === "/manifest.json"
      ? json({ message: "failed" }, 500)
      : request === "/index.html" ? json({ message: "unexpected" }) : response("static") });
    await worker.lifecycleEvent("install");
    expect(worker.store(currentCache).has(worker.key("/manifest.json"))).toBe(false);
    expect(worker.store(currentCache).has(worker.key("/index.html"))).toBe(false);
    expect(worker.store(currentCache).has(worker.key("/"))).toBe(true);
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("retains successful pre-cache reads if another approved resource is offline", async () => {
    const worker = createWorker({ network: async (request) => {
      if (request === "/manifest.json") throw new Error("offline");
      return response("<html>shell</html>");
    } });
    await worker.lifecycleEvent("install");
    expect(worker.store(currentCache).has(worker.key("/manifest.json"))).toBe(false);
    expect(worker.store(currentCache).has(worker.key("/"))).toBe(true);
    expect(worker.store(currentCache).has(worker.key("/index.html"))).toBe(true);
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("removes old private Kairos caches before claiming clients and preserves unrelated caches", async () => {
    const gate = deferred();
    const worker = createWorker({ deletionGate: gate.promise });
    worker.store("kairos-v1");
    worker.store("kairos-v2").set(worker.key("/api/auth/session"), json({ authenticated: true }));
    worker.store(currentCache).set(worker.key("/"), response("shell"));
    worker.store("other-app").set(worker.key("/"), response("unrelated"));
    const activated = worker.lifecycleEvent("activate");
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.claim).not.toHaveBeenCalled();
    gate.resolve();
    await activated;
    expect([...worker.stores.keys()].sort()).toEqual([currentCache, "other-app"].sort());
    expect(worker.lifecycle.at(-1)).toBe("claim");
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });
});
