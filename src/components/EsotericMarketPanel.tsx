import { useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  CalendarDays,
  CircleGauge,
  Dices,
  ListChecks,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { MarketSnapshot } from "../../shared/trading";
import {
  createEsotericMarketReading,
  formatLocalDate,
  getEsotericMethodLabel,
  summarizeEsotericMarketContext,
  summarizeEsotericStockContext,
  type EsotericMethod,
  type EsotericMarketState,
} from "../lib/esotericMarket";

interface EsotericMarketPanelProps {
  market?: MarketSnapshot;
  today?: Date;
}

function formatSnapshotTime(market?: MarketSnapshot): string {
  if (!market) return "当前真实行情快照未返回";
  return `真实快照 ${new Date(market.marketTime).toLocaleString("zh-CN", { hour12: false })}`;
}

function marketStateLabel(state: EsotericMarketState): string {
  if (state === "expanding") return "扩张";
  if (state === "contracting") return "收缩";
  if (state === "balanced") return "均衡";
  return "样本不足";
}

function alignmentLabel(alignment: "aligned" | "conflicted" | "unavailable"): string {
  if (alignment === "aligned") return "象意与现实暂时同向";
  if (alignment === "conflicted") return "象意与现实存在冲突";
  return "等待现实数据后再比较";
}

export function EsotericMarketPanel({ market, today = new Date() }: EsotericMarketPanelProps) {
  const [targetMode, setTargetMode] = useState<"market" | "stock">("market");
  const [target, setTarget] = useState("今日大盘");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [date, setDate] = useState(() => formatLocalDate(today));
  const [method, setMethod] = useState<EsotericMethod>("yijing");
  const [round, setRound] = useState(0);
  const marketContext = useMemo(
    () => summarizeEsotericMarketContext(market, today),
    [market, today],
  );
  const stockQuotes = useMemo(
    () => (market?.quotes ?? [])
      .filter((quote) => quote.tradable && quote.price > 0)
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    [market],
  );
  const activeStock = stockQuotes.find((quote) => quote.symbol === selectedSymbol)
    ?? (targetMode === "stock" ? stockQuotes[0] : undefined);
  const readingTarget = targetMode === "stock"
    ? activeStock ? `${activeStock.name} (${activeStock.symbol})` : "待选择单票"
    : target;
  const stockContext = useMemo(
    () => targetMode === "stock"
      ? summarizeEsotericStockContext(activeStock, today)
      : undefined,
    [activeStock, targetMode, today],
  );
  const reading = useMemo(
    () => createEsotericMarketReading({
      date,
      target: readingTarget,
      method,
      round,
      marketContext,
      stockContext,
    }),
    [date, marketContext, method, readingTarget, round, stockContext],
  );

  return (
    <section className="panel esoteric-market-panel" aria-labelledby="esoteric-market-title">
      <div className="research-panel-header esoteric-market-header">
        <div>
          <span className="section-kicker">娱乐研究层 · 不参与交易</span>
          <h2 id="esoteric-market-title">
            <Sparkles size={19} />
            玄学观察
          </h2>
          <p className="esoteric-market-subtitle">
            传统象意、真实盘面镜像和收盘复盘分层记录，结果只留在娱乐研究层。
          </p>
        </div>
        <div className="esoteric-market-source" title="玄学结果不会写入策略或订单">
          <ShieldAlert size={16} />
          <span>不会进入策略路由</span>
        </div>
      </div>

      <div className="esoteric-market-warning" role="note">
        <ShieldAlert size={17} />
        <span>{reading.risk}</span>
      </div>

      <div className="esoteric-market-controls">
        <label>
          <span>观察层</span>
          <select
            aria-label="观察层"
            onChange={(event) => setTargetMode(event.target.value as "market" | "stock")}
            value={targetMode}
          >
            <option value="market">大盘观察</option>
            <option value="stock">单票观察</option>
          </select>
        </label>
        {targetMode === "stock" ? (
          <label>
            <span>选择股票</span>
            <select
              aria-label="选择股票"
              onChange={(event) => setSelectedSymbol(event.target.value)}
              value={activeStock?.symbol ?? ""}
            >
              {stockQuotes.length === 0 && <option value="">当前快照暂无有效个股</option>}
              {stockQuotes.map((quote) => (
                <option key={quote.symbol} value={quote.symbol}>
                  {quote.name} · {quote.symbol}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            <span>观察对象</span>
            <input
              aria-label="观察对象"
              maxLength={32}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="例如：今日大盘、半导体"
              value={target}
            />
          </label>
        )}
        <label>
          <span><CalendarDays size={14} /> 起卦日期</span>
          <input
            aria-label="起卦日期"
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
        </label>
        <label>
          <span><BookOpen size={14} /> 观察方法</span>
          <select
            aria-label="观察方法"
            onChange={(event) => setMethod(event.target.value as EsotericMethod)}
            value={method}
          >
            <option value="yijing">易经卦象</option>
            <option value="wuxing">五行节律</option>
            <option value="number">数字起卦</option>
          </select>
        </label>
        <button
          className="button secondary esoteric-market-draw"
          onClick={() => setRound((value) => value + 1)}
          title="按同一日期和对象生成下一次固定结果"
          type="button"
        >
          <Dices size={16} />
          重新起卦
        </button>
      </div>

      <div className="esoteric-market-result-grid">
        <article className="esoteric-hexagram-card">
          <div className="esoteric-hexagram-label">第 {reading.hexagram.number} 卦 · {getEsotericMethodLabel(reading.method)}</div>
          <strong>{reading.hexagram.name}</strong>
          <span>{reading.hexagram.theme}</span>
          <p>{reading.methodLens}</p>
          <div className="esoteric-changing-line">变爻 {reading.changingLine} · 五行参考 {reading.element}</div>
          <div className="esoteric-entertainment-index">
            <CircleGauge size={15} />
            <span>
              娱乐观察指数 <strong>{reading.entertainmentIndex}/100</strong>
              <small>不是胜率，也不是预测概率</small>
            </span>
          </div>
        </article>

        <article className={`esoteric-reading-card esoteric-alignment-${reading.alignment}`}>
          <span><Activity size={14} /> {reading.focusType === "stock" ? "个股现实镜像" : "盘面镜像"}</span>
          <strong>{alignmentLabel(reading.alignment)}</strong>
          <p>{reading.focusMirror.summary}</p>
          <ul>
            {reading.focusMirror.evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <small>象意层为{reading.symbolLayer.focus}；发生冲突时只记录，不解释为交易信号。</small>
        </article>

        <article className="esoteric-observation-card">
          <span><ListChecks size={14} /> 收盘复盘问题</span>
          <ol>
            {reading.reviewQuestions.map((question) => <li key={question}>{question}</li>)}
          </ol>
          <p>{reading.ritual}</p>
          <small>先写下答案，再对照真实量价；不把文化解释转换成买卖指令。</small>
        </article>
      </div>

      <div className="esoteric-market-checks">
        <div>
          <span>现实行情</span>
          <strong>{marketStateLabel(marketContext.marketState)}</strong>
          <small>{formatSnapshotTime(market)}</small>
        </div>
        <div>
          <span>上涨宽度</span>
          <strong>{marketContext.breadthRatio === null ? "--" : `${(marketContext.breadthRatio * 100).toFixed(0)}%`}</strong>
          <small>上涨 {marketContext.advancingCount} · 下跌 {marketContext.decliningCount}</small>
        </div>
        <div>
          <span>涨跌与振幅</span>
          <strong>
            {marketContext.averageChangePercent === null
              ? "--"
              : `${marketContext.averageChangePercent >= 0 ? "+" : ""}${marketContext.averageChangePercent.toFixed(2)}%`}
          </strong>
          <small>平均振幅 {marketContext.averageAmplitudePercent?.toFixed(2) ?? "--"}%</small>
        </div>
        <div>
          <span>快照覆盖</span>
          <strong>{marketContext.validCount}/{marketContext.sampleCount}</strong>
          <small>平均新鲜度 {marketContext.freshnessMinutes?.toFixed(1) ?? "--"} 分钟</small>
        </div>
        <div>
          <span>Paper 执行</span>
          <strong>不受玄学结果触发</strong>
          <small>仍需原有计划、风控和人工确认</small>
        </div>
      </div>

      <footer className="esoteric-market-footer">
        <span>传统参考：卦名取自《周易》六十四卦；量化策略仍以数据、规则和历史验证独立运行。</span>
        <span>本次固定索引：{reading.seed} · 日期 {reading.date}</span>
      </footer>
    </section>
  );
}
