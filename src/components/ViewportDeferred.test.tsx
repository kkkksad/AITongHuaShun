import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewportDeferred } from "./ViewportDeferred";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalObserver = globalThis.IntersectionObserver;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  globalThis.IntersectionObserver = originalObserver;
});

describe("ViewportDeferred", () => {
  it("mounts children once the placeholder approaches the viewport", () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "200px 0px";
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      disconnect = disconnect;
      observe = vi.fn();
      takeRecords = () => [];
      unobserve = vi.fn();
    }
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <ViewportDeferred minHeight={360}>
          <div data-testid="heavy-content">loaded</div>
        </ViewportDeferred>,
      );
    });

    expect(container.querySelector("[data-testid='heavy-content']")).toBeNull();
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe("360px");

    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(container.querySelector("[data-testid='heavy-content']")?.textContent).toBe("loaded");
    expect(disconnect).toHaveBeenCalled();
  });

  it("shows content immediately when IntersectionObserver is unavailable", () => {
    // Older embedded browsers should retain functionality even without lazy mounting.
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <ViewportDeferred><div data-testid="content">ready</div></ViewportDeferred>,
      );
    });

    expect(container.querySelector("[data-testid='content']")?.textContent).toBe("ready");
  });

  it("mounts content when a fast scroll jumps past the placeholder", () => {
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "200px 0px";
      readonly thresholds = [0];
      constructor(_callback: IntersectionObserverCallback) {}
      disconnect = disconnect;
      observe = vi.fn();
      takeRecords = () => [];
      unobserve = vi.fn();
    }
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <ViewportDeferred><div data-testid="jump-content">loaded</div></ViewportDeferred>,
      );
    });
    vi.spyOn(container.firstElementChild as HTMLElement, "getBoundingClientRect")
      .mockReturnValue({ top: -500 } as DOMRect);

    act(() => window.dispatchEvent(new Event("scroll")));

    expect(container.querySelector("[data-testid='jump-content']")?.textContent).toBe("loaded");
    expect(disconnect).toHaveBeenCalled();
  });
});
