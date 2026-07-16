import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import {
  fetchTurningPointResearch,
  type TurningBias,
  type TurningPointCandidate,
} from "../lib/tradingApi";

type TurningSort = "readiness" | "break" | "compression";

const biasLabels: Record<TurningBias, string> = {
  up: "向上待确认",
  down: "向下风险",
  "two-way": "双向临界",
  none: "暂未变盘",
  "insufficient-data": "样本不足",
};

function probability(value: number | null): string {
  return value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value === null) return "样本不足";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function biasClass(bias: TurningBias): string {
  if (bias === "up") return "gate-pass";
  if (bias === "down") return "gate-blocked";
  return "gate-caution";
}

function eventTiming(candidate: TurningPointCandidate): string {
  if (candidate.bias === "up" && candidate.validation.medianUpTradingDay !== null) {
    return `向上约第 ${candidate.validation.medianUpTradingDay} 日`;
  }
  if (candidate.bias === "down" && candidate.validation.medianDownTradingDay !== null) {
    return `向下约第 ${candidate.validation.medianDownTradingDay} 日`;
  }
  const parts = [
    candidate.validation.medianUpTradingDay === null
      ? null
      : `上 ${candidate.validation.medianUpTradingDay} 日`,
    candidate.validation.medianDownTradingDay === null
      ? null
      : `下 ${candidate.validation.medianDownTradingDay} 日`,
  ].filter(Boolean);
  return parts.join(" / ") || "未形成历史中位时间";
}

export function TurningPointPanel() {
  const [sortBy, setSortBy] = useState<TurningSort>("readiness");
  const query = useQuery({
    queryKey: ["turning-points", 12, 360],
    queryFn: () => fetchTurningPointResearch(12, 360),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  const report = query.data;
  const candidates = useMemo(() => {
    const items = [...(report?.candidates ?? [])];
    return items.sort((left, right) => {
      if (sortBy === "break") {
        return (right.validation.breakProbability ?? -1) -
          (left.validation.breakProbability ?? -1);
      }
      if (sortBy === "compression") {
        return right.compressionScore - left.compressionScore;
      }
      return right.readinessScore - left.readinessScore;
    });
  }, [report?.candidates, sortBy]);

  return (
    <section className="panel turning-point-panel">
      <div className="panel-header research-panel-header">
        <div>
          <span className="section-kicker">真实历史条件频率</span>
          <h2>五日变盘雷达</h2>
        </div>
        <div className="research-panel-actions">
          <label className="compact-select-label">
            <span>排序</span>
            <select
              aria-label="变盘候选排序"
              onChange={(event) => setSortBy(event.target.value as TurningSort)}
              value={sortBy}
            >
              <option value="readiness">准备度</option>
              <option value="break">历史变盘频率</option>
              <option value="compression">压缩程度</option>
            </select>
          </label>
          <button
            aria-label="刷新变盘候选"
            className="icon-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            title="刷新"
            type="button"
          >
            <RefreshCw className={query.isFetching ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      {query.isLoading && (
        <div className="research-empty">正在读取观察池的 360 日前复权行情…</div>
      )}
      {query.isError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>变盘雷达暂不可用，请检查 API 与 AkShare 行情桥接。</span>
        </div>
      )}

      {report && (
        <>
          <div className="regime-meta-strip turning-meta-strip">
            <div>
              <span>来源状态</span>
              <strong>{report.sourceStatus === "live-read-only" ? "真实只读" : "降级"}</strong>
            </div>
            <div>
              <span>扫描范围</span>
              <strong>{report.source.universeCount} 只</strong>
            </div>
            <div>
              <span>有效历史</span>
              <strong>{report.source.analyzedCount} 只</strong>
            </div>
            <div>
              <span>判断窗口</span>
              <strong>{report.horizon} 日</strong>
            </div>
            <div>
              <span>最低样本</span>
              <strong>{report.minimumSamples}</strong>
            </div>
          </div>

          <div className="research-alert regime-source-ok">
            <ShieldCheck size={16} />
            <span>{report.methodology.probabilityMeaning}</span>
          </div>

          {report.warnings.length > 0 && (
            <div className="research-alert regime-warning">
              <AlertTriangle size={16} />
              <span>{report.warnings[0]}</span>
            </div>
          )}

          <div className="regime-table-wrap">
            {candidates.length === 0 ? (
              <div className="research-empty">当前观察池没有可用的真实变盘样本。</div>
            ) : (
              <table className="data-table turning-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>状态</th>
                    <th>准备度</th>
                    <th>变盘 / 不变</th>
                    <th>向上 / 向下</th>
                    <th>历史时间</th>
                    <th>压缩 / 量能</th>
                    <th>依据 / 风险</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.symbol}>
                      <td className="symbol-cell">
                        <strong>{candidate.name}</strong>
                        <span className="table-subline">
                          {candidate.symbol} · {candidate.barCount} 根
                        </span>
                      </td>
                      <td>
                        <span className={`rank-badge ${biasClass(candidate.bias)}`}>
                          {biasLabels[candidate.bias]}
                        </span>
                      </td>
                      <td>
                        <strong>{candidate.readinessScore.toFixed(0)}</strong> / 100
                        <span className="table-subline">
                          {candidate.validation.samples} 个相似样本
                        </span>
                      </td>
                      <td>
                        {probability(candidate.validation.breakProbability)}
                        <span className="table-subline">
                          不变 {probability(candidate.validation.noBreakProbability)}
                        </span>
                      </td>
                      <td>
                        <span className="turning-probability positive">
                          <ArrowUp size={13} />
                          {probability(candidate.validation.upProbability)}
                        </span>
                        <span className="turning-probability negative">
                          <ArrowDown size={13} />
                          {probability(candidate.validation.downProbability)}
                        </span>
                      </td>
                      <td>
                        {eventTiming(candidate)}
                        <span className="table-subline">
                          上 {signedPercent(candidate.validation.medianUpReturn)} · 下 {signedPercent(candidate.validation.medianDownReturn)}
                        </span>
                      </td>
                      <td>
                        压缩 {candidate.compressionScore.toFixed(0)}
                        <span className="table-subline">
                          量比 {candidate.features.volumeRatio5d.toFixed(2)}x
                        </span>
                      </td>
                      <td className="regime-reason-cell">
                        {candidate.evidence[0] ?? candidate.riskFlags[0]}
                        {candidate.riskFlags[0] && candidate.evidence[0] && (
                          <span className="table-subline negative">{candidate.riskFlags[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="research-source-row">
            <ScanSearch size={15} />
            <span>
              {report.source.historySource} · 前复权 · 更新 {report.source.fetchedAt
                ? new Date(report.source.fetchedAt).toLocaleString("zh-CN")
                : "未知"} · 只扫描当前受控观察池
            </span>
          </div>
        </>
      )}
    </section>
  );
}
