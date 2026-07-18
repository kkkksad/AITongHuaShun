import { AlertTriangle, Clock3 } from "lucide-react";
import {
  formatResearchDataTime,
  getResearchRefreshState,
} from "../lib/researchQueryPresentation";

interface ResearchQueryStateProps {
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  loadingText: string;
  unavailableText: string;
}

export function ResearchQueryState({
  hasData,
  isLoading,
  isError,
  dataUpdatedAt,
  loadingText,
  unavailableText,
}: ResearchQueryStateProps) {
  const state = getResearchRefreshState({ hasData, isError });

  return (
    <>
      {isLoading && !hasData && <div className="research-empty">{loadingText}</div>}
      {state.showBlockingError && (
        <div className="research-alert">
          <AlertTriangle size={16} />
          <span>{unavailableText}</span>
        </div>
      )}
      {state.showStaleWarning && (
        <div className="research-alert regime-warning">
          <Clock3 size={16} />
          <span>
            本次刷新失败，继续显示缓存数据 · 上次成功更新 {formatResearchDataTime(dataUpdatedAt)}
          </span>
        </div>
      )}
    </>
  );
}