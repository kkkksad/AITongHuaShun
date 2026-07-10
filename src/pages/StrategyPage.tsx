import { useMemo, useState } from "react";
import { BacktestResults } from "../components/BacktestResults";
import { StrategyCompare } from "../components/StrategyCompare";
import { StrategyLab } from "../components/StrategyLab";
import { strategies } from "../data/mockData";
import { runBacktest } from "../lib/backtest";
import type { StrategyId, StrategyParameters } from "../types";

const defaultParameters: StrategyParameters = {
  lookback: 20,
  entryThreshold: 1.4,
  stopLoss: 6,
  takeProfit: 15,
  maxPosition: 35,
  rebalanceDays: 5,
};

export default function StrategyPage() {
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId>("momentum");
  const [parameters, setParameters] = useState<StrategyParameters>(defaultParameters);
  const [committedParameters, setCommittedParameters] =
    useState<StrategyParameters>(defaultParameters);
  const [committedStrategy, setCommittedStrategy] = useState<StrategyId>("momentum");
  const [isRunning, setIsRunning] = useState(false);

  const result = useMemo(
    () => runBacktest(committedStrategy, committedParameters),
    [committedParameters, committedStrategy],
  );

  const allStrategyResults = useMemo(
    () =>
      strategies.map((strategy) => ({
        strategy,
        result: runBacktest(strategy.id, committedParameters),
      })),
    [committedParameters],
  );

  const handleRun = () => {
    setIsRunning(true);
    window.setTimeout(() => {
      setCommittedStrategy(selectedStrategy);
      setCommittedParameters({ ...parameters });
      setIsRunning(false);
    }, 420);
  };

  return (
    <div className="page-stack">
      <StrategyLab
        isRunning={isRunning}
        onParameterChange={(key, value) =>
          setParameters((current) => ({ ...current, [key]: value }))
        }
        onReset={() => setParameters(defaultParameters)}
        onRun={handleRun}
        onStrategyChange={setSelectedStrategy}
        parameters={parameters}
        selectedStrategy={selectedStrategy}
      />
      <BacktestResults result={result} />
      <StrategyCompare results={allStrategyResults} />
    </div>
  );
}
