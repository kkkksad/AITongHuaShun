import type { CSSProperties } from "react";

export const CHART_GRID_STROKE = "var(--border-light)";

export const CHART_AXIS_TICK = {
  fill: "var(--text-muted)",
  fontSize: 11,
} as const;

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  color: "var(--text-primary)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  boxShadow: "0 8px 22px rgba(28, 35, 49, 0.12)",
  fontSize: 12,
};

export const CHART_COLORS = {
  primary: "#2563eb",
  positive: "#0f766e",
  negative: "#dc4c4c",
  warning: "#b7791f",
  muted: "#8a94a3",
  volume: "#d9e3ee",
} as const;
