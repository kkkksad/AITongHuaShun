type RecordValue = Record<string, unknown>;
type Props = { value?: unknown; symbol: string; latestDate: string | null; barCount: number; generatedAt: string };
type Observation = { label: string; evidence?: string };

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function dateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): number {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && dateKey(value.slice(0, 10)) ? Date.parse(value) : NaN;
}
function agrees(value: unknown, expected: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Number.isFinite(expected)
    && Math.abs(value - expected) <= 1e-10 * Math.max(1, Math.abs(expected));
}
const price = (value: number) => `¥${value.toFixed(4)}`;

function breakoutObservation(value: unknown, latestDate: string): Observation {
  const b = record(value);
  if (!b || b.resistanceWindowBars !== 20 || !positive(b.priorHigh20) || !positive(b.latestClose)
    || !positive(b.latestDayHigh) || b.latestClose > b.latestDayHigh || !dateKey(b.priorHighDate)
    || b.priorHighDate >= latestDate || b.closesAbovePriorHigh20 !== (b.latestClose > b.priorHigh20)) {
    return { label: "突破证据未知" };
  }
  return {
    label: b.latestClose > b.priorHigh20 ? "突破待持续确认"
      : b.latestDayHigh > b.priorHigh20 ? "冲高未站稳" : "未越过前20日高点",
    evidence: `前20日高点 ${price(b.priorHigh20)}（${b.priorHighDate}）；最近最高 ${price(b.latestDayHigh)}、收盘 ${price(b.latestClose)}。`,
  };
}

function pullbackObservation(value: unknown, latestClose: unknown, latestHigh: unknown, latestDate: string): Observation {
  const p = record(value);
  if (!p || !positive(latestClose) || !positive(latestHigh) || latestClose > latestHigh || !positive(p.low) || !positive(p.priorAnchorHigh20)
    || !positive(p.previousDayHigh) || !dateKey(p.lowDate) || !dateKey(p.priorAnchorHighDate)
    || p.priorAnchorHighDate >= p.lowDate || p.lowDate >= latestDate
    || !Number.isFinite((1 - p.low / p.priorAnchorHigh20) * 100)
    || !agrees(p.pullbackFromPriorAnchor, 1 - p.low / p.priorAnchorHigh20)
    || !agrees(p.recoveredFromLow, latestClose / p.low - 1)
    || p.recoveryAfterLow !== true || p.latestCloseAbovePreviousDayHigh !== (latestClose > p.previousDayHigh)
    || !(p.lowCompletedVolumeRatio20 === null || p.lowCompletedVolumeRatio20 === 0 || positive(p.lowCompletedVolumeRatio20))) {
    return { label: "回撤证据未知" };
  }
  const ratio = positive(p.lowCompletedVolumeRatio20) ? p.lowCompletedVolumeRatio20 : null;
  const pullback = 1 - p.low / p.priorAnchorHigh20;
  return {
    label: pullback > 0 && ratio !== null && ratio < 1 && latestClose > p.low && latestClose > p.previousDayHigh
      ? "回撤后恢复线索" : "回撤恢复条件未齐",
    evidence: `锚高 ${price(p.priorAnchorHigh20)}（${p.priorAnchorHighDate}）至低点 ${price(p.low)}（${p.lowDate}），回撤 ${(pullback * 100).toFixed(1)}%；`
      + `${ratio === null ? "低点量比未知" : `低点量比 ${ratio.toFixed(2)}`}；最近收盘 ${price(latestClose)}，前日高点 ${price(p.previousDayHigh)}。`,
  };
}

/** Read-only descriptions of existing completed daily evidence; never a trading gate. */
export function CompletedPriceStructure({ value, symbol, latestDate, barCount, generatedAt }: Props) {
  const entry = record(value), validation = record(entry?.validation);
  const asOf = timestamp(entry?.asOf), reportTime = timestamp(generatedAt);
  if (!entry || entry.status !== "observed" || entry.observed !== true
    || entry.symbol !== symbol || !/^\d{6}$/.test(symbol) || entry.adjustment !== "qfq"
    || typeof entry.source !== "string" || !entry.source.trim()
    || entry.scope !== "completed-qfq-daily-structure-not-live-intraday-signal-or-trade-permission"
    || !dateKey(latestDate) || entry.latestDate !== latestDate
    || !Number.isInteger(barCount) || barCount < 61 || barCount > 500 || entry.barCount !== barCount || entry.requiredBars !== 61
    || !validation || validation.invalidBars !== 0 || validation.duplicateBars !== 0
    || ![validation.excludedIncompleteOrFutureBars, validation.trimmedBars].every(count => Number.isSafeInteger(count) && (count as number) >= 0)
    || !Number.isFinite(asOf) || !Number.isFinite(reportTime) || asOf > reportTime
    || Date.parse(`${latestDate}T07:00:00.000Z`) > asOf) {
    return <small className="table-subline">完成日线结构未知：证据缺失、未完成或未通过身份与时间校验。</small>;
  }
  const breakout = breakoutObservation(entry.breakout, latestDate);
  const b = record(entry.breakout);
  const pullback = pullbackObservation(entry.pullback, b?.latestClose, b?.latestDayHigh, latestDate);
  return (
    <details className="completed-price-structure">
      <summary>日线结构：{breakout.label} · {pullback.label}</summary>
      <p data-observation="breakout"><strong>{breakout.label}</strong>{breakout.evidence && <span className="table-subline">{breakout.evidence}</span>}</p>
      <p data-observation="pullback"><strong>{pullback.label}</strong>{pullback.evidence && <span className="table-subline">{pullback.evidence}</span>}</p>
      <p>最近完成日 {latestDate}；来源 {entry.source}；历史截止 <time dateTime={entry.asOf as string}>{new Date(asOf).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false })}</time>（北京时间）。</p>
      <p>仅完成前复权日线观察，不判定主力意图；不是实时信号、胜率或交易许可。</p>
    </details>
  );
}
