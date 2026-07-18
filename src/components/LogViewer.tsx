import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Info,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { apiRequest } from "../lib/tradingApi";

// ── Types ──────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

interface LogsResponse {
  date: string;
  total: number;
  filtered: number;
  returned: number;
  offset: number;
  limit: number;
  page: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
  entries: LogEntry[];
}

interface DatesResponse {
  dates: string[];
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_PAGE_SIZE = 50;

// ── Level config ───────────────────────────────────────────

const levelConfig: Record<
  LogLevel,
  { label: string; color: string; bg: string; icon: typeof Info }
> = {
  debug: { label: "DEBUG", color: "var(--text-muted)", bg: "var(--bg-tag)", icon: FileText },
  info: { label: "INFO", color: "var(--color-primary)", bg: "var(--color-primary-bg)", icon: Info },
  warn: { label: "WARN", color: "var(--color-warning)", bg: "var(--color-warning-bg)", icon: AlertTriangle },
  error: { label: "ERROR", color: "var(--color-negative)", bg: "var(--color-negative-bg)", icon: XCircle },
};

// ── Helpers ────────────────────────────────────────────────

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return isoString;
  }
}

function formatDateLabel(dateStr: string, locale: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (locale === "zh") {
      return date.toLocaleDateString("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "short",
      });
    }
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  } catch {
    return dateStr;
  }
}

// ── Component ──────────────────────────────────────────────

export function LogViewer() {
  const { locale } = useI18n();
  const iszh = locale === "zh";

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [currentDate, setCurrentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dates, setDates] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "">("");
  const [moduleInput, setModuleInput] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [offset, setOffset] = useState(0);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 获取可用日期列表
  const fetchDates = useCallback(async () => {
    try {
      const data = await apiRequest<DatesResponse>("/api/logs/dates");
      setDates(data.dates);
      if (data.dates.length > 0 && !data.dates.includes(currentDate)) {
        setCurrentDate(data.dates[0]);
        setPage(1);
      }
    } catch {
      // 静默失败
    }
  }, [currentDate]);

  // 获取日志
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(LOG_PAGE_SIZE),
        offset: String((page - 1) * LOG_PAGE_SIZE),
        date: currentDate,
      });
      if (levelFilter) params.set("level", levelFilter);
      if (moduleFilter.trim()) params.set("module", moduleFilter.trim());

      const data = await apiRequest<LogsResponse>("/api/logs?" + params.toString());
      setEntries(data.entries);
      setTotal(data.total);
      setFiltered(data.filtered);
      setOffset(data.offset);
      setPageCount(data.pageCount);
      if (data.page !== page) setPage(data.page);
      setExpandedEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取日志失败");
    } finally {
      setLoading(false);
    }
  }, [currentDate, levelFilter, moduleFilter, page]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setModuleFilter(moduleInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [moduleInput]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || page !== 1) return;
    const timer = setInterval(fetchLogs, 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs, page]);

  // 导出日志
  const handleExport = useCallback(() => {
    const text = entries
      .map((e) =>
        JSON.stringify(e),
      )
      .join("\n");
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kairos-logs-${currentDate}-page-${page}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, currentDate, page]);

  const rangeStart = filtered === 0 ? 0 : offset + 1;
  const rangeEnd = filtered === 0 ? 0 : offset + entries.length;

  function changePage(nextPage: number) {
    setExpandedEntry(null);
    setAutoRefresh(false);
    setPage(Math.min(Math.max(1, nextPage), pageCount));
  }

  function toggleAutoRefresh() {
    if (autoRefresh) {
      setAutoRefresh(false);
      return;
    }
    setPage(1);
    setAutoRefresh(true);
  }

  return (
    <div className="log-viewer">
      {/* 工具栏 */}
      <div className="log-toolbar">
        <div className="log-toolbar-left">
          {/* 日期选择 */}
          <div className="log-date-select">
            <Clock size={16} />
            <select
              aria-label={iszh ? "选择日期" : "Select date"}
              onChange={(e) => {
                setCurrentDate(e.target.value);
                setPage(1);
                setExpandedEntry(null);
              }}
              value={currentDate}
            >
              {dates.length === 0 && (
                <option value={currentDate}>
                  {formatDateLabel(currentDate, locale)}
                </option>
              )}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatDateLabel(d, locale)}
                </option>
              ))}
            </select>
          </div>

          {/* 级别过滤 */}
          <div className="log-level-select">
            <select
              aria-label={iszh ? "日志级别" : "Log level"}
              onChange={(e) => {
                setLevelFilter(e.target.value as LogLevel | "");
                setPage(1);
                setExpandedEntry(null);
              }}
              value={levelFilter}
            >
              <option value="">
                {iszh ? "全部级别" : "All Levels"}
              </option>
              <option value="debug">DEBUG</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
          </div>

        </div>

        <div className="log-toolbar-right">
          <span className="log-count">
            {iszh
              ? `显示 ${rangeStart}-${rangeEnd} / ${filtered} 条`
              : `Showing ${rangeStart}-${rangeEnd} of ${filtered}`}
          </span>

          <button
            aria-label={iszh ? "自动刷新" : "Auto refresh"}
            className={"log-action-btn" + (autoRefresh && page === 1 ? " active" : "")}
            onClick={toggleAutoRefresh}
            title={
              autoRefresh && page === 1
                ? (iszh ? "自动刷新已开启（10秒）" : "Auto refresh enabled (10s)")
                : (iszh ? "开启自动刷新并返回第一页" : "Enable auto refresh and return to page one")
            }
            type="button"
          >
            <RefreshCw size={16} />
          </button>

          <button
            aria-label={iszh ? "导出当前页日志" : "Export current log page"}
            className="log-action-btn"
            disabled={entries.length === 0}
            onClick={handleExport}
            title={iszh ? "导出当前页 JSON" : "Export current page as JSON"}
            type="button"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="log-search-bar">
        <Search size={16} />
        <input
          aria-label={iszh ? "搜索日志" : "Search logs"}
          onChange={(e) => setModuleInput(e.target.value)}
          placeholder={iszh ? "搜索模块名..." : "Search module name..."}
          type="text"
          value={moduleInput}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="log-error-banner">
          <XCircle size={16} />
          <span>{error}</span>
          <button onClick={fetchLogs} type="button">
            {iszh ? "重试" : "Retry"}
          </button>
        </div>
      )}

      {/* 加载状态 */}
      {loading && entries.length === 0 && (
        <div className="log-loading">
          <div className="page-loader-spinner" />
          <span>{iszh ? "加载日志..." : "Loading logs..."}</span>
        </div>
      )}

      {/* 空状态 */}
      {!loading && entries.length === 0 && !error && (
        <div className="log-empty">
          <FileText size={48} />
          <h3>{iszh ? "暂无日志" : "No Logs"}</h3>
          <p>
            {iszh
              ? "当前日期没有日志记录，或日志文件尚未生成。"
              : "No log entries for the selected date."}
          </p>
        </div>
      )}

      {/* 日志列表 */}
      {entries.length > 0 && (
        <div className="log-entries">
          {entries.map((entry, idx) => {
            const config = levelConfig[entry.level] ?? levelConfig.info;
            const LevelIcon = config.icon;
            const entryKey = `${entry.timestamp}-${entry.module}-${entry.message}-${idx}`;
            const isExpanded = expandedEntry === entryKey;

            return (
              <div
                className={
                  "log-entry" +
                  (isExpanded ? " expanded" : "") +
                  " log-level-" + entry.level
                }
                key={entryKey}
              >
                <button
                  className="log-entry-header"
                  onClick={() =>
                    setExpandedEntry(isExpanded ? null : entryKey)
                  }
                  type="button"
                >
                  <span
                    className="log-entry-level"
                    style={{ color: config.color, background: config.bg }}
                  >
                    <LevelIcon size={14} />
                    {config.label}
                  </span>
                  <span className="log-entry-module">{entry.module}</span>
                  <span className="log-entry-message">{entry.message}</span>
                  <span className="log-entry-time">
                    {formatTime(entry.timestamp)}
                  </span>
                  <ChevronDown
                    className={
                      "log-entry-chevron" +
                      (isExpanded ? " rotated" : "")
                    }
                    size={14}
                  />
                </button>

                {isExpanded && (
                  <div className="log-entry-detail">
                    <div className="log-detail-row">
                      <span className="log-detail-label">
                        {iszh ? "时间" : "Time"}
                      </span>
                      <span>{entry.timestamp}</span>
                    </div>
                    <div className="log-detail-row">
                      <span className="log-detail-label">
                        {iszh ? "模块" : "Module"}
                      </span>
                      <code>{entry.module}</code>
                    </div>
                    {entry.data &&
                      Object.keys(entry.data).length > 0 && (
                        <div className="log-detail-row">
                          <span className="log-detail-label">Data</span>
                          <pre className="log-detail-data">
                            {JSON.stringify(entry.data, null, 2)}
                          </pre>
                        </div>
                      )}
                    {entry.error && (
                      <div className="log-detail-row">
                        <span className="log-detail-label">
                          {iszh ? "错误堆栈" : "Stack Trace"}
                        </span>
                        <pre className="log-detail-error">
                          {entry.error}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <nav aria-label={iszh ? "系统日志分页" : "System log pagination"} className="log-pagination">
        <span>
          {iszh ? `第 ${page} / ${pageCount} 页` : `Page ${page} of ${pageCount}`}
        </span>
        <div>
          <button
            aria-label={iszh ? "日志上一页" : "Previous log page"}
            className="log-action-btn"
            disabled={page <= 1 || loading}
            onClick={() => changePage(page - 1)}
            title={iszh ? "上一页" : "Previous page"}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label={iszh ? "日志下一页" : "Next log page"}
            className="log-action-btn"
            disabled={page >= pageCount || loading}
            onClick={() => changePage(page + 1)}
            title={iszh ? "下一页" : "Next page"}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </nav>

      {/* 底部状态栏 */}
      <div className="log-statusbar">
        <CheckCircle size={14} />
        <span>
          {iszh
            ? `原始 ${total} 条 · 过滤后 ${filtered} 条 · 当前页 ${entries.length} 条`
            : `${total} total · ${filtered} filtered · ${entries.length} on this page`}
        </span>
        {loading && <span className="log-refresh-state">{iszh ? "刷新中…" : "Refreshing…"}</span>}
        {page > 1 && !loading && (
          <span className="log-refresh-state">
            {iszh ? "历史页已暂停自动刷新" : "Auto refresh paused on history pages"}
          </span>
        )}
      </div>
    </div>
  );
}
