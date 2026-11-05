import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { act, type ReactNode } from "react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../components/ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
const recoverySource = readFileSync(resolve("src/lib/chunkRecovery.ts"), "utf8");
const sessionKey = "kairos:chunk-recovery-url";
const pageHref = "https://kairos.example/market?tab=research";
type StorageMode = "durable" | "read-throws" | "write-throws" | "write-ignored" | "readback-throws";

function session(mode: StorageMode = "durable") {
  const values = new Map<string, string>();
  let written = false;
  return {
    getItem(name: string) {
      if (mode === "read-throws" || mode === "readback-throws" && written) throw new Error("storage read blocked");
      return values.get(name) ?? null;
    },
    setItem(name: string, value: string) {
      if (mode === "write-throws") throw new Error("storage write blocked");
      written = true;
      if (mode !== "write-ignored") values.set(name, value);
    },
    removeItem: (name: string) => { values.delete(name); },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function compile(source: string, fileName: string) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

const documents: { root: Root; container: HTMLDivElement }[] = [];

// Execute the saved main and recovery sources in a fresh module scope for each
// simulated document. Only app payloads, provider shells and SW network are
// controlled; real React.lazy, Suspense, DOM rendering and ErrorBoundary run.
function createDocument(storage: ReturnType<typeof session>, options: {
  href?: string;
  getterThrows?: boolean;
  development?: boolean;
  supportsServiceWorker?: boolean;
} = {}) {
  const importer = deferred<{ default: () => ReactNode }>();
  const appImport = vi.fn(() => importer.promise);
  const reload = vi.fn();
  const eventWindow = new EventTarget();
  const register = vi.fn(async () => ({ scope: "/" }));
  const unregister = vi.fn(async () => true);
  const getRegistrations = vi.fn(async () => [{ unregister }]);
  const cacheDelete = vi.fn(async () => true);
  const cacheKeys = vi.fn(async () => ["kairos-old"]);
  Object.defineProperties(eventWindow, {
    sessionStorage: { get() { if (options.getterThrows) throw new Error("sessionStorage blocked"); return storage; } },
    location: { value: { href: options.href ?? pageHref, reload } },
    caches: { value: { keys: cacheKeys, delete: cacheDelete } },
  });
  const navigator = options.supportsServiceWorker === false ? {} : {
    serviceWorker: { register, getRegistrations },
  };
  let tree: ReactNode;
  const passthrough = ({ children }: { children: ReactNode }) => children;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react-dom/client": { createRoot: () => ({ render: (value: ReactNode) => { tree = value; } }) },
    "@tanstack/react-query": { QueryClient: class {}, QueryClientProvider: passthrough },
    "react-router-dom": { BrowserRouter: passthrough },
    "./hooks/useTheme": { ThemeProvider: passthrough },
    "./i18n": { I18nProvider: passthrough },
    "./components/ErrorBoundary": { ErrorBoundary },
    "./lib/apiError": { shouldRetryQuery: () => false },
    "./styles/index.css": {}, "./styles/trading-strategies.css": {},
  };
  const environment = {
    window: eventWindow, navigator, document: { getElementById: () => ({}) },
    caches: { keys: cacheKeys, delete: cacheDelete },
    console: { info: vi.fn(), warn: vi.fn(), log: vi.fn() }, Error,
  };
  function loadModule(source: string, fileName: string): Record<string, any> {
    const exports: Record<string, any> = {};
    runInNewContext(compile(source, fileName), {
      ...environment, exports,
      require(specifier: string) {
        if (specifier === "./App") return appImport();
        if (!(specifier in dependencies)) throw new Error(`Unexpected dependency: ${specifier}`);
        return dependencies[specifier];
      },
    });
    return exports;
  }
  const recovery = loadModule(recoverySource, "chunkRecovery.ts");
  dependencies["./lib/chunkRecovery"] = recovery;
  loadModule(mainSource.replaceAll("import.meta.env.DEV", String(options.development ?? false)), "main.tsx");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  documents.push({ root, container });
  return {
    reload, container, appImport, register, unregister, getRegistrations, cacheKeys, cacheDelete,
    fireLoad: () => eventWindow.dispatchEvent(new Event("load")),
    firePreload() {
      const event = new Event("vite:preloadError", { cancelable: true });
      eventWindow.dispatchEvent(event);
      return event;
    },
    async mount() { await act(async () => { root.render(tree); }); },
    async failImport(error = new Error("Failed to fetch dynamically imported module: /assets/App-old.js")) {
      await act(async () => {
        importer.reject(error);
        await importer.promise.catch(() => {});
      });
    },
    async finishImport() {
      await act(async () => { importer.resolve({ default: () => <main>loaded app</main> }); });
    },
    clearRecovery: () => recovery.clearChunkRecoveryAttempt(recovery.getChunkRecoveryStorage()),
  };
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => {
  for (const { root, container } of documents.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("main chunk recovery across document lifecycles", () => {
  it.each(["before-load", "after-load"] as const)("keeps the one-reload limit when lazy import fails %s and fails again after a new document loads", async (timing) => {
    const shared = session();
    const first = createDocument(shared);
    await first.mount();
    expect(first.appImport).toHaveBeenCalledTimes(1);
    if (timing === "after-load") first.fireLoad();
    await first.failImport();
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(shared.getItem(sessionKey)).toBe(pageHref);
    first.fireLoad();
    const second = createDocument(shared);
    await second.mount();
    second.fireLoad();
    await second.failImport();
    expect(second.reload).not.toHaveBeenCalled();
    expect(second.container.textContent).toContain("页面渲染异常");
    expect(second.container.textContent).toContain("刷新页面");
    expect(second.container.textContent).toContain("Failed to fetch dynamically imported module");
  });

  it.each(["lazy-first", "vite-first"] as const)("deduplicates mixed real preload events and lazy failure in %s order across reloads", async (order) => {
    const shared = session();
    const first = createDocument(shared);
    await first.mount();
    first.fireLoad();
    if (order === "vite-first") expect(first.firePreload().defaultPrevented).toBe(true);
    await first.failImport();
    expect(first.firePreload().defaultPrevented).toBe(true);
    first.firePreload();
    expect(first.reload).toHaveBeenCalledTimes(1);
    const second = createDocument(shared);
    second.fireLoad();
    expect(second.firePreload().defaultPrevented).toBe(true);
    await second.mount();
    await second.failImport();
    expect(second.reload).not.toHaveBeenCalled();
  });

  it.each(["getter-throws", "read-throws", "write-throws", "write-ignored", "readback-throws"] as const)("preserves manual error recovery without automatic reload when storage %s, including a new document", async (mode) => {
    const shared = session(mode === "getter-throws" ? "durable" : mode);
    for (let index = 0; index < 2; index++) {
      const current = createDocument(shared, { getterThrows: mode === "getter-throws" });
      await current.mount();
      current.fireLoad();
      await current.failImport();
      current.firePreload();
      current.firePreload();
      expect(current.reload).not.toHaveBeenCalled();
      expect(current.container.textContent).toContain("页面渲染异常");
      expect(current.container.textContent).toContain("刷新页面");
      expect(current.container.textContent).toContain("返回首页");
    }
  });

  it("preserves the last-URL behavior and explicit manual clearing without introducing a URL set", () => {
    const shared = session();
    const first = createDocument(shared);
    first.firePreload();
    expect(first.reload).toHaveBeenCalledTimes(1);
    const otherHref = "https://kairos.example/account";
    const other = createDocument(shared, { href: otherHref });
    other.fireLoad();
    other.firePreload();
    expect(other.reload).toHaveBeenCalledTimes(1);
    expect(shared.getItem(sessionKey)).toBe(otherHref);
    const returned = createDocument(shared);
    returned.firePreload();
    expect(returned.reload).toHaveBeenCalledTimes(1);
    returned.clearRecovery();
    expect(shared.getItem(sessionKey)).toBeNull();
    returned.firePreload();
    expect(returned.reload).toHaveBeenCalledTimes(2);
  });

  it("does not recover ordinary lazy errors or touch an existing attempt", async () => {
    const shared = session();
    shared.setItem(sessionKey, pageHref);
    const current = createDocument(shared);
    await current.mount();
    current.fireLoad();
    await current.failImport(new Error("ordinary render dependency failure"));
    expect(current.reload).not.toHaveBeenCalled();
    expect(shared.getItem(sessionKey)).toBe(pageHref);
    expect(current.container.textContent).toContain("ordinary render dependency failure");
  });

  it("keeps a successful lazy import mounted without clearing the previous URL marker", async () => {
    const shared = session();
    shared.setItem(sessionKey, pageHref);
    const current = createDocument(shared);
    await current.mount();
    current.fireLoad();
    await current.finishImport();
    expect(current.container.textContent).toBe("loaded app");
    expect(current.reload).not.toHaveBeenCalled();
    expect(shared.getItem(sessionKey)).toBe(pageHref);
  });

  it("keeps recovery available without service-worker support and suppresses the next document", async () => {
    const shared = session();
    const first = createDocument(shared, { supportsServiceWorker: false });
    await first.mount();
    first.fireLoad();
    await first.failImport();
    expect(first.reload).toHaveBeenCalledTimes(1);
    const second = createDocument(shared, { supportsServiceWorker: false });
    await second.mount();
    second.fireLoad();
    await second.failImport();
    expect(second.reload).not.toHaveBeenCalled();
  });

  it("preserves production registration on load", () => {
    const current = createDocument(session());
    expect(current.register).not.toHaveBeenCalled();
    current.fireLoad();
    expect(current.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(current.getRegistrations).not.toHaveBeenCalled();
  });

  it("preserves development worker unregistration and cache cleanup on load", async () => {
    const current = createDocument(session(), { development: true });
    current.fireLoad();
    await vi.waitFor(() => expect(current.cacheDelete).toHaveBeenCalledWith("kairos-old"));
    expect(current.getRegistrations).toHaveBeenCalledTimes(1);
    expect(current.unregister).toHaveBeenCalledTimes(1);
    expect(current.cacheKeys).toHaveBeenCalledTimes(1);
    expect(current.register).not.toHaveBeenCalled();
  });
});
