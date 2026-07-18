import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Newspaper, RadioTower } from "lucide-react";
import {
  fetchRealResearchDataFeed,
  type RealNewsItem,
  type RealResearchDataFeed,
} from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

const sentimentLabels = {
  positive: "偏多",
  neutral: "中性",
  negative: "风险",
};

const sourceStatusLabels: Record<RealResearchDataFeed["sourceStatus"], string> = {
  "live-read-only": "真实只读",
  "mock-disabled": "真实源未启用",
  degraded: "真实源降级",
};

function formatTime(value: string | null): string {
  if (!value) return "待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderNewsSymbols(item: RealNewsItem) {
  if (item.symbols.length === 0) {
    return <span>宏观/市场</span>;
  }
  return item.symbols.map((symbol) => <span key={symbol}>{symbol}</span>);
}

export function NewsPanel() {
  const realDataQuery = useQuery({
    queryKey: ["real-research-data-feed"],
    queryFn: fetchRealResearchDataFeed,
    refetchInterval: 180_000,
    staleTime: 120_000,
  });

  const feed = realDataQuery.data;
  const newsItems = feed?.news.items ?? [];
  const visibleNews = newsItems.slice(0, 5);
  const warning = feed?.news.warning ?? feed?.globalMarkets.warning ?? null;

  return (
    <section className="panel news-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">事件流</span>
          <h2>真实新闻与外围市场</h2>
        </div>
        <Newspaper size={20} />
      </div>
      <div className="news-source-strip">
        <span className={`news-source-state state-${feed?.sourceStatus ?? "degraded"}`}>
          <RadioTower size={13} />
          {feed ? sourceStatusLabels[feed.sourceStatus] : "连接中"}
        </span>
        <small>
          新闻源 {feed?.news.source ?? "读取中"} · 更新 {formatTime(feed?.news.fetchedAt ?? null)}
        </small>
      </div>
      {feed?.impact.summary ? (
        <div className={`global-impact impact-${feed.impact.direction}`}>
          <strong>外围影响 {feed.impact.score.toFixed(2)}</strong>
          <p>{feed.impact.summary}</p>
          {feed.impact.drivers.length > 0 ? (
            <div className="global-impact-drivers">
              {feed.impact.drivers.map((driver) => (
                <span key={driver}>{driver}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <ResearchQueryState
        dataUpdatedAt={realDataQuery.dataUpdatedAt}
        hasData={Boolean(feed)}
        isError={realDataQuery.isError}
        isLoading={realDataQuery.isLoading}
        loadingText="正在读取真实新闻和全球市场数据…"
        unavailableText="真实新闻与外围市场暂不可用，请检查 API 与 AkShare 行情桥接。"
      />
      {warning && !realDataQuery.isError ? (
        <div className="news-warning">{warning}</div>
      ) : null}
      <div className="news-list">
        {visibleNews.map((item) => (
          <article className="news-item" key={item.id}>
            <div className="news-meta">
              <span>{item.source}</span>
              <time>{formatTime(item.publishedAt)}</time>
              <span className={`sentiment ${item.sentiment}`}>
                {sentimentLabels[item.sentiment]}
              </span>
            </div>
            <h3>{item.title}</h3>
            {item.summary ? <p>{item.summary}</p> : null}
            <div className="news-symbols">
              {renderNewsSymbols(item)}
              {item.url ? <ExternalLink size={14} /> : null}
            </div>
          </article>
        ))}
        {!realDataQuery.isLoading && visibleNews.length === 0 ? (
          <div className="news-empty">
            暂未取到真实新闻；系统不会使用静态模拟新闻替代真实来源。
          </div>
        ) : null}
      </div>
    </section>
  );
}
