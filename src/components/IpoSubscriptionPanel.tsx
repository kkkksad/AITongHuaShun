import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  fetchIpoSubscriptionResearch,
  type IpoRecommendation,
  type IpoSubscriptionResearchItem,
} from "../lib/tradingApi";

type IpoView = "subscribe" | "awaiting" | "listed";

const recommendationLabels: Record<IpoRecommendation, string> = {
  consider: "可关注申购",
  cautious: "谨慎申购",
  avoid: "暂不参与",
  "wait-for-pricing": "等待定价",
  closed: "申购已结束",
};

function recommendationClass(value: IpoRecommendation): string {
  if (value === "consider") return "gate-pass";
  if (value === "avoid") return "gate-blocked";
  return "gate-caution";
}

function statusLabel(item: IpoSubscriptionResearchItem): string {
  if (item.status === "open-today") return "今日申购";
  if (item.status === "upcoming") return "即将申购";
  if (item.status === "awaiting-listing") return "等待上市";
  return "近期上市";
}

function formatDate(value: string | null): string {
  if (!value) return "待公布";
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function formatPrice(value: number | null): string {
  return value === null ? "待定" : `${value.toFixed(2)} 元`;
}

function formatPe(item: IpoSubscriptionResearchItem): string {
  if (item.issuePe === null || item.industryPe === null) return "待披露";
  return `${item.issuePe.toFixed(1)} / ${item.industryPe.toFixed(1)}`;
}

function formatMarketValue(value: number | null): string {
  if (value === null) return "待披露";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万`;
}

function itemsForView(
  items: IpoSubscriptionResearchItem[],
  view: IpoView,
): IpoSubscriptionResearchItem[] {
  if (view === "subscribe") {
    return items.filter((item) =>
      item.status === "open-today" || item.status === "upcoming"
    );
  }
  if (view === "awaiting") {
    return items.filter((item) => item.status === "awaiting-listing");
  }
  return items.filter((item) => item.status === "listed-recently");
}

export function IpoSubscriptionPanel() {
  const [view, setView] = useState<IpoView>("subscribe");
  const ipoQuery = useQuery({
    queryKey: ["ipo-subscriptions", 40],
    queryFn: () => fetchIpoSubscriptionResearch(40),
    refetchInterval: 30 * 60_000,
    staleTime: 15 * 60_000,
  });
  const report = ipoQuery.data;
  const visibleItems = report ? itemsForView(report.items, view) : [];

  return (
    <section className="panel ipo-subscription-panel">
      <div className="panel-header ipo-panel-header">
        <div>
          <span className="section-kicker">真实发行数据</span>
          <h2>新股申购与近期上市</h2>
        </div>
        <button
          aria-label="刷新新股申购研究"
          className="icon-button"
          disabled={ipoQuery.isFetching}
          onClick={() => void ipoQuery.refetch()}
          title="刷新"
          type="button"
        >
          <RefreshCw className={ipoQuery.isFetching ? "spin" : ""} size={17} />
        </button>
      </div>

      <div className="regime-tabs ipo-tabs" role="tablist" aria-label="新股研究视图">
        <button
          aria-selected={view === "subscribe"}
          className={view === "subscribe" ? "active" : ""}
          onClick={() => setView("subscribe")}
          role="tab"
          type="button"
        >
          <CalendarCheck size={15} />
          可申购
        </button>
        <button
          aria-selected={view === "awaiting"}
          className={view === "awaiting" ? "active" : ""}
          onClick={() => setView("awaiting")}
          role="tab"
          type="button"
        >
          <CalendarClock size={15} />
          待上市
        </button>
        <button
          aria-selected={view === "listed"}
          className={view === "listed" ? "active" : ""}
          onClick={() => setView("listed")}
          role="tab"
          type="button"
        >
          <ShieldCheck size={15} />
          近期上市
        </button>
      </div>

      {ipoQuery.isLoading && (
        <div className="research-empty">正在读取真实新股申购与上市数据…</div>
      )}

      {ipoQuery.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>新股研究暂不可用，请检查 API 与 AkShare 行情桥接。</span>
        </div>
      )}

      {report && (
        <>
          <div className="regime-meta-strip ipo-meta-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "降级"}</strong>
            </div>
            <div>
              <span>今日申购</span>
              <strong>{report.counts.openToday}</strong>
            </div>
            <div>
              <span>即将申购</span>
              <strong>{report.counts.upcoming}</strong>
            </div>
            <div>
              <span>等待上市</span>
              <strong>{report.counts.awaitingListing}</strong>
            </div>
            <div>
              <span>近期上市</span>
              <strong>{report.counts.listedRecently}</strong>
            </div>
          </div>

          {report.warning && (
            <div className="research-alert ipo-warning">
              <AlertTriangle size={16} />
              <span>{report.warning}</span>
            </div>
          )}

          {report.sourceStatus === "live-read-only" && (
            <div className="research-alert regime-source-ok ipo-methodology">
              <ShieldCheck size={16} />
              <span>{report.methodology.recommendationMeaning}</span>
            </div>
          )}

          <div className="ipo-table-wrap" role="tabpanel">
            {visibleItems.length === 0 ? (
              <div className="research-empty">当前时间窗口没有对应的新股记录。</div>
            ) : (
              <table className="data-table ipo-table">
                <thead>
                  <tr>
                    <th>新股</th>
                    <th>状态 / 日期</th>
                    <th>发行价</th>
                    <th>发行 PE / 行业 PE</th>
                    <th>顶格市值</th>
                    <th>研究结论</th>
                    <th>依据 / 风险</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={`${item.symbol}-${item.status}`}>
                      <td className="symbol-cell">
                        <strong>{item.name}</strong>
                        <span className="table-subline">
                          {item.symbol} · 申购 {item.subscriptionCode} · {item.board}
                        </span>
                      </td>
                      <td>
                        <strong>{statusLabel(item)}</strong>
                        <span className="table-subline">
                          申购 {formatDate(item.subscriptionDate)}
                        </span>
                        {(item.listingDate || item.status === "awaiting-listing") && (
                          <span className="table-subline">
                            上市 {formatDate(item.listingDate)}
                          </span>
                        )}
                      </td>
                      <td>
                        {formatPrice(item.issuePrice)}
                        {item.latestPrice !== null && (
                          <span className="table-subline">最新 {formatPrice(item.latestPrice)}</span>
                        )}
                      </td>
                      <td>
                        {formatPe(item)}
                        <span className="table-subline">发行 / 行业</span>
                      </td>
                      <td>
                        {formatMarketValue(item.marketValueRequirementWan)}
                        {item.maxSubscriptionShares !== null && (
                          <span className="table-subline">
                            上限 {item.maxSubscriptionShares.toLocaleString("zh-CN")} 股
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`rank-badge ${recommendationClass(item.recommendation)}`}>
                          {recommendationLabels[item.recommendation]}
                        </span>
                        {item.score !== null && (
                          <span className="table-subline">规则分 {item.score.toFixed(0)} / 100</span>
                        )}
                      </td>
                      <td className="ipo-reason-cell">
                        {item.reasons[0] ?? "暂无完整判断"}
                        {item.risks[0] && (
                          <span className="table-subline negative">{item.risks[0]}</span>
                        )}
                        {item.firstDayChangePercent !== null && item.status === "listed-recently" && (
                          <span className={item.firstDayChangePercent >= 0 ? "table-subline positive" : "table-subline negative"}>
                            上市后公开涨幅 {item.firstDayChangePercent >= 0 ? "+" : ""}{item.firstDayChangePercent.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="research-source-row">
            <ShieldCheck size={15} />
            <span>
              {report.source} · 更新 {report.fetchedAt
                ? new Date(report.fetchedAt).toLocaleString("zh-CN")
                : "未知"} · 仅用于研究，不连接券商申购
            </span>
          </div>
        </>
      )}
    </section>
  );
}
