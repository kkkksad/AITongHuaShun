import { act, lazy, Suspense, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../hooks/useTheme";
import { I18nProvider } from "../i18n";
import { getModuleHref } from "../lib/moduleCatalog";
import { AppShell } from "./AppShell";
import { LazyFallback } from "./Skeleton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("module navigation focus", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    scrollIntoView.mockReset();
    frames = new Map();
    frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: scrollIntoView,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  async function flushFrames() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  }

  function Harness({ Destination, refresh = 0 }: { Destination?: ComponentType; refresh?: number }) {
    const location = useLocation();
    const navigate = useNavigate();
    const learning = location.pathname === "/learning";
    return (
      <AppShell
        activeView={learning ? "learning" : location.pathname === "/account" ? "account" : "overview"}
        connectionState="connected"
        mode="paper"
        navigationKey={location.key}
        navigationTargetId={learning ? "learning-paper-plan" : undefined}
        onModuleSelect={(item) => navigate(getModuleHref(item))}
        onViewChange={() => undefined}
      >
        <button id="history-back" onClick={() => navigate(-1)}>返回</button>
        <button id="open-overview" onClick={() => navigate("/")}>总览</button>
        {learning ? (
          <Suspense fallback={<LazyFallback />}>
            {Destination ? <Destination /> : <section id="learning-paper-plan" tabIndex={-1}>资金计划 {refresh}</section>}
          </Suspense>
        ) : location.pathname === "/account" ? (
          <Suspense fallback={<LazyFallback />}>
            {Destination ? <Destination /> : <div>账户</div>}
          </Suspense>
        ) : <div>总览</div>}
      </AppShell>
    );
  }

  async function render(Destination?: ComponentType, refresh = 0, initialEntry = "/") {
    await act(async () => {
      root.render(
        <ThemeProvider><I18nProvider><MemoryRouter initialEntries={[initialEntry]}>
          <Harness Destination={Destination} refresh={refresh} />
        </MemoryRouter></I18nProvider></ThemeProvider>,
      );
    });
    await flushFrames();
  }

  function input() { return container.querySelector<HTMLInputElement>("#global-search")!; }

  async function search(query: string) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }));
    });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), query);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(key: string) {
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
    await flushFrames();
  }

  it("moves focus to the selected section and repeats the same deep link", async () => {
    await render();
    await search("资金计划");
    await press("Enter");
    const section = container.querySelector<HTMLElement>("#learning-paper-plan")!;
    expect(document.activeElement).toBe(section);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    expect(input().getAttribute("aria-expanded")).toBe("false");

    await search("资金计划");
    const before = scrollIntoView.mock.calls.length;
    await press("Enter");
    expect(document.activeElement).toBe(section);
    expect(scrollIntoView).toHaveBeenCalledTimes(before + 1);
  });

  it("waits until a lazy section mounts before transferring focus", async () => {
    let resolve!: (value: { default: ComponentType }) => void;
    const Destination = lazy(() => new Promise<{ default: ComponentType }>((done) => { resolve = done; }));
    await render(Destination);
    await search("资金计划");
    await press("Enter");
    expect(container.querySelector(".page-loader")).not.toBeNull();
    expect(document.activeElement).toBe(input());
    await act(async () => { resolve({ default: () => <section id="learning-paper-plan" tabIndex={-1}>资金计划</section> }); });
    await flushFrames();
    expect(document.activeElement).toBe(container.querySelector("#learning-paper-plan"));
  });

  it("waits for a lazy page before focusing main", async () => {
    let resolve!: (value: { default: ComponentType }) => void;
    const Destination = lazy(() => new Promise<{ default: ComponentType }>((done) => { resolve = done; }));
    await render(Destination);
    await search("额度");
    await press("Enter");
    expect(document.activeElement).toBe(input());
    await act(async () => { resolve({ default: () => <div>账户风控</div> }); });
    await flushFrames();
    expect(document.activeElement).toBe(container.querySelector("main"));
  });

  it("keeps focus and scroll unchanged during refreshes and search cancellation", async () => {
    await render();
    await search("资金计划");
    await press("Enter");
    expect(document.activeElement).toBe(container.querySelector("#learning-paper-plan"));
    await search("订单");
    scrollIntoView.mockClear();
    await render(undefined, 1);
    expect(document.activeElement).toBe(input());
    expect(scrollIntoView).not.toHaveBeenCalled();
    await press("Escape");
    expect(document.activeElement).toBe(input());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("preserves initial deep-link scrolling without taking initial focus", async () => {
    await render(undefined, 0, "/learning?section=paper-plan");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses main when returning to the initial history entry", async () => {
    await render();
    await search("资金计划");
    await press("Enter");
    await act(async () => { container.querySelector<HTMLButtonElement>("#history-back")!.click(); });
    await flushFrames();
    expect(document.activeElement).toBe(container.querySelector("main"));
  });

  it("cancels an obsolete lazy destination when another navigation wins", async () => {
    let resolve!: (value: { default: ComponentType }) => void;
    const Destination = lazy(() => new Promise<{ default: ComponentType }>((done) => { resolve = done; }));
    await render(Destination);
    await search("资金计划");
    await press("Enter");
    await act(async () => { container.querySelector<HTMLButtonElement>("#open-overview")!.click(); });
    await flushFrames();
    const main = container.querySelector("main");
    expect(document.activeElement).toBe(main);
    scrollIntoView.mockClear();
    await act(async () => { resolve({ default: () => <section id="learning-paper-plan" tabIndex={-1}>资金计划</section> }); });
    await flushFrames();
    expect(document.activeElement).toBe(main);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
