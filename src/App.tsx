import { useEffect, useMemo, useState, type ReactNode, lazy, Suspense } from "react";
import { Activity, CircleAlert, Database, Gauge, TrendingUp } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell, type ViewId } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PwaInstallPrompt, OfflineBanner } from "./components/PwaInstallPrompt";
import { LazyFallback } from "./components/Skeleton";
import { LoginPage } from "./components/LoginPage";
import { TradingStrategies } from "./components/TradingStrategies";
import { SystemMonitor } from "./components/SystemMonitor";
import { strategies } from "./data/mockData";
import { runBacktest } from "./lib/backtest";
import {
  AUTH_EXPIRED_EVENT,
  logout,
  verifyLogin,
  type AuthUser,
} from "./lib/tradingApi";
import { useTradingBackend } from "./hooks/useTradingBackend";
import type { StrategyId, StrategyParameters } from "./types";

// ── Helper for lazy-loading named exports ────────────────────
// eslint-disable-next-line
function lazyNamed(importer: () => Promise<any>, name: string): any {
  // eslint-disable-next-line
  return lazy(() => importer().then((m: any) => ({ default: m[name] })));
}

// ── Lazy-loaded heavy components ──────────────────────────────
const BacktestResults = lazyNamed(() => import("./components/BacktestResults"), "BacktestResults");
const DailyCandidates = lazyNamed(() => import("./components/DailyCandidates"), "DailyCandidates");
const DailyQualityStocks = lazyNamed(() => import("./components/DailyQualityStocks"), "DailyQualityStocks");
const FlowPanel = lazyNamed(() => import("./components/FlowPanel"), "FlowPanel");
const LearningPipeline = lazy(() => import("./components/LearningPipeline"));
const LogViewer = lazyNamed(() => import("./components/LogViewer"), "LogViewer");
const MarketOverview = lazyNamed(() => import("./components/MarketOverview"), "MarketOverview");
const MarketPage = lazy(() => import("./pages/MarketPage"));
const NewsPanel = lazyNamed(() => import("./components/NewsPanel"), "NewsPanel");
const OrderHistory = lazyNamed(() => import("./components/OrderHistory"), "OrderHistory");
const PaperAccount = lazyNamed(() => import("./components/PaperAccount"), "PaperAccount");
const Portfolio = lazyNamed(() => import("./components/Portfolio"), "Portfolio");
const RiskPanel = lazyNamed(() => import("./components/RiskPanel"), "RiskPanel");
const Settings = lazyNamed(() => import("./components/Settings"), "Settings");
const StrategyCompare = lazyNamed(() => import("./components/StrategyCompare"), "StrategyCompare");
const StrategyLab = lazyNamed(() => import("./components/StrategyLab"), "StrategyLab");
const StrategyLeaderboard = lazyNamed(() => import("./components/StrategyLeaderboard"), "StrategyLeaderboard");
const StrategyRobustnessPanel = lazyNamed(() => import("./components/StrategyRobustnessPanel"), "StrategyRobustnessPanel");

type AccountTab = "portfolio" | "trading" | "orders" | "risk" | "strategies" | "monitor" | "logs";

const defaultParameters: StrategyParameters = {
  lookback: 20,
  entryThreshold: 1.4,
  stopLoss: 6,
  takeProfit: 15,
  maxPosition: 35,
  rebalanceDays: 5,
};

function percent(value: number): string {
  return (value >= 0 ? "+" : "") + (value * 100).toFixed(2) + "%";
}

const accountTabs: { id: AccountTab; label: string }[] = [
  { id: "portfolio", label: "持仓分析" },
  { id: "trading", label: "交易下单" },
  { id: "strategies", label: "交易策略" },
  { id: "orders", label: "订单历史" },
  { id: "risk", label: "风控面板" },
  { id: "monitor", label: "系统监控" },
  { id: "logs", label: "系统日志" },
];

const viewPaths: Record<ViewId, string> = {
  overview: "/",
  strategy: "/strategy",
  market: "/market",
  account: "/account",
  learning: "/learning",
  settings: "/settings",
};

const pathViews = Object.fromEntries(
  Object.entries(viewPaths).map(([view, path]) => [path, view]),
) as Record<string, ViewId>;

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const trading = useTradingBackend({
    enabled: authChecked && Boolean(authUser),
  });
  const location = useLocation();
  const navigate = useNavigate();
  const [accountTab, setAccountTab] = useState<AccountTab>("portfolio");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId>("momentum");
  const [parameters, setParameters] = useState<StrategyParameters>(defaultParameters);
  const [committedParameters, setCommittedParameters] =
    useState<StrategyParameters>(defaultParameters);
  const [committedStrategy, setCommittedStrategy] = useState<StrategyId>("momentum");
  const [isRunning, setIsRunning] = useState(false);

  const result = useMemo(
    () => runBacktest(committedStrategy, committedParameters),
    [committedParameters, committedStrategy],
  );

  const allStrategyResults = useMemo(
    () =>
      strategies.map((strategy) => ({
        strategy,
        result: runBacktest(strategy.id, committedParameters),
      })),
    [committedParameters],
  );

  const currentStrategy =
    strategies.find((strategy) => strategy.id === committedStrategy) ?? strategies[0];
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  const activeView = pathViews[normalizedPath] ?? "overview";

  const handleRun = () => {
    setIsRunning(true);
    window.setTimeout(() => {
      setCommittedStrategy(selectedStrategy);
      setCommittedParameters({ ...parameters });
      setIsRunning(false);
    }, 420);
  };

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const verified = await verifyLogin();
        if (!cancelled) setAuthUser(verified.user);
      } catch {
        if (!cancelled) setAuthUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => setAuthUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setAuthUser(null);
    }
  }

  useEffect(() => {
    if (authUser) {
      void trading.refresh().catch(() => undefined);
    }
  }, [authUser, trading.refresh]);

  if (!authChecked) {
    return <LazyFallback />;
  }

  if (!authUser) {
    return <LoginPage onAuthenticated={setAuthUser} />;
  }

  const overview = (
    <div className="page-stack">
      <section className="overview-banner">
        <div>
          <span className="section-kicker">2026 年 7 月 11 日 · 模拟收盘</span>
          <h2>
            研究组合保持正向，
            <br />
            风险预算仍有余量。
          </h2>
          <p>
            当前运行 <strong>{currentStrategy.name}</strong>，结果基于固定种子模拟数据，
            不构成投资建议。
          </p>
        </div>
        <div className="banner-summary">
          <div>
            <span>组合权益</span>
            <strong>
              {trading.account
                ? new Intl.NumberFormat("zh-CN", {
                    style: "currency",
                    currency: "CNY",
                    maximumFractionDigits: 0,
                  }).format(trading.account.equity)
                : "等待连接"}
            </strong>
          </div>
          <div>
            <span>本期策略收益</span>
            <strong className="positive">{percent(result.metrics.totalReturn)}</strong>
          </div>
          <div>
            <span>风险状态</span>
            <strong className="risk-normal">正常</strong>
          </div>
        </div>
      </section>

      <section className="summary-grid">
        <article>
          <div className="summary-icon blue">
            <TrendingUp size={19} />
          </div>
          <span>年化收益</span>
          <strong>{percent(result.metrics.annualizedReturn)}</strong>
          <small>90 日确定性回测</small>
        </article>
        <article>
          <div className="summary-icon teal">
            <Gauge size={19} />
          </div>
          <span>夏普比率</span>
          <strong>{result.metrics.sharpe.toFixed(2)}</strong>
          <small>无风险利率暂按 0</small>
        </article>
        <article>
          <div className="summary-icon amber">
            <Activity size={19} />
          </div>
          <span>最大回撤</span>
          <strong className="negative">
            -{(result.metrics.maxDrawdown * 100).toFixed(2)}%
          </strong>
          <small>低于 12% 观察线</small>
        </article>
        <article>
          <div className="summary-icon violet">
            <Database size={19} />
          </div>
          <span>数据状态</span>
          <strong>模拟</strong>
          <small>最后更新 15:00</small>
        </article>
      </section>

      <Suspense fallback={<LazyFallback />}>
        <MarketOverview
          connectionState={trading.connectionState}
          market={trading.market}
        />
      </Suspense>

      <div className="two-column wide-left">
        <Suspense fallback={<LazyFallback />}>
          <BacktestResults compact result={result} />
        </Suspense>
        <Suspense fallback={<LazyFallback />}>
          <FlowPanel />
        </Suspense>
      </div>

      <div className="two-column">
        <Suspense fallback={<LazyFallback />}>
          <NewsPanel />
        </Suspense>
        <section className="panel watch-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">系统检查</span>
              <h2>研究环境</h2>
            </div>
            <CircleAlert size={20} />
          </div>
          <div className="watch-list">
            <div>
              <span className="status-dot" />
              <div>
                <strong>回测引擎</strong>
                <p>固定种子，可复现</p>
              </div>
              <span>正常</span>
            </div>
            <div>
              <span className="status-dot amber" />
              <div>
                <strong>行情数据</strong>
                <p>本地模拟快照</p>
              </div>
              <span>模拟</span>
            </div>
            <div>
              <span className="status-dot" />
              <div>
                <strong>订单执行</strong>
                <p>仅限本地撮合</p>
              </div>
              <span>隔离</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const strategy = (
    <div className="page-stack">
      <Suspense fallback={<LazyFallback />}>
        <StrategyLab
          isRunning={isRunning}
          onParameterChange={(key: string, value: number) =>
            setParameters((current) => ({ ...current, [key]: value }))
          }
          onReset={() => setParameters(defaultParameters)}
          onRun={handleRun}
          onStrategyChange={setSelectedStrategy}
          parameters={parameters}
          selectedStrategy={selectedStrategy}
        />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <BacktestResults result={result} />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <StrategyLeaderboard />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <StrategyRobustnessPanel />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <DailyQualityStocks />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <DailyCandidates />
      </Suspense>
      <Suspense fallback={<LazyFallback />}>
        <StrategyCompare results={allStrategyResults} />
      </Suspense>
    </div>
  );

  const market = (
    <Suspense fallback={<LazyFallback />}>
      <MarketPage trading={trading} />
    </Suspense>
  );

  const accountTabContent: Record<AccountTab, ReactNode> = {
    portfolio: (
      <Suspense fallback={<LazyFallback />}>
        <Portfolio
          equity={trading.account?.equity}
          market={trading.market}
          positions={trading.positions}
        />
      </Suspense>
    ),
    trading: (
      <Suspense fallback={<LazyFallback />}>
        <PaperAccount backend={trading} />
      </Suspense>
    ),
    strategies: <TradingStrategies />,
    orders: (
      <Suspense fallback={<LazyFallback />}>
        <OrderHistory
          orders={trading.orders}
          onCancelOrder={async (orderId: string) => {
            await trading.cancelOrder(orderId);
          }}
          pendingAction={trading.pendingAction}
        />
      </Suspense>
    ),
    risk: (
      <Suspense fallback={<LazyFallback />}>
        <RiskPanel account={trading.account} limits={trading.limits} />
      </Suspense>
    ),
    monitor: <SystemMonitor />,
    logs: (
      <Suspense fallback={<LazyFallback />}>
        <LogViewer />
      </Suspense>
    ),
  };

  const account = (
    <div className="page-stack">
      {trading.account && (
        <section className="panel account-hero-panel">
          <div className="account-hero-row">
            <div>
              <span className="section-kicker">{trading.account.accountId} · {trading.mode}</span>
              <h2>
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0,
                }).format(trading.account.equity)}
              </h2>
              <p>
                今日权益{" "}
                <strong
                  className={trading.account.dailyPnl >= 0 ? "positive" : "negative"}
                >
                  {trading.account.dailyPnl >= 0 ? "+" : ""}
                  {(trading.account.dailyPnlPercent * 100).toFixed(2)}%
                </strong>
                {" · "}可用 {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0,
                }).format(trading.account.cash)}
              </p>
            </div>
          </div>
        </section>
      )}

      <nav className="account-tabs" aria-label="账户子页面">
        {accountTabs.map((tab) => (
          <button
            className={accountTab === tab.id ? "account-tab active" : "account-tab"}
            key={tab.id}
            onClick={() => setAccountTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {accountTabContent[accountTab]}
    </div>
  );

  return (
    <>
      <OfflineBanner />
      <PwaInstallPrompt />
      <AppShell
        activeView={activeView}
        authEnabled
        authUser={authUser?.username}
        connectionState={trading.connectionState}
        marketDataProvider={trading.marketDataProvider}
        mode={trading.mode}
        onLogout={handleLogout}
        onViewChange={(view) => navigate(viewPaths[view])}
        realtimeState={trading.realtimeState}
      >
        <ErrorBoundary>
          <Routes>
            <Route element={overview} path="/" />
            <Route element={strategy} path="/strategy" />
            <Route element={market} path="/market" />
            <Route element={account} path="/account" />
            <Route
              element={
                <Suspense fallback={<LazyFallback />}>
                  <LearningPipeline />
                </Suspense>
              }
              path="/learning"
            />
            <Route
              element={
                <Suspense fallback={<LazyFallback />}>
                  <Settings />
                </Suspense>
              }
              path="/settings"
            />
            <Route element={<Navigate replace to="/" />} path="*" />
          </Routes>
        </ErrorBoundary>
      </AppShell>
    </>
  );
}

export default App;
