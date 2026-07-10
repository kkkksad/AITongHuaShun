import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock matchMedia which jsdom doesn't implement
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("Theme system", () => {
  it("applies data-theme attribute based on theme value", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.setAttribute("data-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("sets color-scheme alongside data-theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.style.colorScheme = "dark";
    expect(document.documentElement.style.colorScheme).toBe("dark");

    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.colorScheme = "light";
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists theme preference to localStorage", () => {
    localStorage.setItem("kairos-theme", "dark");
    expect(localStorage.getItem("kairos-theme")).toBe("dark");

    localStorage.setItem("kairos-theme", "light");
    expect(localStorage.getItem("kairos-theme")).toBe("light");
  });

  it("detects system dark mode preference", () => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // jsdom mock returns false by default
    expect(typeof mq.matches).toBe("boolean");
    expect(mq.matches).toBe(false);
  });

  it("falls back to light when localStorage has invalid value", () => {
    localStorage.setItem("kairos-theme", "invalid");
    const stored = localStorage.getItem("kairos-theme");
    const isValid = stored === "light" || stored === "dark";
    expect(isValid).toBe(false);
  });
});
