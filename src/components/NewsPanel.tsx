import { ExternalLink, Newspaper } from "lucide-react";
import { newsItems } from "../data/mockData";

const sentimentLabels = {
  positive: "偏多",
  neutral: "中性",
  negative: "风险",
};

export function NewsPanel() {
  return (
    <section className="panel news-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">事件流</span>
          <h2>市场新闻</h2>
        </div>
        <Newspaper size={20} />
      </div>
      <div className="news-list">
        {newsItems.map((item) => (
          <article className="news-item" key={item.id}>
            <div className="news-meta">
              <span>{item.source}</span>
              <time>{item.time}</time>
              <span className={`sentiment ${item.sentiment}`}>
                {sentimentLabels[item.sentiment]}
              </span>
            </div>
            <h3>{item.title}</h3>
            <div className="news-symbols">
              {item.symbols.map((symbol) => (
                <span key={symbol}>{symbol}</span>
              ))}
              <ExternalLink size={14} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
