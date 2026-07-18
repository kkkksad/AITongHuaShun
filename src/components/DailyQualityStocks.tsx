import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, Star } from "lucide-react";
import { fetchDailyQualityStocks } from "../lib/tradingApi";
import type { DailyQualityStock, QualityStockAction } from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmount(value: number | null): string {
  if (!value || !Number.isFinite(value)) return "未提供";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

function actionLabel(action: QualityStockAction): string {
  if (action === "focus") return "重点观察";
  if (action === "watch") return "观察";
  return "回避";
}

function actionClass(action: QualityStockAction): string {
  if (action === "focus") return "gate-pass";
  if (action === "watch") return "gate-caution";
  return "gate-blocked";
}

function styleLabel(style: DailyQualityStock["style"]): string {
  const labels = {
    core: "核心稳健",
    growth: "成长观察",
    momentum: "强势动量",
    defensive: "防守低波",
  };
  return labels[style];
}

function primaryReason(stock: DailyQualityStock): string {
  return stock.reasons[0] ?? stock.riskFlags[0] ?? "等待更多数据确认。";
}

export function DailyQualityStocks() {
  const qualityQuery = useQuery({
    queryKey: ["daily-quality-stocks", 30],
    queryFn: () => fetchDailyQualityStocks(30),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const report = qualityQuery.data;
  const stocks = report?.stocks ?? [];
  const focusCount = stocks.filter((stock) => stock.action === "focus").length;

  return (
    <section className="panel daily-quality-stocks">
      <div className="panel-header">
        <div>
          <span className="section-kicker">每日优质股</span>
          <h2>真实行情优先观察池</h2>
        </div>
        <button
          aria-label="刷新每日优质股"
          className="icon-button"
          disabled={qualityQuery.isFetching}
          onClick={() => void qualityQuery.refetch()}
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <ResearchQueryState
        dataUpdatedAt={qualityQuery.dataUpdatedAt}
        hasData={Boolean(report)}
        isError={qualityQuery.isError}
        isLoading={qualityQuery.isLoading}
        loadingText="正在计算每日优质股评分…"
        unavailableText="每日优质股暂时不可用，请确认后端服务和行情桥接已启动。"
      />

      {report && (
        <>
          <div className="research-summary-grid">
            <article>
              <span>数据来源</span>
              <strong>{report.source.provider}</strong>
              <small>
                {report.methodology.dataScope.realtimeQuote ? "真实只读行情" : "模拟行情"}
              </small>
            </article>
            <article>
              <span>重点观察</span>
              <strong>{focusCount}</strong>
              <small>{stocks.length} 个入选标的</small>
            </article>
            <article>
              <span>历史验证</span>
              <strong>{report.methodology.dataScope.historicalBars ? "已接入" : "待接入"}</strong>
              <small>同花顺/授权历史数据下一步接入</small>
            </article>
            <article>
              <span>刷新频率</span>
              <strong>60s</strong>
              <small>只读扫描，不会真实下单</small>
            </article>
          </div>

          <div className="research-alert">
            <ShieldCheck size={16} />
            <span>{report.guardrails[0]}</span>
          </div>

          <div className="compare-ranking-table-wrapper">
            <table className="data-table research-ranking-table">
              <thead>
                <tr>
                  <th>排名</th>
                  <th>标的</th>
                  <th>等级</th>
                  <th>现价</th>
                  <th>涨跌幅</th>
                  <th>成交额</th>
                  <th>评分</th>
                  <th>动作</th>
                  <th>风格</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr key={stock.symbol}>
                    <td>
                      <span className={`rank-badge rank-${stock.rank}`}>
                        {stock.rank}
                      </span>
                    </td>
                    <td className="symbol-cell">
                      <strong>{stock.name}</strong>
                      <span className="table-subline">{stock.symbol}</span>
                    </td>
                    <td>
                      <span className={`rank-badge grade-${stock.grade.toLowerCase()}`}>
                        <Star size={13} />
                        {stock.grade}
                      </span>
                    </td>
                    <td>{formatPrice(stock.price)}</td>
                    <td className={stock.changePercent >= 0 ? "positive" : "negative"}>
                      {formatPercent(stock.changePercent / 100)}
                    </td>
                    <td>{formatAmount(stock.amount)}</td>
                    <td>
                      <strong>{stock.score.toFixed(1)}</strong>
                      <span className="table-subline">
                        流动性 {stock.factors.liquidity.toFixed(0)}
                      </span>
                    </td>
                    <td>
                      <span className={`rank-badge ${actionClass(stock.action)}`}>
                        {actionLabel(stock.action)}
                      </span>
                    </td>
                    <td>{styleLabel(stock.style)}</td>
                    <td className="research-params">
                      {primaryReason(stock)}
                      {stock.riskFlags.length > 0 && (
                        <span className="table-subline negative">
                          {stock.riskFlags[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="research-source-row">
            <Star size={15} />
            <span>
              生成时间 {new Date(report.generatedAt).toLocaleString("zh-CN")} ·
              快照序号 {report.source.snapshotSequence} · {report.autoUpdate.qualityRefresh}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
