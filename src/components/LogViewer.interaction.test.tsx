import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { apiRequest } from "../lib/tradingApi";
import { LogViewer } from "./LogViewer";

vi.mock("../lib/tradingApi", () => ({ apiRequest: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface PendingRequest {
  path: string;
  signal?: AbortSignal | null;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

const today = "2026-11-05";
const yesterday = "2026-11-04";
const earlier = "2026-11-03";

describe("LogViewer request lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let requests: PendingRequest[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${today}T03:00:00.000Z`));
    localStorage.clear();
    requests = [];
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(((path: string, init?: RequestInit) =>
      new Promise<unknown>((resolve, reject) => {
        requests.push({ path, signal: init?.signal, resolve, reject });
      })) as typeof apiRequest);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const logRequests = () => requests.filter((request) => request.path.startsWith("/api/logs?"));
  const dateRequests = () => requests.filter((request) => request.path === "/api/logs/dates");
  const rows = () => Array.from(container.querySelectorAll(".log-entry-message"), (node) => node.textContent);
  const loading = () => Boolean(container.querySelector(".log-refresh-state")?.textContent?.includes("刷新中"));
  const error = () => container.querySelector(".log-error-banner")?.textContent;
  const exportDisabled = () => container.querySelector<HTMLButtonElement>('button[aria-label="导出当前页日志"]')!.disabled;
  const params = (request: PendingRequest) => new URL(request.path, "http://localhost").searchParams;

  async function render() {
    await act(async () => { root.render(<I18nProvider><LogViewer /></I18nProvider>); });
    await act(async () => { dateRequests()[0].resolve({ dates: [today, yesterday, earlier] }); });
    await act(() => vi.advanceTimersByTimeAsync(300));
  }

  async function reply(request: PendingRequest, message: string, level = "info") {
    const query = params(request);
    const offset = Number(query.get("offset") ?? 0);
    await act(async () => {
      request.resolve({
        date: query.get("date"), total: 101, filtered: 101, returned: 1,
        offset, limit: 50, page: offset / 50 + 1, pageCount: 3,
        hasPrevious: offset > 0, hasNext: offset < 100,
        entries: [{ timestamp: `${today}T03:00:00.000Z`, level, module: "audit", message }],
      });
    });
  }

  async function select(label: string, value: string) {
    await act(async () => {
      const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function click(label: string) {
    await act(async () => { container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(); });
  }

  for (const outcome of ["success", "failure"] as const) {
    it(`ignores an obsolete filter request's ${outcome} after the current result`, async () => {
      await render();
      const obsolete = logRequests()[0];
      await select("日志级别", "error");
      await reply(logRequests()[1], "CURRENT_ERROR", "error");
      await act(async () => {
        if (outcome === "success") obsolete.resolve({
          date: today, total: 1, filtered: 1, returned: 1, offset: 0, limit: 50,
          page: 1, pageCount: 1, entries: [{ timestamp: `${today}T03:00:00Z`, level: "info", module: "old", message: "OBSOLETE_INFO" }],
        });
        else obsolete.reject(new Error("OBSOLETE_FAILURE"));
      });
      expect(rows()).toEqual(["CURRENT_ERROR"]);
      expect(error()).toBeUndefined();
      expect(container.querySelector<HTMLSelectElement>('select[aria-label="日志级别"]')!.value).toBe("error");
      expect(loading()).toBe(false);
    });

    it(`does not let an obsolete ${outcome} end the current loading state`, async () => {
      await render();
      const obsolete = logRequests()[0];
      await select("日志级别", "error");
      await act(async () => {
        if (outcome === "success") obsolete.resolve({ entries: [], total: 0, filtered: 0, offset: 0, page: 1, pageCount: 1 });
        else obsolete.reject(new Error("OBSOLETE_FAILURE"));
      });
      expect(loading()).toBe(true);
      expect(error()).toBeUndefined();
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="日志下一页"]')!.disabled).toBe(true);
      await reply(logRequests()[1], "CURRENT_ERROR", "error");
      expect(loading()).toBe(false);
    });
  }

  it("keeps the selected date and its results when an earlier date completes late", async () => {
    await render();
    await select("选择日期", yesterday);
    const previous = logRequests()[1];
    await select("选择日期", earlier);
    await reply(logRequests()[2], "EARLIER_DATE");
    await reply(previous, "WRONG_DATE");
    expect(rows()).toEqual(["EARLIER_DATE"]);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="选择日期"]')!.value).toBe(earlier);
    expect(params(logRequests()[2]).get("date")).toBe(earlier);
  });

  for (const scope of ["level", "date", "page", "module"] as const) {
    it(`clears prior rows, counts and export while a new ${scope} scope is pending`, async () => {
      await render();
      await reply(logRequests()[0], "PRIOR_SCOPE_INFO");
      expect(exportDisabled()).toBe(false);
      await act(async () => { container.querySelector<HTMLButtonElement>(".log-entry-header")!.click(); });
      expect(container.querySelector(".log-entry.expanded")).not.toBeNull();
      if (scope === "level") await select("日志级别", "error");
      else if (scope === "date") await select("选择日期", yesterday);
      else if (scope === "page") await click("日志下一页");
      else {
        await act(async () => {
          const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索日志"]')!;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "risk");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(() => vi.advanceTimersByTimeAsync(300));
      }
      expect(rows()).toEqual([]);
      expect(container.querySelector(".log-entry.expanded")).toBeNull();
      expect(container.querySelector(".log-count")?.textContent).toContain("显示 0-0 / 0 条");
      expect(container.querySelector(".log-statusbar")?.textContent).toContain("原始 0 条 · 过滤后 0 条 · 当前页 0 条");
      expect(exportDisabled()).toBe(true);
      if (scope === "page") expect(container.querySelector(".log-pagination")?.textContent).toContain("总页数待确认");
      await reply(logRequests()[1], "CURRENT_SCOPE_RESULT", scope === "level" ? "error" : "info");
      expect(rows()).toEqual(["CURRENT_SCOPE_RESULT"]);
      expect(exportDisabled()).toBe(false);
      expect(container.querySelector(".log-entry.expanded")).toBeNull();
    });
  }

  it("keeps a failed new scope empty and unexportable until its retry succeeds", async () => {
    await render();
    await reply(logRequests()[0], "PRIOR_INFO");
    await select("日志级别", "error");
    await act(async () => { logRequests()[1].reject(new Error("NEW_SCOPE_FAILURE")); });
    expect(rows()).toEqual([]);
    expect(exportDisabled()).toBe(true);
    expect(error()).toContain("NEW_SCOPE_FAILURE");
    await act(async () => { container.querySelector<HTMLButtonElement>(".log-error-banner button")!.click(); });
    expect(rows()).toEqual([]);
    expect(exportDisabled()).toBe(true);
    await reply(logRequests()[2], "CURRENT_ERROR", "error");
    expect(rows()).toEqual(["CURRENT_ERROR"]);
    expect(exportDisabled()).toBe(false);
  });

  it("ignores a history page response after auto refresh returns to page one", async () => {
    await render();
    await reply(logRequests()[0], "PAGE_ONE");
    await click("日志下一页");
    const history = logRequests()[1];
    expect(params(history).get("offset")).toBe("50");
    await click("自动刷新");
    await reply(logRequests()[2], "LATEST_PAGE_ONE");
    await reply(history, "OBSOLETE_PAGE_TWO");
    expect(rows()).toEqual(["LATEST_PAGE_ONE"]);
    expect(container.querySelector(".log-pagination")?.textContent).toContain("第 1 / 3 页");
    expect(logRequests()).toHaveLength(3);
  });

  it("retains same-scope rows on refresh failure and retries without clearing them", async () => {
    await render();
    await reply(logRequests()[0], "CACHED_LOG");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(rows()).toEqual(["CACHED_LOG"]);
    expect(exportDisabled()).toBe(false);
    expect(loading()).toBe(true);
    await act(async () => { logRequests()[1].reject(new Error("CURRENT_REFRESH_FAILURE")); });
    expect(rows()).toEqual(["CACHED_LOG"]);
    expect(exportDisabled()).toBe(false);
    expect(error()).toContain("CURRENT_REFRESH_FAILURE");
    expect(loading()).toBe(false);
    await act(async () => { container.querySelector<HTMLButtonElement>(".log-error-banner button")!.click(); });
    expect(rows()).toEqual(["CACHED_LOG"]);
    expect(error()).toBeUndefined();
    expect(loading()).toBe(true);
    await reply(logRequests()[2], "RETRIED_LOG");
    expect(rows()).toEqual(["RETRIED_LOG"]);
  });

  it("lets a slow same-scope refresh finish before starting the next automatic request", async () => {
    await render();
    await reply(logRequests()[0], "INITIAL_LOG");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(logRequests()).toHaveLength(2);
    expect(logRequests()[1].signal?.aborted).toBe(false);
    expect(rows()).toEqual(["INITIAL_LOG"]);
    expect(loading()).toBe(true);
    await reply(logRequests()[1], "SLOW_REFRESH");
    expect(rows()).toEqual(["SLOW_REFRESH"]);
    expect(loading()).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(logRequests()).toHaveLength(3);
    await reply(logRequests()[2], "NEXT_REFRESH");
    expect(rows()).toEqual(["NEXT_REFRESH"]);
  });

  it("does not let an obsolete date list reset the current date selection", async () => {
    await render();
    await select("选择日期", yesterday);
    const oldDates = dateRequests()[1];
    await select("选择日期", earlier);
    await act(async () => { dateRequests()[2].resolve({ dates: [today, earlier] }); });
    await act(async () => { oldDates.resolve({ dates: [today] }); });
    const element = container.querySelector<HTMLSelectElement>('select[aria-label="选择日期"]')!;
    expect(element.value).toBe(earlier);
    expect(Array.from(element.options, (option) => option.value)).toEqual([today, earlier]);
    expect(logRequests()).toHaveLength(3);
  });

  it("keeps module filtering debounced and ignores the prior module response", async () => {
    await render();
    const obsolete = logRequests()[0];
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索日志"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " risk ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(logRequests()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(params(logRequests()[1]).get("module")).toBe("risk");
    await reply(logRequests()[1], "RISK_LOG");
    await reply(obsolete, "WRONG_MODULE");
    expect(rows()).toEqual(["RISK_LOG"]);
  });

  it("pauses automatic refresh while a settled history page is visible", async () => {
    await render();
    await reply(logRequests()[0], "PAGE_ONE");
    await click("日志下一页");
    await reply(logRequests()[1], "PAGE_TWO");
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(logRequests()).toHaveLength(2);
    expect(rows()).toEqual(["PAGE_TWO"]);
    expect(container.querySelector(".log-statusbar")?.textContent).toContain("历史页已暂停自动刷新");
  });

  it("aborts pending log and date requests and removes refresh timers on unmount", async () => {
    await act(async () => { root.render(<I18nProvider><LogViewer /></I18nProvider>); });
    const pending = [...requests];
    await act(async () => root.unmount());
    mounted = false;
    expect(pending).toHaveLength(2);
    expect(pending.every((request) => request.signal?.aborted)).toBe(true);
    await act(async () => {
      dateRequests()[0].resolve({ dates: [yesterday] });
      logRequests()[0].reject(new Error("UNMOUNTED_FAILURE"));
    });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(requests).toHaveLength(2);
    expect(container.childNodes).toHaveLength(0);
  });
});
