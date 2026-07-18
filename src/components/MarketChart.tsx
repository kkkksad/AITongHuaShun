import { BarChart3, CircleDollarSign, Gauge, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketQuote, MarketSnapshot } from "../../shared/trading";
import { intradayData } from "../data/mockData";

interface MarketChartProps {
  market?: MarketSnapshot;
}

function findPrimaryIndex(market?: MarketSnapshot): MarketQuote | undefined {
  return market?.quotes.find((quote) => quote.symbol === "SH000001")
    ?? market?.quotes.find((quote) => !quote.tradable && quote.price > 0);
}

export function buildIndexSnapshotData(index?: MarketQuote) {
  return index ? [] : intradayData;
}

function finitePrice(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function boundedPosition(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 50;
  return Math.min(100, Math.max(0, ((value - minimum) / (maximum - minimum)) * 100));
}

export function buildIndexRangeSnapshot(index: MarketQuote) {
  const latest = finitePrice(index.price, index.previousClose);
  const previousClose = finitePrice(index.previousClose, latest);
  const open = finitePrice(index.open, previousClose);
  const low = finitePrice(index.low, latest);
  const high = finitePrice(index.high, latest);
  const rangeMinimum = Math.min(low, open, latest, previousClose);
  const rangeMaximum = Math.max(high, open, latest, previousClose);

  return {
    previousClose,
    open,
    low,
    latest,
    high,
    changePercent: index.changePercent,
    amountBillions: index.amount && index.amount > 0
      ? index.amount / 100_000_000
      : null,
    latestDayRangePercent: boundedPosition(latest, low, high),
    markers: {
      previousClose: boundedPosition(previousClose, rangeMinimum, rangeMaximum),
      open: boundedPosition(open, rangeMinimum, rangeMaximum),
      latest: boundedPosition(latest, rangeMinimum, rangeMaximum),
    },
  };
}

export function buildPriceDomain(data: Array<{ price: number; average: number }>): [number, number] {
  const values = data.flatMap((point) => [point.price, point.average]).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return [3480, 3545];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.15, max * 0.003);
  return [Number((min - padding).toFixed(2)), Number((max + padding).toFixed(2))];
}

function formatAsOf(value?: string): string {
  if (!value) {
    return "静态演示";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function MarketChart({ market }: MarketChartProps) {
  const primaryIndex = findPrimaryIndex(market);
  const asOf = formatAsOf(primaryIndex?.updatedAt ?? market?.marketTime);

  if (primaryIndex) {
    const snapshot = buildIndexRangeSnapshot(primaryIndex);
    const isPositive = snapshot.changePercent >= 0;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;
    const priceClass = isPositive ? "positive" : "negative";

    return (
      <section className="panel market-chart-panel market-range-panel">
        <div className="panel-header market-range-header">
          <div>
            <span className="section-kicker">{primaryIndex.symbol} · {asOf}</span>
            <h2>{primaryIndex.name} 日内区间</h2>
          </div>
          <span className="market-snapshot-badge"><Gauge size={15} /> 行情快照</span>
        </div>

        <div className="market-range-summary">
          <div className="market-range-price">
            <span>最新点位</span>
            <strong>{snapshot.latest.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong>
            <small className={priceClass}>
              <TrendIcon size={15} />
              {snapshot.changePercent >= 0 ? "+" : ""}{snapshot.changePercent.toFixed(2)}%
            </small>
          </div>
          <div className="market-range-position">
            <span>日内位置</span>
            <strong>{snapshot.latestDayRangePercent.toFixed(0)}%</strong>
            <small>0% 为日内最低，100% 为日内最高</small>
          </div>
        </div>

        <div className="market-range-visual" aria-label={`${primaryIndex.name}日内价格区间`}>
          <div className="market-range-scale">
            <span>低 {snapshot.low.toFixed(2)}</span>
            <span>高 {snapshot.high.toFixed(2)}</span>
          </div>
          <div className="market-range-track">
            <span className="market-range-fill" style={{ width: `${snapshot.markers.latest}%` }} />
            <span
              aria-label={`昨收 ${snapshot.previousClose.toFixed(2)}`}
              className="market-range-marker previous"
              style={{ left: `${snapshot.markers.previousClose}%` }}
              title={`昨收 ${snapshot.previousClose.toFixed(2)}`}
            />
            <span
              aria-label={`今开 ${snapshot.open.toFixed(2)}`}
              className="market-range-marker open"
              style={{ left: `${snapshot.markers.open}%` }}
              title={`今开 ${snapshot.open.toFixed(2)}`}
            />
            <span
              aria-label={`最新 ${snapshot.latest.toFixed(2)}`}
              className={`market-range-marker latest ${priceClass}`}
              style={{ left: `${snapshot.markers.latest}%` }}
              title={`最新 ${snapshot.latest.toFixed(2)}`}
            />
          </div>
          <div className="market-range-legend">
            <span><i className="previous" />昨收</span>
            <span><i className="open" />今开</span>
            <span><i className={`latest ${priceClass}`} />最新</span>
          </div>
        </div>

        <div className="market-range-metrics">
          <div><span>昨收</span><strong>{snapshot.previousClose.toFixed(2)}</strong></div>
          <div><span>今开</span><strong>{snapshot.open.toFixed(2)}</strong></div>
          <div><span>振幅区间</span><strong>{snapshot.low.toFixed(2)} - {snapshot.high.toFixed(2)}</strong></div>
          <div>
            <span><CircleDollarSign size={13} /> 成交额</span>
            <strong>{snapshot.amountBillions === null ? "—" : `${snapshot.amountBillions.toFixed(1)} 亿`}</strong>
          </div>
        </div>
        <p className="market-range-note">关键价位快照，不是按分钟连续的分时走势。</p>
      </section>
    );
  }

  const chartData = buildIndexSnapshotData();
  const priceDomain = buildPriceDomain(chartData);

  return (
    <section className="panel market-chart-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">静态演示 · {asOf}</span>
          <h2>分时走势与成交量</h2>
        </div>
        <BarChart3 size={20} />
      </div>
      <div className="market-chart">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 12 }}>
            <CartesianGrid stroke="#e7e9ee" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="time"
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={priceDomain}
              tick={{ fill: "#7a8190", fontSize: 11 }}
              tickLine={false}
              width={42}
              yAxisId="price"
            />
            <YAxis hide domain={[0, 120]} orientation="right" yAxisId="volume" />
            <Tooltip
              contentStyle={{ border: "1px solid #dfe3ea", borderRadius: 6 }}
              formatter={(value: number, name: string) => [
                name === "volume" ? `${value.toFixed(2)} 亿元` : value.toFixed(2),
                name === "price" ? "点位" : name === "average" ? "昨收" : "成交额",
              ]}
            />
            <Bar dataKey="volume" fill="#dce6f5" maxBarSize={22} yAxisId="volume" />
            <Line
              dataKey="average"
              dot={false}
              stroke="#d97706"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              type="monotone"
              yAxisId="price"
            />
            <Line
              dataKey="price"
              dot={false}
              stroke="#2563eb"
              strokeWidth={2.25}
              type="monotone"
              yAxisId="price"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
