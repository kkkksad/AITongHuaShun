import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ThemeProvider } from "../hooks/useTheme";
import { AppShell } from "./AppShell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppShell global navigation", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onModuleSelect = vi.fn();
  const onViewChange = vi.fn();

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    localStorage.clear();
    onModuleSelect.mockReset();
    onViewChange.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(activeModuleId = "overview") {
    await act(async () => {
      root.render(
        <ThemeProvider>
          <I18nProvider>
            <AppShell
              activeModuleId={activeModuleId}
              activeView="overview"
              connectionState="connected"
              mode="paper"
              onModuleSelect={onModuleSelect}
              onViewChange={onViewChange}
            >
              <div>页面内容</div>
            </AppShell>
          </I18nProvider>
        </ThemeProvider>,
      );
    });
  }

  function searchInput() {
    return container.querySelector<HTMLInputElement>("#global-search")!;
  }

  async function press(key: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      searchInput().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...init }));
    });
  }

  async function typeQuery(value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(searchInput(), value);
      searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function highlightedOption() {
    return container.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
  }

  it("searches all modules and limits the visible result list to twelve", async () => {
    await render();
    const input = searchInput();
    await act(async () => {
      input.focus();
    });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(12);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "拒单");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.querySelector('[role="option"]')?.textContent).toContain("订单与成交");
  });

  it("focuses search with Ctrl/Cmd+K and selects the first result with Enter", async () => {
    await render();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }));
    });
    expect(document.activeElement).toBe(searchInput());

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(searchInput(), "额度");
      searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      searchInput().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onModuleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "account-risk" }));
    expect(searchInput().value).toBe("");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("highlights the current deep-linked module and forwards clicks", async () => {
    await render("account-orders");
    await act(async () => {
      searchInput().focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(searchInput(), "订单");
      searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const active = container.querySelector('[role="option"][aria-current="page"]');
    expect(active?.textContent ?? "").toContain("订单与成交");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="option"]:not([aria-selected="true"])')!.click();
    });
    expect(onModuleSelect).toHaveBeenCalledTimes(1);
    expect(onModuleSelect.mock.calls[0][0]).toMatchObject({
      id: expect.not.stringMatching(/^account-orders$/),
      view: expect.any(String),
    });
  });

  it("moves the accessible highlight with arrow keys and selects that module", async () => {
    await render();
    await act(async () => searchInput().focus());
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));

    expect(highlightedOption()).toBe(options[0]);
    expect(searchInput().getAttribute("aria-activedescendant")).toBe(options[0].id);
    await press("ArrowDown");
    expect(highlightedOption()).toBe(options[1]);
    expect(options[1].classList.contains("active")).toBe(true);
    expect(searchInput().getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(document.activeElement).toBe(searchInput());

    await press("ArrowUp");
    expect(highlightedOption()).toBe(options[0]);
    await press("ArrowUp");
    expect(highlightedOption()).toBe(options.at(-1));
    await press("Enter");
    expect(onModuleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "market-esoteric" }));
    expect(searchInput().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("keeps the highlighted result visible without moving input focus", async () => {
    await render();
    await act(async () => searchInput().focus());
    const second = container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1];
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;

    await press("ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.activeElement).toBe(searchInput());
  });

  it("resets highlight when filtering and never selects an absent or closed result", async () => {
    await render();
    await act(async () => searchInput().focus());
    await press("ArrowUp");
    await typeQuery("订单");
    expect(highlightedOption()).toBe(container.querySelector('[role="option"]'));
    await typeQuery("无匹配的模块名称_xyz");
    expect(highlightedOption()).toBeNull();
    expect(searchInput().getAttribute("aria-activedescendant")).toBeNull();
    await press("ArrowDown");
    await press("Enter");
    expect(onModuleSelect).not.toHaveBeenCalled();
    await typeQuery("额度");
    await press("Escape");
    expect(searchInput().getAttribute("aria-expanded")).toBe("false");
    expect(searchInput().getAttribute("aria-activedescendant")).toBeNull();
    await press("Enter");
    expect(onModuleSelect).not.toHaveBeenCalled();
    await press("ArrowDown");
    expect(highlightedOption()?.textContent).toContain("风控");
  });

  it("uses the same highlight for pointer movement and keyboard selection", async () => {
    await render();
    await act(async () => searchInput().focus());
    await typeQuery("订单");
    const options = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options.length).toBeGreaterThan(1);
    await act(async () => {
      options[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    expect(highlightedOption()).toBe(options[1]);
    const label = options[1].querySelector("strong")!.textContent;
    await press("Enter");
    expect(onModuleSelect).toHaveBeenCalledWith(expect.objectContaining({ label }));
  });

  it("keeps IME confirmation from navigating or moving the highlight", async () => {
    await render();
    await act(async () => searchInput().focus());
    const initialHighlight = highlightedOption();
    await press("Enter", { isComposing: true });
    await press("ArrowDown", { isComposing: true });
    await press("Enter", { keyCode: 229 });
    expect(highlightedOption()).toBe(initialHighlight);
    expect(onModuleSelect).not.toHaveBeenCalled();

    await act(async () => {
      searchInput().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await press("Enter");
    expect(onModuleSelect).not.toHaveBeenCalled();
    await act(async () => {
      searchInput().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await press("Enter");
    expect(onModuleSelect).toHaveBeenCalledTimes(1);
  });
});
