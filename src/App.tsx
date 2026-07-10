import { useMemo, useState, type ReactNode } from "react";
import { Activity, CircleAlert, Database, Gauge, TrendingUp } from "lucide-react";
import { AppShell, type ViewId } from "./components/AppShell";
import { BacktestResults } from "./components/BacktestResults";
import { FlowPanel } from "./components/FlowPanel";
import { LearningPipeline } from "./components/LearningPipeline";
import { MarketChart } from "./components/MarketChart";
import { MarketOverview } from "./components/MarketOverview";
import { NewsPanel } from "./components/NewsPanel";
import { PaperAccount } from "./components/PaperAccount";
import { StrategyLab } from "./components/StrategyLab";
import { strategies } from "./data/mockData";
import { runBacktest } from "./lib/backtest";
import type { StrategyId, StrategyParameters } from "./types";

const defaultParameters: StrategyParameters = {
  lookback: 20,
  entryThreshold: 1.4,
  stopLoss: 6,
  takeProfit: 15,
  maxPosition: 35,
  rebalanceDays: 5,
};

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
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

  const currentStrategy =
    strategies.find((strategy) => strategy.id === committedStrategy) ?? strategies[0];

  const handleRun = () => {
    setIsRunning(true);
    window.setTimeout(() => {
      setCommittedStrategy(selectedStrategy);
      setCommittedParameters({ ...parameters });
      setIsRunning(false);
    }, 420);
  };

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
            <strong>¥1,286,420</strong>
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

      <MarketOverview />

      <div className="two-column wide-left">
        <BacktestResults compact result={result} />
        <FlowPanel />
      </div>

      <div className="two-column">
        <NewsPanel />
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
      <StrategyLab
        isRunning={isRunning}
        onParameterChange={(key, value) =>
          setParameters((current) => ({ ...current, [key]: value }))
        }
        onReset={() => setParameters(defaultParameters)}
        onRun={handleRun}
        onStrategyChange={setSelectedStrategy}
        parameters={parameters}
        selectedStrategy={selectedStrategy}
      />
      <BacktestResults result={result} />
    </div>
  );

  const market = (
    <div className="page-stack">
      <MarketOverview />
      <div className="two-column wide-left">
        <MarketChart />
        <FlowPanel />
      </div>
      <NewsPanel />
    </div>
  );

  const views: Record<ViewId, ReactNode> = {
    overview,
    strategy,
    market,
    account: <PaperAccount />,
    learning: <LearningPipeline />,
  };

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView}>
      {views[activeView]}
    </AppShell>
  );
}

export default App;
