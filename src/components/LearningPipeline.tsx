import { Check, Clock3, Eye, LockKeyhole, Sparkles } from "lucide-react";
import { pipelineStages } from "../data/mockData";

const stageIcons = {
  done: Check,
  running: Sparkles,
  pending: Clock3,
  review: Eye,
};

export default function LearningPipeline() {
  return (
    <div className="learning-layout">
      <section className="panel pipeline-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">\u53D7\u63A7\u7814\u7A76\u6D41\u7A0B</span>
            <h2>\u5019\u9009\u7B56\u7565\u9A8C\u8BC1</h2>
          </div>
          <span className="sample-badge">7 \u4E2A\u5019\u9009\u5B58\u6D3B</span>
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
                    <span>\u9636\u6BB5 {index + 1}</span>
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
            <span className="section-kicker">\u6CBB\u7406\u8FB9\u754C</span>
            <h2>\u5BA1\u6279\u7B56\u7565</h2>
          </div>
          <LockKeyhole size={20} />
        </div>
        <div className="governance-score">
          <div className="score-ring">
            <strong>82</strong>
            <span>/ 100</span>
          </div>
          <div>
            <strong>\u7814\u7A76\u5B8C\u6574\u5EA6</strong>
            <p>\u4ECD\u9700\u8865\u5145\u4E24\u9879\u98CE\u9669\u8BF4\u660E\u4E66</p>
          </div>
        </div>
        <ul className="check-list">
          <li className="done">
            <Check size={15} />
            \u6570\u636E\u65F6\u95F4\u8FB9\u754C\u5DF2\u9A8C\u8BC1
          </li>
          <li className="done">
            <Check size={15} />
            \u6837\u672C\u5916\u533A\u95F4\u5DF2\u9694\u79BB
          </li>
          <li className="done">
            <Check size={15} />
            \u6A21\u62DF\u6210\u672C\u5DF2\u7EB3\u5165
          </li>
          <li>
            <Clock3 size={15} />
            \u6781\u7AEF\u884C\u60C5\u538B\u529B\u6D4B\u8BD5\u5F85\u8865\u5145
          </li>
          <li>
            <Clock3 size={15} />
            \u98CE\u9669\u8D1F\u8D23\u4EBA\u7B7E\u5B57\u5F85\u5B8C\u6210
          </li>
        </ul>
        <button className="primary-button full-width" type="button">
          \u63D0\u4EA4\u4EBA\u5DE5\u590D\u6838
        </button>
      </aside>
    </div>
  );
}
