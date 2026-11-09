import { useState } from "react";
import {
  PAPER_CANDIDATE_SOURCE_LABELS,
  PAPER_CANDIDATE_TIER_LABELS,
  type PaperCandidatePool,
  type PaperCandidatePoolTier,
} from "../../shared/paperCandidatePool";

export function PaperCandidatePoolPanel({ pool }: { pool?: PaperCandidatePool }) {
  const [selected, setSelected] = useState<PaperCandidatePoolTier | "all">("all");
  if (!pool) return <p className="empty-copy">此报告尚无完整候选分区，请参考下方已有计划记录。</p>;
  const rows = pool.rows.filter((row) => selected === "all" || row.tier === selected);
  const selectedCount = selected === "all" ? pool.total : pool.counts[selected];
  return (
    <section className="paper-candidate-pool" aria-label="候选分区">
      <h3>候选分区</h3>
      <p>合并两类扫描与现有持仓，按股票去重。计划就绪仍须提交前复核，不代表订单已提交或成交。</p>
      <div className="paper-candidate-filters" aria-label="筛选候选分区">
        <button type="button" aria-pressed={selected === "all"} onClick={() => setSelected("all")}>全部 {pool.total}</button>
        {(Object.keys(PAPER_CANDIDATE_TIER_LABELS) as PaperCandidatePoolTier[]).map((tier) => (
          <button key={tier} type="button" aria-pressed={selected === tier} onClick={() => setSelected(tier)}>
            {PAPER_CANDIDATE_TIER_LABELS[tier]} {pool.counts[tier]}
          </button>
        ))}
      </div>
      {pool.omitted > 0 && <p>完整数量已计入分区；另有 {pool.omitted} 只未展示明细，优先展示持仓与计划。</p>}
      {rows.length > 0 ? (
        <div className="paper-candidate-table" tabIndex={0} role="region" aria-label="候选原因表格，可滚动">
          <table>
            <thead><tr><th scope="col">股票 / 分区</th><th scope="col">当前依据</th><th scope="col">后续核对</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.symbol}>
                <th scope="row">{row.symbol} {row.name}<small>{PAPER_CANDIDATE_TIER_LABELS[row.tier]}</small></th>
                <td><small>{PAPER_CANDIDATE_SOURCE_LABELS[row.reasonSource]}</small>{row.reason}</td>
                <td>{row.nextCheck}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="empty-copy">{selectedCount > 0 ? "本分区候选未进入本次保留明细，请参考完整分区数量。" : "本分区暂无候选。"}</p>}
    </section>
  );
}
