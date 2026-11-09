import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, RefreshCw, Shield, TrendingDown, Zap } from "lucide-react";
import type { AccountSnapshot, RiskLimits, RiskState } from "../../shared/trading";
import { paperRiskStateQueryOptions } from "../lib/riskQueries";

interface RiskPanelProps {
  limits?: RiskLimits;
  account?: AccountSnapshot;
}

interface RiskPanelContentProps extends RiskPanelProps {
  state?: RiskState;
  readFailed?: boolean;
  isFetching?: boolean;
  onRefresh?: () => void;
  now?: number;
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

function beijingTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未记录";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function RiskPanelContent({ limits, account, state, readFailed, isFetching, onRefresh, now = Date.now() }: RiskPanelContentProps) {
  if (!limits || !account) {
    return <section className="panel risk-panel"><div className="panel-header"><h2>风控面板</h2><Shield size={20} /></div>
      <p className="empty-copy">等待账户数据加载…</p></section>;
  }

  const day = account.tradingDayPerformance;
  const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayKnown = Boolean(day && day.date === today && day.baselineSource !== "unavailable" && day.openingEquity !== null &&
    Number.isFinite(day.openingEquity) && day.openingEquity > 0 && day.pnl !== null && Number.isFinite(day.pnl) &&
    day.pnlPercent !== null && Number.isFinite(day.pnlPercent));
  const dailyLossRatio = dayKnown && day!.pnlPercent! < 0 && limits.maxDailyLoss > 0
    ? Math.abs(day!.pnlPercent!) / limits.maxDailyLoss : 0;
  const dailyStop = dayKnown && day!.pnlPercent! <= -limits.maxDailyLoss;
  const riskCritical = account.riskUtilization > 0.8;
  const riskWarn = account.riskUtilization > 0.5;
  const dateMismatch = state && (state.tradingDate !== today || day && state.tradingDate !== day.date);
  const observationTime = state?.lastEvaluationTime ? Date.parse(state.lastEvaluationTime) : NaN;
  const observationOld = !Number.isFinite(observationTime) || observationTime > now + 5_000 || now - observationTime > 120_000;

  const banner = readFailed
    ? { tone: "warn", title: "风险状态读取失败", detail: state ? "以下保留上次快照，请刷新后复核。" : "尚未取得风险状态，请稍后重试。" }
    : account.paused
      ? { tone: "paused", title: "交易已暂停", detail: "已有挂单保留并停止撮合，行情估值和主动撤单继续可用。" }
      : !state
        ? { tone: "warn", title: "等待风险状态", detail: "正在读取服务端风险记录。" }
        : state.ledgerStatus === "history-gap"
          ? { tone: "critical", title: "成交风险记录存在缺口", detail: "买卖执行已受限，须复核历史证据后处理风险状态。" }
          : state.ledgerStatus === "checkpoint-unavailable"
            ? { tone: "critical", title: "风险状态保存异常", detail: "后续执行已停止；保存恢复后由服务端重试核验。" }
            : state.circuitState === "tripped"
              ? { tone: "critical", title: "风险熔断", detail: "冷却与恢复观察由服务端核验，每笔订单仍需重新检查。" }
              : dateMismatch
                ? { tone: "warn", title: "风险观察日期未对齐", detail: "显示上次风险观察，等待下一次可靠估值更新。" }
                : state.ledgerStatus !== "ready"
                  ? { tone: "warn", title: "账本状态未提供", detail: "当前响应未提供完整风险记录状态，请复核服务版本。" }
                  : dailyStop
                    ? { tone: "critical", title: "当日亏损已达停止线", detail: "当前政策停止买卖新执行，已有挂单仍需成交前复核，主动撤单可用。" }
                    : !dayKnown
                      ? { tone: "warn", title: "当日基线不可用", detail: "无法核验每日亏损线，新增买入受限。" }
                      : state.circuitState === "warning"
                        ? { tone: "warn", title: "风险预警", detail: "服务端记录了亏损或回撤预警，逐笔执行继续检查。" }
                        : observationOld
                          ? { tone: "warn", title: "风险观察尚未更新", detail: "最近可靠风险观察超过2分钟或时间不可用，请结合行情与服务状态复核。" }
                        : riskCritical || riskWarn
                          ? { tone: riskCritical ? "critical" : "warn", title: "风险利用率较高", detail: `当前利用率 ${pct(account.riskUtilization)}。` }
                          : { tone: "normal", title: "当前未触发熔断", detail: "报价、策略、资金、仓位和交易时段仍需满足下单条件。" };

  return (
    <section className="panel risk-panel" aria-label="Paper风险状态">
      <div className="panel-header">
        <div><span className="section-kicker">风险控制 · 本地模拟盘</span><h2>风控面板</h2></div>
        <button type="button" className="icon-button" aria-label="刷新风险状态" onClick={onRefresh} disabled={isFetching}>
          <RefreshCw size={18} className={isFetching ? "spin" : undefined} />
        </button>
      </div>
      <div className={`risk-status-banner ${banner.tone}`} role="status">
        {banner.tone === "normal" ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
        <div><strong>{banner.title}</strong><span>{banner.detail}</span></div>
      </div>
      <div className="risk-observation-copy">
        <span>风险日期：{state?.tradingDate ?? "未提供"}（北京时间）</span>
        <span>熔断状态：{state ? { normal: "未触发", warning: "预警", tripped: "已触发，恢复由服务端核验" }[state.circuitState] : "待读取"}</span>
        <span>账本检查点：{state?.ledgerStatus ? { ready: "可用", "history-gap": "成交风险记录存在缺口", "checkpoint-unavailable": "风险状态保存异常" }[state.ledgerStatus] : "账本状态未提供"}</span>
        <span>最近评估：{beijingTime(state?.lastEvaluationTime ?? null)}</span>
        {state?.trippedAt && <span>熔断触发：{beijingTime(state.trippedAt)}</span>}
        {state?.warningAt && <span>预警记录：{beijingTime(state.warningAt)}</span>}
        {state?.baselineResetDate && <span>本日已人工重建风险基线</span>}
      </div>

      <div className="risk-metrics-grid">
        <div className="risk-metric-card">
          <div className="risk-metric-header"><Zap size={16} /><span>风险利用率</span></div>
          <div className="risk-gauge-wrap">
            <div className="risk-gauge"><div className={`risk-gauge-fill ${riskCritical ? "critical" : riskWarn ? "warn" : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, account.riskUtilization * 100))}%` }} /></div>
            <span className="risk-gauge-value">{pct(account.riskUtilization)}</span>
          </div>
          <small className="risk-metric-detail">权益 {money(account.equity)} · 可用 {money(account.cash)}</small>
        </div>
        <div className="risk-metric-card">
          <div className="risk-metric-header"><TrendingDown size={16} /><span>当日盈亏</span></div>
          <div className="risk-gauge-wrap">
            <div className="risk-gauge"><div className={`risk-gauge-fill ${dailyStop ? "critical" : dailyLossRatio > 0.5 ? "warn" : ""}`}
              style={{ width: `${Math.min(100, dailyLossRatio * 100)}%` }} /></div>
            <span className="risk-gauge-value">{dayKnown ? `${day!.pnlPercent! >= 0 ? "+" : ""}${pct(day!.pnlPercent!)}` : "不可用"}</span>
          </div>
          <small className="risk-metric-detail">{day?.date ?? "日期未提供"}（北京时间） · 停止线 {pct(limits.maxDailyLoss)}
            {dayKnown ? ` · 当日盈亏 ${money(day!.pnl!)}` : " · 当日基线不可用"}</small>
          <small className="risk-metric-detail">账户重置以来累计 {money(account.dailyPnl)}（{pct(account.dailyPnlPercent)}）</small>
        </div>
        <div className="risk-metric-card">
          <div className="risk-metric-header"><TrendingDown size={16} /><span>当日峰值回撤</span></div>
          <strong className="risk-metric-value">{state && state.peakDailyEquity > 0 ? pct(state.dailyDrawdown) : "等待有效估值"}</strong>
          <small className="risk-metric-detail">{state?.tradingDate ?? "日期未提供"} · 已记录峰值 {state && state.peakDailyEquity > 0 ? money(state.peakDailyEquity) : "尚未建立"}</small>
          <small className="risk-metric-detail">全部持仓报价有效且新鲜时推进风险观察。</small>
        </div>
        <div className="risk-metric-card">
          <div className="risk-metric-header"><Shield size={16} /><span>完整周期结果</span></div>
          <strong className="risk-metric-value">已知完整周期 {state ? state.tradeCount : "待读取"}</strong>
          <small className="risk-metric-detail">亏损 {state ? state.lossCount : "待读取"} · 连续亏损 {state ? state.consecutiveLosses : "待读取"}
            {state?.unknownCycleCount === undefined ? " · 缺入场证据未提供" : ` · 缺入场证据 ${state.unknownCycleCount}`}</small>
          <small className="risk-metric-detail">同股从空仓到清仓、含买卖费用；统计自上次风险或账户重置起。</small>
        </div>
      </div>

      <div className="risk-limits-section">
        <div className="table-heading"><h3>风控参数</h3></div>
        <div className="risk-limits-scroll" role="region" aria-label="风控参数表，可横向滚动" tabIndex={0}>
          <table className="data-table risk-limits-table">
            <thead><tr><th>参数</th><th>当前限制</th><th>状态</th></tr></thead>
            <tbody>
              <tr><td><strong>单笔最大金额</strong><small className="table-subline">配置上限，服务端可动态收缩</small></td><td>{money(limits.maxOrderNotional)}</td><td><span className="risk-status ok">启用</span></td></tr>
              <tr><td><strong>单一仓位上限</strong><small className="table-subline">配置权益占比，服务端可动态收缩</small></td><td>{pct(limits.maxPositionWeight)}</td><td><span className="risk-status ok">启用</span></td></tr>
              <tr><td><strong>每日亏损停止线</strong><small className="table-subline">按交易日权益基线限制买卖执行</small></td><td>{pct(limits.maxDailyLoss)}</td><td><span className={`risk-status ${!dayKnown || dailyStop ? "triggered" : "ok"}`}>{!dayKnown ? "待建立基线" : dailyStop ? "已触发" : "未触发"}</span></td></tr>
              <tr><td><strong>最小交易单位</strong><small className="table-subline">每手股数</small></td><td>{limits.lotSize} 股</td><td><span className="risk-status ok">启用</span></td></tr>
              <tr><td><strong>实盘开关</strong><small className="table-subline">真实交易是否允许执行</small></td><td>{limits.realTradingEnabled ? "已开启" : "已关闭"}</td><td><span className={`risk-status ${limits.realTradingEnabled ? "triggered" : "ok"}`}>{limits.realTradingEnabled ? "真实交易" : "模拟环境"}</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="risk-metric-detail">本页每15秒读取风险状态，刷新只读取快照。熔断冷却、恢复和成交资格由服务端逐笔核验；没有完整风险状态或实时估值时，以已标注的上次观察为准。</p>
    </section>
  );
}

export function RiskPanel(props: RiskPanelProps) {
  const query = useQuery({ ...paperRiskStateQueryOptions(), enabled: Boolean(props.account && props.limits) });
  return <RiskPanelContent {...props} state={query.data} readFailed={query.isError} isFetching={query.isFetching}
    onRefresh={() => { void query.refetch(); }} />;
}
