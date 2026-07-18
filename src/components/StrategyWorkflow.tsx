import type { ReactNode } from "react";
import {
  CheckCircle2,
  Eye,
  FlaskConical,
  LineChart,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import type { StrategyWorkflowStage } from "../lib/strategyWorkflow";

interface StrategyWorkflowProps {
  activeStage: StrategyWorkflowStage;
  selectedStrategyName: string;
  committedStrategyName: string;
  hasRun: boolean;
  hasPendingChanges: boolean;
  onStageChange: (stage: StrategyWorkflowStage) => void;
  children: ReactNode;
}

const stages = [
  {
    id: "configure" as const,
    label: "配置策略",
    description: "选择框架与风险参数",
    icon: SlidersHorizontal,
  },
  {
    id: "backtest" as const,
    label: "合成回测",
    description: "90 日固定种子验证",
    icon: LineChart,
  },
  {
    id: "validate" as const,
    label: "真实验证",
    description: "固定策略组多窗口检验",
    icon: FlaskConical,
  },
  {
    id: "observe" as const,
    label: "Paper 观察",
    description: "候选池与研究管线",
    icon: Eye,
  },
];

export function StrategyWorkflow({
  activeStage,
  selectedStrategyName,
  committedStrategyName,
  hasRun,
  hasPendingChanges,
  onStageChange,
  children,
}: StrategyWorkflowProps) {
  const context = activeStage === "configure"
    ? {
        label: "当前配置",
        title: selectedStrategyName,
        description: "调整参数后运行回测；配置本身不代表策略已经通过验证。",
        warning: false,
      }
    : activeStage === "backtest"
      ? {
          label: hasPendingChanges ? "结果已过期" : "合成样本结果",
          title: committedStrategyName,
          description: hasPendingChanges
            ? "当前策略或参数已修改，本页仍展示上一次提交配置的结果，请返回配置阶段重新运行。"
            : "使用固定种子生成的 90 个交易日合成样本，可复现，但不是真实历史收益。",
          warning: hasPendingChanges,
        }
      : activeStage === "validate"
        ? {
            label: "独立真实验证",
            title: "12 只 A 股 · 14 个固定策略 · 三个窗口",
            description: "读取真实前复权日线验证预先固定参数，不复用浏览器当前参数，也不与合成排行榜混算。",
            warning: false,
          }
        : {
            label: "本地 Paper 观察",
            title: "候选池与人工复核",
            description: "候选扫描用于本地 paper 观察；当前配置不会自动加入执行器或连接真实券商。",
            warning: false,
          };

  return (
    <div className="strategy-workflow-shell">
      <section className="strategy-workflow" aria-labelledby="strategy-workflow-title">
        <div className="strategy-workflow-heading">
          <div>
            <span className="section-kicker">研究流程</span>
            <h2 id="strategy-workflow-title">从配置到 Paper 观察</h2>
          </div>
          <span className="strategy-workflow-progress">
            <CheckCircle2 size={15} />
            {hasRun ? "已有回测结果" : "等待首次回测"}
          </span>
        </div>

        <nav className="strategy-workflow-steps" aria-label="策略研究阶段">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const disabled = stage.id === "backtest" && !hasRun;
            return (
              <button
                aria-current={activeStage === stage.id ? "step" : undefined}
                className={activeStage === stage.id ? "active" : ""}
                disabled={disabled}
                key={stage.id}
                onClick={() => onStageChange(stage.id)}
                title={disabled ? "请先在配置阶段运行回测" : stage.description}
                type="button"
              >
                <span className="strategy-step-index">{index + 1}</span>
                <Icon size={17} />
                <span>
                  <strong>{stage.label}</strong>
                  <small>{disabled ? "先运行回测" : stage.description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className={context.warning ? "strategy-context warning" : "strategy-context"}>
          {context.warning ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
          <div>
            <span>{context.label}</span>
            <strong>{context.title}</strong>
            <p>{context.description}</p>
          </div>
          {context.warning && (
            <button onClick={() => onStageChange("configure")} type="button">
              返回配置
            </button>
          )}
        </div>
      </section>

      <div className="strategy-stage-content">{children}</div>
    </div>
  );
}
