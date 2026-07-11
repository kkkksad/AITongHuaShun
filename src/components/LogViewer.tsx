import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Info,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  entries: LogEntry[];
}

interface DatesResponse {
  dates: string[];
}

type LogLevel = "debug" | "info" | "warn" | "error";

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
  const { t, locale } = useI18n();
  const iszh = locale === "zh";

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [currentDate, setCurrentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dates, setDates] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "">("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
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
        limit: "200",
        date: currentDate,
      });
      if (levelFilter) params.set("level", levelFilter);
      if (moduleFilter.trim()) params.set("module", moduleFilter.trim());

      const data = await apiRequest<LogsResponse>("/api/logs?" + params.toString());
      setEntries(data.entries);
      setTotal(data.total);
      setFiltered(data.filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取日志失败");
    } finally {
      setLoading(false);
    }
  }, [currentDate, levelFilter, moduleFilter]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchLogs, 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

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
    a.download = "kairos-logs-" + currentDate + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, currentDate]);

  // 可用模块列表
  const modules = useMemo(() => {
    const modSet = new Set<string>();
    entries.forEach((e) => modSet.add(e.module));
    return Array.from(modSet).sort();
  }, [entries]);

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
              onChange={(e) => setCurrentDate(e.target.value)}
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
              onChange={(e) => setLevelFilter(e.target.value as LogLevel | "")}
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

          {/* 模块过滤 */}
          {modules.length > 0 && (
            <div className="log-level-select">
              <select
                aria-label={iszh ? "模块" : "Module"}
                onChange={(e) => setModuleFilter(e.target.value)}
                value={moduleFilter}
              >
                <option value="">
                  {iszh ? "全部模块" : "All Modules"}
                </option>
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="log-toolbar-right">
          <span className="log-count">
            {iszh
              ? "显示 " + filtered + " / " + total + " 条"
              : "Showing " + filtered + " / " + total}
          </span>

          <button
            aria-label={iszh ? "自动刷新" : "Auto refresh"}
            className={"log-action-btn" + (autoRefresh ? " active" : "")}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={iszh ? "自动刷新（10秒）" : "Auto refresh (10s)"}
            type="button"
          >
            <RefreshCw size={16} />
          </button>

          <button
            aria-label={iszh ? "导出日志" : "Export logs"}
            className="log-action-btn"
            disabled={entries.length === 0}
            onClick={handleExport}
            title={iszh ? "导出为 JSON" : "Export as JSON"}
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
          onChange={(e) => setModuleFilter(e.target.value)}
          placeholder={iszh ? "搜索模块名..." : "Search module name..."}
          type="text"
          value={moduleFilter}
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
            const isExpanded = expandedEntry === idx;

            return (
              <div
                className={
                  "log-entry" +
                  (isExpanded ? " expanded" : "") +
                  " log-level-" + entry.level
                }
                key={idx}
              >
                <button
                  className="log-entry-header"
                  onClick={() =>
                    setExpandedEntry(isExpanded ? null : idx)
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

      {/* 底部状态栏 */}
      <div className="log-statusbar">
        <CheckCircle size={14} />
        <span>
          {iszh
            ? "共 " + total + " 条，过滤后 " + filtered + " 条"
            : total + " total, " + filtered + " filtered"}
        </span>
      </div>
    </div>
  );
}
