import { Check, Clock3, Eye, LockKeyhole, Sparkles } from "lucide-react";
import { pipelineStages } from "../data/mockData";

const stageIcons = {
  done: Check,
  running: Sparkles,
  pending: Clock3,
  review: Eye,
};

export function LearningPipeline() {
  return (
    <div className="learning-layout">
      <section className="panel pipeline-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">受控研究流程</span>
            <h2>候选策略验证</h2>
          </div>
          <span className="sample-badge">7 个候选存活</span>
        </div>

        <div className="pipeline-list">
          {pipelineStages.map((stage, index) => {
            const Icon = stageIcons[stage.status];
            return (
              <article className={`pipeline-stage ${stage.status}`} key={stage.name}>
                <div className="stage-marker">
                  <Icon size={17} />
                </div>
                <div className="stage-copy">
                  <div>
                    <span>阶段 {index + 1}</span>
                    <strong>{stage.name}</strong>
                  </div>
                  <p>{stage.description}</p>
                </div>
                <span className="stage-detail">{stage.detail}</span>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="panel governance-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">治理边界</span>
            <h2>审批策略</h2>
          </div>
          <LockKeyhole size={20} />
        </div>
        <div className="governance-score">
          <div className="score-ring">
            <strong>82</strong>
            <span>/ 100</span>
          </div>
          <div>
            <strong>研究完整度</strong>
            <p>仍需补充两项风险说明。</p>
          </div>
        </div>
        <ul className="check-list">
          <li className="done">
            <Check size={15} />
            数据时间边界已验证
          </li>
          <li className="done">
            <Check size={15} />
            样本外区间已隔离
          </li>
          <li className="done">
            <Check size={15} />
            模拟成本已纳入
          </li>
          <li>
            <Clock3 size={15} />
            极端行情压力测试待补充
          </li>
          <li>
            <Clock3 size={15} />
            风险负责人签字待完成
          </li>
        </ul>
        <button className="primary-button full-width" type="button">
          提交人工复核
        </button>
      </aside>
    </div>
  );
}
