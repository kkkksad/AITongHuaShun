export interface ResearchRefreshStateInput {
  hasData: boolean;
  isError: boolean;
}

export interface ResearchRefreshState {
  showBlockingError: boolean;
  showStaleWarning: boolean;
}

export function getResearchRefreshState({
  hasData,
  isError,
}: ResearchRefreshStateInput): ResearchRefreshState {
  return {
    showBlockingError: isError && !hasData,
    showStaleWarning: isError && hasData,
  };
}

export function formatResearchDataTime(dataUpdatedAt: number): string {
  if (dataUpdatedAt <= 0) return "未知";
  return new Date(dataUpdatedAt).toLocaleString("zh-CN", { hour12: false });
}