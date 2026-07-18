import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Newspaper,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { paginateItems } from "../lib/pagination";
import {
  fetchRealResearchDataFeed,
  type RealNewsCategory,
  type RealNewsItem,
  type RealResearchDataFeed,
} from "../lib/tradingApi";
import { ResearchQueryState } from "./ResearchQueryState";

const PAGE_SIZE = 10;
type NewsCategoryFilter = "all" | RealNewsCategory;

const sentimentLabels = {
  positive: "偏多",
  neutral: "中性",
  negative: "风险",
};

const categoryLabels: Record<NewsCategoryFilter, string> = {
  all: "全部",
  macro: "宏观",
  market: "市场",
  company: "个股",
};

const sourceStatusLabels: Record<RealResearchDataFeed["sourceStatus"], string> = {
  "live-read-only": "真实只读",
  "mock-disabled": "真实源未启用",
  degraded: "真实源降级",
};

function formatTime(value: string | null): string {
  if (!value) return "待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderNewsSymbols(item: RealNewsItem) {
  if (item.symbols.length === 0) {
    return <span>{item.category === "macro" ? "宏观" : "市场"}</span>;
  }
  return item.symbols.map((symbol) => <span key={symbol}>{symbol}</span>);
}

export function filterNewsItems(
  items: RealNewsItem[],
  category: NewsCategoryFilter,
): RealNewsItem[] {
  return category === "all"
    ? items
    : items.filter((item) => item.category === category);
}

export function NewsPanel() {
  const [category, setCategory] = useState<NewsCategoryFilter>("all");
  const [page, setPage] = useState(1);
  const realDataQuery = useQuery({
    queryKey: ["real-research-data-feed"],
    queryFn: fetchRealResearchDataFeed,
    refetchInterval: 180_000,
    staleTime: 120_000,
  });

  const feed = realDataQuery.data;
  const newsItems = feed?.news.items ?? [];
  const filteredNews = filterNewsItems(newsItems, category);
  const pagination = paginateItems(filteredNews, page, PAGE_SIZE);
  const warning = feed?.news.warning ?? feed?.globalMarkets.warning ?? null;
  const sourceCount = feed?.news.sources?.length ?? 0;
  const requestedSymbolCount = feed?.news.requestedSymbols?.length ?? 0;
  const deduplicatedCount = feed?.news.deduplicatedCount ?? 0;
  const categories: NewsCategoryFilter[] = ["all", "macro", "market", "company"];

  useEffect(() => {
    if (page !== pagination.page) setPage(pagination.page);
  }, [page, pagination.page]);

  return (
    <section className="panel news-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">事件流</span>
          <h2>真实新闻与外围市场</h2>
        </div>
        <div className="research-panel-actions">
          <span className="news-total-badge"><Newspaper size={14} />{newsItems.length} 条</span>
          <button
            aria-label="刷新真实新闻"
            className="icon-button"
            disabled={realDataQuery.isFetching}
            onClick={() => void realDataQuery.refetch()}
            title="刷新"
            type="button"
          >
            <RefreshCw className={realDataQuery.isFetching ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <div className="news-source-strip">
        <span className={`news-source-state state-${feed?.sourceStatus ?? "degraded"}`}>
          <RadioTower size={13} />
          {feed ? sourceStatusLabels[feed.sourceStatus] : "连接中"}
        </span>
        <small>
          {feed?.news.source ?? "读取中"} · 更新 {formatTime(feed?.news.fetchedAt ?? null)}
        </small>
      </div>

      <div className="news-coverage-strip">
        <div><span>有效新闻</span><strong>{newsItems.length}</strong></div>
        <div><span>来源覆盖</span><strong>{sourceCount}</strong></div>
        <div><span>观察标的</span><strong>{requestedSymbolCount}</strong></div>
        <div><span>重复过滤</span><strong>{deduplicatedCount}</strong></div>
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
        loadingText="正在读取多源真实新闻和全球市场数据…"
        unavailableText="真实新闻与外围市场暂不可用，请检查 API 与 AkShare 行情桥接。"
      />
      {warning && !realDataQuery.isError ? (
        <div className="news-warning">{warning}</div>
      ) : null}

      <div aria-label="新闻分类" className="news-category-tabs" role="group">
        {categories.map((item) => {
          const count = item === "all"
            ? newsItems.length
            : newsItems.filter((news) => news.category === item).length;
          return (
            <button
              aria-pressed={category === item}
              className={category === item ? "active" : ""}
              key={item}
              onClick={() => {
                setCategory(item);
                setPage(1);
              }}
              type="button"
            >
              <span>{categoryLabels[item]}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="news-list">
        {pagination.items.map((item) => (
          <article className="news-item" key={item.id}>
            <div className="news-meta">
              <span className={`news-category category-${item.category}`}>
                {categoryLabels[item.category]}
              </span>
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
              {item.url ? (
                <a
                  aria-label={`打开原文：${item.title}`}
                  className="news-source-link"
                  href={item.url}
                  rel="noreferrer"
                  target="_blank"
                  title="打开原文"
                >
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
          </article>
        ))}
        {!realDataQuery.isLoading && pagination.items.length === 0 ? (
          <div className="news-empty">
            当前分类暂未取到真实新闻；系统不会使用静态模拟新闻替代。
          </div>
        ) : null}
      </div>

      {filteredNews.length > 0 ? (
        <nav aria-label="新闻分页" className="research-pagination news-pagination">
          <span>
            显示 {pagination.rangeStart}-{pagination.rangeEnd}，共 {pagination.total} 条
          </span>
          <strong>第 {pagination.page} / {pagination.pageCount} 页</strong>
          <div>
            <button
              aria-label="新闻上一页"
              className="icon-button"
              disabled={pagination.page === 1}
              onClick={() => setPage(pagination.page - 1)}
              title="上一页"
              type="button"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              aria-label="新闻下一页"
              className="icon-button"
              disabled={pagination.page === pagination.pageCount}
              onClick={() => setPage(pagination.page + 1)}
              title="下一页"
              type="button"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
