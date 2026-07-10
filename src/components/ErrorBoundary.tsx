import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI; if omitted, the built-in error display is used. */
  fallback?: ReactNode;
  /** Called when an error is caught (e.g. for logging) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to console in dev
    console.error("[ErrorBoundary] Caught rendering error:", error, errorInfo);
    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback takes priority
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-boundary-icon-wrapper">
              <AlertTriangle size={48} className="error-boundary-icon" />
            </div>
            <h2>页面渲染异常</h2>
            <p>
              页面加载过程中发生了意外错误，请尝试刷新页面或重试。
            </p>
            {this.state.error && (
              <p className="error-boundary-detail">
                {this.state.error.message}
              </p>
            )}

            <div className="error-boundary-actions">
              <button
                className="primary-button"
                onClick={this.handleReload}
                type="button"
              >
                <RefreshCw size={16} />
                刷新页面
              </button>
              <button
                className="secondary-button"
                onClick={this.handleGoHome}
                type="button"
              >
                <Home size={16} />
                返回首页
              </button>
            </div>

            {isDev && this.state.error && (
              <details className="error-stack">
                <summary>错误堆栈（仅开发环境可见）</summary>
                <pre>{this.state.error.stack ?? "无堆栈信息"}</pre>
                {this.state.errorInfo && (
                  <pre>{this.state.errorInfo.componentStack ?? "无组件堆栈"}</pre>
                )}
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
