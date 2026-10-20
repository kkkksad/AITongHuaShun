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
    const active = container.querySelector('[role="option"][aria-selected="true"]');
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
});
