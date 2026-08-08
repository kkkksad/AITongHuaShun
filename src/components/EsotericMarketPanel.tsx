import { useMemo, useState } from "react";
import { BookOpen, CalendarDays, Dices, ShieldAlert, Sparkles } from "lucide-react";
import type { MarketSnapshot } from "../../shared/trading";
import {
  createEsotericMarketReading,
  formatLocalDate,
  getEsotericMethodLabel,
  type EsotericMethod,
} from "../lib/esotericMarket";

interface EsotericMarketPanelProps {
  market?: MarketSnapshot;
  today?: Date;
}

function formatSnapshotTime(market?: MarketSnapshot): string {
  if (!market) return "当前真实行情快照未返回";
  return `真实快照 ${new Date(market.marketTime).toLocaleString("zh-CN", { hour12: false })}`;
}

export function EsotericMarketPanel({ market, today = new Date() }: EsotericMarketPanelProps) {
  const [target, setTarget] = useState("今日大盘");
  const [date, setDate] = useState(() => formatLocalDate(today));
  const [method, setMethod] = useState<EsotericMethod>("yijing");
  const [round, setRound] = useState(0);
  const reading = useMemo(
    () => createEsotericMarketReading({ date, target, method, round }),
    [date, method, round, target],
  );
  const indexCount = market?.quotes.filter((quote) => !quote.tradable && quote.price > 0).length ?? 0;

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
            用传统卦名、五行和固定日期规则生成一份可复盘的文化观察笔记。
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
          <span>观察对象</span>
          <input
            aria-label="观察对象"
            maxLength={32}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="例如：今日大盘、600519、半导体"
            value={target}
          />
        </label>
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
          <div className="esoteric-changing-line">变爻 {reading.changingLine} · 五行参考 {reading.element}</div>
        </article>

        <article className="esoteric-reading-card">
          <span>今日象意</span>
          <strong>{reading.tendency}</strong>
          <p>{reading.hexagram.image}</p>
          <p>{reading.observation}</p>
        </article>

        <article className="esoteric-observation-card">
          <span>可复盘的观察动作</span>
          <p>{reading.ritual}</p>
          <small>只记录，不把它转换成买卖指令。</small>
        </article>
      </div>

      <div className="esoteric-market-checks">
        <div>
          <span>现实行情</span>
          <strong>{indexCount > 0 ? `${indexCount} 个指数快照` : "等待真实快照"}</strong>
          <small>{formatSnapshotTime(market)}</small>
        </div>
        <div>
          <span>量化策略</span>
          <strong>独立运行</strong>
          <small>以数据、规则和历史验证为准</small>
        </div>
        <div>
          <span>Paper 执行</span>
          <strong>不受玄学结果触发</strong>
          <small>仍需原有计划、风控和人工确认</small>
        </div>
      </div>

      <footer className="esoteric-market-footer">
        <span>传统参考：卦名取自《周易》六十四卦，五行术语用于文化表达。</span>
        <span>本次固定索引：{reading.seed} · 日期 {reading.date}</span>
      </footer>
    </section>
  );
}
