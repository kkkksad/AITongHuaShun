import { useMemo, useState } from "react";
import { Activity, CircleAlert, Database, Gauge, TrendingUp } from "lucide-react";
import { BacktestResults } from "../components/BacktestResults";
import { FlowPanel } from "../components/FlowPanel";
import { MarketOverview } from "../components/MarketOverview";
import { NewsPanel } from "../components/NewsPanel";
import { strategies } from "../data/mockData";
import { runBacktest } from "../lib/backtest";
import type { StrategyId, StrategyParameters } from "../types";
import type { TradingBackend } from "../hooks/useTradingBackend";

interface OverviewPageProps {
  trading: TradingBackend;
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export default function OverviewPage({ trading }: OverviewPageProps) {
  const [committedStrategy] = useState<StrategyId>("momentum");
  const [committedParameters] = useState<StrategyParameters>({
    lookback: 20,
    entryThreshold: 1.4,
    stopLoss: 6,
    takeProfit: 15,
    maxPosition: 35,
    rebalanceDays: 5,
  });

  const result = useMemo(
    () => runBacktest(committedStrategy, committedParameters),
    [committedParameters, committedStrategy],
  );

  const currentStrategy =
    strategies.find((strategy) => strategy.id === committedStrategy) ?? strategies[0];

  return (
    <div className="page-stack">
      <section className="overview-banner">
        <div>
          <span className="section-kicker">2026 \u5E74 7 \u6708 11 \u65E5 \u00B7 \u6A21\u62DF\u6536\u76D8</span>
          <h2>
            \u7814\u7A76\u7EC4\u5408\u4FDD\u6301\u6B63\u5411\uFF0C
            <br />
            \u98CE\u9669\u9884\u7B97\u4ECD\u6709\u4F59\u91CF\u3002
          </h2>
          <p>
            \u5F53\u524D\u8FD0\u884C <strong>{currentStrategy.name}</strong>\uFF0C\u7ED3\u679C\u57FA\u4E8E\u56FA\u5B9A\u79CD\u5B50\u6A21\u62DF\u6570\u636E\uFF0C
            \u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002
          </p>
        </div>
        <div className="banner-summary">
          <div>
            <span>\u7EC4\u5408\u6743\u76CA</span>
            <strong>
              {trading.account
                ? new Intl.NumberFormat("zh-CN", {
                    style: "currency",
                    currency: "CNY",
                    maximumFractionDigits: 0,
                  }).format(trading.account.equity)
                : "\u7B49\u5F85\u8FDE\u63A5"}
            </strong>
          </div>
          <div>
            <span>\u672C\u671F\u7B56\u7565\u6536\u76CA</span>
            <strong className="positive">{percent(result.metrics.totalReturn)}</strong>
          </div>
          <div>
            <span>\u98CE\u9669\u72B6\u6001</span>
            <strong className="risk-normal">\u6B63\u5E38</strong>
          </div>
        </div>
      </section>

      <section className="summary-grid">
        <article>
          <div className="summary-icon blue">
            <TrendingUp size={19} />
          </div>
          <span>\u5E74\u5316\u6536\u76CA</span>
          <strong>{percent(result.metrics.annualizedReturn)}</strong>
          <small>90 \u65E5\u786E\u5B9A\u6027\u56DE\u6D4B</small>
        </article>
        <article>
          <div className="summary-icon teal">
            <Gauge size={19} />
          </div>
          <span>\u590F\u666E\u6BD4\u7387</span>
          <strong>{result.metrics.sharpe.toFixed(2)}</strong>
          <small>\u65E0\u98CE\u9669\u5229\u7387\u6682\u6309 0</small>
        </article>
        <article>
          <div className="summary-icon amber">
            <Activity size={19} />
          </div>
          <span>\u6700\u5927\u56DE\u64A4</span>
          <strong className="negative">
            -{(result.metrics.maxDrawdown * 100).toFixed(2)}%
          </strong>
          <small>\u4F4E\u4E8E 12% \u89C2\u5BDF\u7EBF</small>
        </article>
        <article>
          <div className="summary-icon violet">
            <Database size={19} />
          </div>
          <span>\u6570\u636E\u72B6\u6001</span>
          <strong>\u6A21\u62DF</strong>
          <small>\u6700\u540E\u66F4\u65B0 15:00</small>
        </article>
      </section>

      <MarketOverview
        connectionState={trading.connectionState}
        market={trading.market}
      />

      <div className="two-column wide-left">
        <BacktestResults compact result={result} />
        <FlowPanel />
      </div>

      <div className="two-column">
        <NewsPanel />
        <section className="panel watch-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">\u7CFB\u7EDF\u68C0\u67E5</span>
              <h2>\u7814\u7A76\u73AF\u5883</h2>
            </div>
            <CircleAlert size={20} />
          </div>
          <div className="watch-list">
            <div>
              <span className="status-dot" />
              <div>
                <strong>\u56DE\u6D4B\u5F15\u64CE</strong>
                <p>\u56FA\u5B9A\u79CD\u5B50\uFF0C\u53EF\u590D\u73B0</p>
              </div>
              <span>\u6B63\u5E38</span>
            </div>
            <div>
              <span className="status-dot amber" />
              <div>
                <strong>\u884C\u60C5\u6570\u636E</strong>
                <p>\u672C\u5730\u6A21\u62DF\u5FEB\u7167</p>
              </div>
              <span>\u6A21\u62DF</span>
            </div>
            <div>
              <span className="status-dot" />
              <div>
                <strong>\u8BA2\u5355\u6267\u884C</strong>
                <p>\u4EC5\u9650\u672C\u5730\u64AE\u5408</p>
              </div>
              <span>\u9694\u79BB</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
