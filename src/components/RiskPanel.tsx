import { AlertTriangle, CheckCircle, Shield, TrendingDown, Zap } from "lucide-react";
import type { AccountSnapshot, RiskLimits } from "../../shared/trading";

interface RiskPanelProps {
  limits?: RiskLimits;
  account?: AccountSnapshot;
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function RiskPanel({ limits, account }: RiskPanelProps) {
  if (!limits || !account) {
    return (
      <section className="panel risk-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">风险控制</span>
            <h2>风控面板</h2>
          </div>
          <Shield size={20} />
        </div>
        <div className="empty-copy" style={{ padding: "2rem 0", textAlign: "center", color: "#8b94a1" }}>
          等待账户数据加载...
        </div>
      </section>
    );
  }

  const dailyLossRatio = account.dailyPnlPercent < 0
    ? Math.abs(account.dailyPnlPercent) / limits.maxDailyLoss
    : 0;

  const dailyLossPct = Math.min(dailyLossRatio * 100, 100);
  const dailyLossCritical = dailyLossRatio > 0.8;
  const dailyLossWarn = dailyLossRatio > 0.5 && !dailyLossCritical;

  const riskPct = Math.min(account.riskUtilization * 100, 100);
  const riskCritical = account.riskUtilization > 0.8;
  const riskWarn = account.riskUtilization > 0.5 && !riskCritical;

  return (
    <section className="panel risk-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">风险控制</span>
          <h2>风控面板</h2>
        </div>
        <Shield size={20} />
      </div>

      {/* Status Banner */}
      <div className={`risk-status-banner ${account.paused ? "paused" : riskCritical ? "critical" : riskWarn ? "warn" : "normal"}`}>
        {account.paused ? (
          <>
            <AlertTriangle size={18} />
            <strong>交易已暂停</strong>
            <span>— 账户处于暂停状态，新订单将被拒绝</span>
          </>
        ) : riskCritical ? (
          <>
            <AlertTriangle size={18} />
            <strong>高风险</strong>
            <span>— 风险利用率超过 {pct(0.8)}，建议减仓</span>
          </>
        ) : riskWarn ? (
          <>
            <AlertTriangle size={18} />
            <strong>注意风险</strong>
            <span>— 风险利用率超过 {pct(0.5)}</span>
          </>
        ) : (
          <>
            <CheckCircle size={18} />
            <strong>风险正常</strong>
            <span>— 所有指标在安全范围内</span>
          </>
        )}
      </div>

      {/* Risk Metrics Grid */}
      <div className="risk-metrics-grid">
        {/* Risk Utilization Gauge */}
        <div className="risk-metric-card">
          <div className="risk-metric-header">
            <Zap size={16} />
            <span>风险利用率</span>
          </div>
          <div className="risk-gauge-wrap">
            <div className="risk-gauge">
              <div
                className={`risk-gauge-fill ${riskCritical ? "critical" : riskWarn ? "warn" : ""}`}
                style={{ width: `${riskPct}%` }}
              />
            </div>
            <span className={`risk-gauge-value ${riskCritical ? "negative" : riskWarn ? "" : "positive"}`}>
              {pct(account.riskUtilization)}
            </span>
          </div>
          <small className="risk-metric-detail">
            权益: {money(account.equity)} · 可用: {money(account.cash)}
          </small>
        </div>

        {/* Daily Loss Tracker */}
        <div className="risk-metric-card">
          <div className="risk-metric-header">
            <TrendingDown size={16} />
            <span>日内亏损追踪</span>
          </div>
          <div className="risk-gauge-wrap">
            <div className="risk-gauge">
              <div
                className={`risk-gauge-fill ${dailyLossCritical ? "critical" : dailyLossWarn ? "warn" : ""}`}
                style={{ width: `${dailyLossPct}%` }}
              />
            </div>
            <span className={`risk-gauge-value ${dailyLossCritical ? "negative" : dailyLossWarn ? "" : "positive"}`}>
              {account.dailyPnlPercent >= 0 ? "+" : ""}{pct(account.dailyPnlPercent)}
            </span>
          </div>
          <small className="risk-metric-detail">
            止损线: {pct(limits.maxDailyLoss)} · 日内盈亏: {money(account.dailyPnl)}
          </small>
        </div>
      </div>

      {/* Risk Limits Table */}
      <div className="risk-limits-section">
        <div className="table-heading">
          <h3>风控参数</h3>
        </div>
        <table className="data-table risk-limits-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>当前限制</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>单笔最大金额</strong>
                <small className="table-subline">单笔订单名义本金上限</small>
              </td>
              <td>{money(limits.maxOrderNotional)}</td>
              <td>
                <span className="risk-status ok">
                  <CheckCircle size={14} /> 启用
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>单一仓位上限</strong>
                <small className="table-subline">单一标的占总权益最大比例</small>
              </td>
              <td>{pct(limits.maxPositionWeight)}</td>
              <td>
                <span className="risk-status ok">
                  <CheckCircle size={14} /> 启用
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>每日亏损停止线</strong>
                <small className="table-subline">触发后当日禁止新开仓</small>
              </td>
              <td>{pct(limits.maxDailyLoss)}</td>
              <td>
                <span className={`risk-status ${dailyLossRatio >= 1 ? "triggered" : "ok"}`}>
                  {dailyLossRatio >= 1 ? (
                    <><AlertTriangle size={14} /> 已触发</>
                  ) : (
                    <><CheckCircle size={14} /> 未触发</>
                  )}
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>最小交易单位</strong>
                <small className="table-subline">每手股数</small>
              </td>
              <td>{limits.lotSize} 股</td>
              <td>
                <span className="risk-status ok">
                  <CheckCircle size={14} /> 启用
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <strong>实盘开关</strong>
                <small className="table-subline">真实交易是否允许执行</small>
              </td>
              <td>
                <span className={limits.realTradingEnabled ? "negative" : "positive"}>
                  {limits.realTradingEnabled ? "已开启" : "已关闭"}
                </span>
              </td>
              <td>
                <span className={`risk-status ${limits.realTradingEnabled ? "triggered" : "ok"}`}>
                  {limits.realTradingEnabled ? (
                    <><AlertTriangle size={14} /> 真实交易</>
                  ) : (
                    <><CheckCircle size={14} /> 模拟环境</>
                  )}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
