import type { PaperPortfolioRiskEvidence } from "../../shared/paperPortfolioRisk";

function percent(value: number | null) {
  return value !== null && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "未知";
}
function money(value: number | null) {
  return value !== null && Number.isFinite(value) ? `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "未知";
}
function time(value: string | null) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未知";
}
const pairLabels = {
  observed: "已观察",
  "missing-history": "缺少匹配历史",
  "insufficient-history": "共同区间不足60",
  "undefined-variance": "收益方差为零或不可计算",
};

export function PaperPortfolioRiskPanel({ risk }: { risk?: PaperPortfolioRiskEvidence }) {
  if (!risk) return <p className="empty-copy">此报告尚未提供组合共同风险证据。</p>;
  const names = new Map(risk.holdings.map(row => [row.symbol, row.name]));
  return (
    <section className="learning-plan-summary paper-portfolio-risk" aria-label="持仓共同风险">
      <h3>持仓共同风险</h3>
      <p>股票市值占当前权益 {percent(risk.investedRatio)}，股票市值 {money(risk.holdingsMarketValue)}。</p>
      <p>当前已成交持仓 {risk.holdingCount} 只，不含挂单和拟买；比例分母包含全部持仓。</p>
      {risk.valuationStatus === "invalid" && <p>存在无效或重复估值，组合比例未知。</p>}
      <p>估值时间：{time(risk.valuationAsOf)}；历史分析截止：{time(risk.historyAsOf)}（北京时间）。</p>
      <p>取得有效日线 {risk.historyAvailableHoldingCount}/{risk.holdingCount} 只；达到相关性样本门槛 {risk.observedPairCount}/{risk.totalPairCount} 对。</p>
      <p>行业分类尚未核实，行业及相关性硬限额尚未启用；多个股票名称不能证明风险分散。</p>
      <p>历史相关性不是胜率，不代表未来同涨同跌或独立风险。最近最多120个相同起止日期的收益区间，至少60个才计算；共同缺失日和停牌仍可能影响解释，不能拼成完整协方差矩阵。</p>
      {risk.omittedHoldingCount > 0 && <p>明细最多12只，另有 {risk.omittedHoldingCount} 行未展示；配对仅展示这些明细之间的关系，缺失部分不当作独立风险。</p>}
      {risk.holdings.length > 0 ? (
        <details>
          <summary>查看持仓比例、历史来源与相关性</summary>
          <div className="paper-candidate-table" tabIndex={0} role="region" aria-label="持仓比例表格，可滚动">
            <table>
              <thead><tr><th scope="col">股票</th><th scope="col">市值 / 比例</th><th scope="col">历史来源</th></tr></thead>
              <tbody>{risk.holdings.map(row => <tr key={row.symbol}>
                <th scope="row">{row.name}<small>{row.symbol}</small></th>
                <td>{money(row.marketValue)}<small>占账户权益 {percent(row.accountWeight)}；占股票市值 {percent(row.stockWeight)}</small></td>
                <td>{row.historySource ?? "未知"}<small>有效日线 {row.historyBarCount ?? "未知"} 根</small></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="paper-candidate-table" tabIndex={0} role="region" aria-label="历史共同变化表格，可滚动">
            <table>
              <thead><tr><th scope="col">持仓配对</th><th scope="col">相关系数 / 样本</th><th scope="col">实际样本区间</th></tr></thead>
              <tbody>{risk.pairs.map(pair => <tr key={`${pair.left}:${pair.right}`}>
                <th scope="row">{names.get(pair.left) ?? pair.left} / {names.get(pair.right) ?? pair.right}<small>{pair.left} / {pair.right}</small></th>
                <td>{pair.status === "observed" && pair.correlation !== null && Number.isFinite(pair.correlation) ? pair.correlation.toFixed(2) : "未知"}
                  <small>{pairLabels[pair.status]} · {pair.samples} 个区间</small></td>
                <td>{pair.firstInterval?.startDate ?? "未知"} 至 {pair.lastInterval?.endDate ?? "未知"}
                  <small>最大区间跨度 {pair.maxCalendarSpanDays ?? "未知"} 自然日</small></td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      ) : <p>暂无持仓，无可比较配对。</p>}
    </section>
  );
}
