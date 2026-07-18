import { useEffect, useMemo, useState, type ReactNode, lazy, Suspense } from "react";
import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  CircleAlert,
  ClipboardList,
  Database,
  FlaskConical,
  ChartPie,
  BookOpenCheck,
  Landmark,
  MonitorCog,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
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

function currency(value?: number): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

const accountTabGroups = [
  {
    label: "资产与交易",
    tabs: [
      { id: "portfolio" as const, label: "持仓", icon: ChartPie },
      { id: "trading" as const, label: "下单", icon: ShoppingCart },
      { id: "orders" as const, label: "订单", icon: ClipboardList },
      { id: "risk" as const, label: "风控", icon: ShieldCheck },
    ],
  },
  {
    label: "研究与系统",
    tabs: [
      { id: "strategies" as const, label: "策略", icon: BookOpenCheck },
      { id: "monitor" as const, label: "监控", icon: MonitorCog },
      { id: "logs" as const, label: "日志", icon: ScrollText },
    ],
  },
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
  const orderSymbolNames = useMemo(() => new Map([
    ...(trading.market?.quotes ?? []).map((quote) => [quote.symbol, quote.name] as const),
    ...trading.positions.map((position) => [position.symbol, position.name] as const),
  ]), [trading.market, trading.positions]);

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

  const pendingOrderCount = trading.orders.filter((order) => order.status === "pending").length;
  const investedRatio = trading.account && trading.account.equity > 0
    ? trading.account.marketValue / trading.account.equity
    : 0;
  const marketAsOf = trading.market?.marketTime
    ? new Date(trading.market.marketTime).toLocaleString("zh-CN", { hour12: false })
    : "尚未取得行情时间";
  const providerLabel = trading.marketDataProvider === "akshare"
    ? "AkShare 真实只读"
    : "本地模拟";

  const overview = (
    <div className="page-stack">
      <section className="overview-banner">
        <div className="overview-command">
          <span className="section-kicker">{marketAsOf}</span>
          <h2>今日研究与模拟账户</h2>
          <p>
            {providerLabel} · {trading.mode} · 真实交易关闭
          </p>
          {trading.error && (
            <p className="overview-status-note" role="status">
              {trading.connectionState === "connected" ? "最近状态" : "连接异常"}：{trading.error}
            </p>
          )}
          <div className="overview-actions" aria-label="核心工作流">
            <button onClick={() => navigate("/market")} type="button">
              <ChartNoAxesCombined size={16} /><span>市场研判</span><ArrowRight size={14} />
            </button>
            <button onClick={() => { setAccountTab("trading"); navigate("/account"); }} type="button">
              <ShoppingCart size={16} /><span>模拟下单</span><ArrowRight size={14} />
            </button>
            <button onClick={() => { setAccountTab("orders"); navigate("/account"); }} type="button">
              <ClipboardList size={16} /><span>订单复核</span><ArrowRight size={14} />
            </button>
            <button onClick={() => navigate("/strategy")} type="button">
              <FlaskConical size={16} /><span>策略验证</span><ArrowRight size={14} />
            </button>
          </div>
        </div>
        <div className="banner-summary">
          <div>
            <span>后端</span>
            <strong>{trading.connectionState === "connected" ? "已连接" : trading.connectionState === "connecting" ? "连接中" : "离线"}</strong>
          </div>
          <div>
            <span>持仓 / 仓位</span>
            <strong>{trading.positions.length} 只 / {(investedRatio * 100).toFixed(0)}%</strong>
          </div>
          <div>
            <span>待处理挂单</span>
            <strong>{pendingOrderCount}</strong>
          </div>
        </div>
      </section>

      <section className="summary-grid">
        <article>
          <div className="summary-icon blue">
            <WalletCards size={19} />
          </div>
          <span>Paper 权益</span>
          <strong>{currency(trading.account?.equity)}</strong>
          <small>{trading.account?.accountId ?? "等待账户快照"}</small>
        </article>
        <article>
          <div className="summary-icon teal">
            <Landmark size={19} />
          </div>
          <span>可用现金</span>
          <strong>{currency(trading.account?.cash)}</strong>
          <small>{pendingOrderCount} 笔挂单占用资金</small>
        </article>
        <article>
          <div className="summary-icon amber">
            <Activity size={19} />
          </div>
          <span>今日 Paper 盈亏</span>
          <strong className={(trading.account?.dailyPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {currency(trading.account?.dailyPnl)}
          </strong>
          <small>{trading.account ? percent(trading.account.dailyPnlPercent) : "等待账户快照"}</small>
        </article>
        <article>
          <div className="summary-icon violet">
            <Database size={19} />
          </div>
          <span>数据状态</span>
          <strong>{providerLabel}</strong>
          <small>{marketAsOf}</small>
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
              <span
                className={
                  trading.connectionState !== "connected"
                    ? "status-dot red"
                    : trading.marketDataProvider === "akshare"
                      ? "status-dot"
                      : "status-dot amber"
                }
              />
              <div>
                <strong>行情数据</strong>
                <p>
                  {trading.connectionState !== "connected"
                    ? "等待后端与行情快照"
                    : trading.marketDataProvider === "akshare"
                      ? `AkShare 只读 · ${marketAsOf}`
                      : "本地确定性模拟快照"}
                </p>
              </div>
              <span>
                {trading.connectionState !== "connected"
                  ? "离线"
                  : trading.marketDataProvider === "akshare"
                    ? "真实只读"
                    : "模拟"}
              </span>
            </div>
            <div>
              <span className="status-dot" />
              <div>
                <strong>订单执行</strong>
                <p>PaperBroker 本地撮合，真实订单关闭</p>
              </div>
              <span>Paper</span>
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
          symbolNames={orderSymbolNames}
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
        {accountTabGroups.map((group) => (
          <div className="account-tab-group" key={group.label}>
            <span className="account-tab-group-label">{group.label}</span>
            <div className="account-tab-buttons">
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    className={accountTab === tab.id ? "account-tab active" : "account-tab"}
                    key={tab.id}
                    onClick={() => setAccountTab(tab.id)}
                    type="button"
                  >
                    <Icon size={15} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
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
