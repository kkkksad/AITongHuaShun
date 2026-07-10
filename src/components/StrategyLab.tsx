import type { CSSProperties } from "react";
import { Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import { strategies } from "../data/mockData";
import type { StrategyId, StrategyParameters } from "../types";

interface StrategyLabProps {
  selectedStrategy: StrategyId;
  parameters: StrategyParameters;
  isRunning: boolean;
  onStrategyChange: (strategy: StrategyId) => void;
  onParameterChange: (key: keyof StrategyParameters, value: number) => void;
  onRun: () => void;
  onReset: () => void;
}

interface ParameterDefinition {
  key: keyof StrategyParameters;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const parameterDefinitions: ParameterDefinition[] = [
  { key: "lookback", label: "观察窗口", min: 5, max: 60, step: 1, unit: "日" },
  { key: "entryThreshold", label: "入场阈值", min: 0.5, max: 3, step: 0.1, unit: "σ" },
  { key: "stopLoss", label: "止损", min: 2, max: 15, step: 1, unit: "%" },
  { key: "takeProfit", label: "止盈", min: 5, max: 35, step: 1, unit: "%" },
  { key: "maxPosition", label: "最大仓位", min: 10, max: 80, step: 5, unit: "%" },
  { key: "rebalanceDays", label: "调仓频率", min: 1, max: 20, step: 1, unit: "日" },
];

export function StrategyLab({
  selectedStrategy,
  parameters,
  isRunning,
  onStrategyChange,
  onParameterChange,
  onRun,
  onReset,
}: StrategyLabProps) {
  return (
    <section className="panel strategy-lab">
      <div className="panel-header">
        <div>
          <span className="section-kicker">策略配置</span>
          <h2>选择研究框架</h2>
        </div>
        <SlidersHorizontal size={20} />
      </div>

      <div className="strategy-grid">
        {strategies.map((strategy) => (
          <button
            className={
              strategy.id === selectedStrategy ? "strategy-card selected" : "strategy-card"
            }
            key={strategy.id}
            onClick={() => onStrategyChange(strategy.id)}
            style={{ "--strategy-color": strategy.color } as CSSProperties}
            type="button"
          >
            <span className="strategy-tag">{strategy.tag}</span>
            <strong>{strategy.name}</strong>
            <p>{strategy.description}</p>
          </button>
        ))}
      </div>

      <div className="parameter-heading">
        <div>
          <span className="section-kicker">风险与执行</span>
          <h3>参数空间</h3>
        </div>
        <button className="text-button" onClick={onReset} type="button">
          <RotateCcw size={15} />
          恢复默认
        </button>
      </div>

      <div className="parameter-grid">
        {parameterDefinitions.map((definition) => {
          const value = parameters[definition.key];
          const progress =
            ((value - definition.min) / (definition.max - definition.min)) * 100;

          return (
            <label className="parameter-control" key={definition.key}>
              <span className="parameter-label">
                <span>{definition.label}</span>
                <strong>
                  {value}
                  <small>{definition.unit}</small>
                </strong>
              </span>
              <input
                max={definition.max}
                min={definition.min}
                onChange={(event) =>
                  onParameterChange(definition.key, Number(event.target.value))
                }
                step={definition.step}
                style={{ "--range-progress": `${progress}%` } as CSSProperties}
                type="range"
                value={value}
              />
            </label>
          );
        })}
      </div>

      <div className="run-bar">
        <div>
          <strong>固定随机种子</strong>
          <span>相同参数将产生可复现结果</span>
        </div>
        <button className="primary-button" disabled={isRunning} onClick={onRun} type="button">
          <Play fill="currentColor" size={16} />
          {isRunning ? "正在计算…" : "运行回测"}
        </button>
      </div>
    </section>
  );
}
