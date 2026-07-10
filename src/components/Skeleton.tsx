import type { CSSProperties, ReactNode } from "react";

export type SkeletonVariant = "card" | "table" | "text" | "avatar" | "inline";

export interface SkeletonProps {
  /** Visual variant of the skeleton placeholder. */
  variant?: SkeletonVariant;
  /** Number of skeleton items to render (for card/table/avatar). */
  count?: number;
  /** Custom CSS class applied to the wrapper. */
  className?: string;
  /** Custom inline styles applied to the wrapper. */
  style?: CSSProperties;
  /** Show a loading text below the skeleton. */
  loadingText?: string;
  /** Number of text lines (only used when variant="text"). */
  lines?: number;
}

/* ── Shared shimmer animation keyframes is injected once via <style> ── */

const shimmerKeyframes = `
@keyframes sk-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
`;

let styleInjected = false;
function ensureShimmerStyle(): void {
  if (typeof document === "undefined") return;
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-skeleton-shimmer", "");
  style.textContent = shimmerKeyframes;
  document.head.appendChild(style);
}

/* ── Base shimmer class helpers ── */

const shimmerBase: CSSProperties = {
  background:
    "linear-gradient(90deg, hsl(220 10% 93%) 25%, hsl(220 10% 97%) 50%, hsl(220 10% 93%) 75%)",
  backgroundSize: "400px 100%",
  animation: "sk-shimmer 1.4s ease-in-out infinite",
  borderRadius: 6,
};

function shimmerStyle(extra?: CSSProperties): CSSProperties {
  ensureShimmerStyle();
  return { ...shimmerBase, ...extra };
}

/* ── Variant renderers ── */

function CardSkeleton({ count }: { count: number }): ReactNode {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-card" key={i} style={{ marginBottom: 16 }}>
          <div style={shimmerStyle({ height: 140, width: "100%", borderRadius: "8px 8px 0 0" })} />
          <div style={{ padding: "12px 14px" }}>
            <div style={shimmerStyle({ height: 18, width: "65%", marginBottom: 8 })} />
            <div style={shimmerStyle({ height: 14, width: "45%" })} />
          </div>
        </div>
      ))}
    </>
  );
}

function TableSkeleton({ count }: { count: number }): ReactNode {
  const rows = 5;
  const cols = 4;
  return (
    <div className="sk-table" style={{ overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        {Array.from({ length: cols }, (_, i) => (
          <div
            key={`h-${i}`}
            style={shimmerStyle({ height: 16, flex: 1 })}
          />
        ))}
      </div>
      {/* body */}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={`${r}-${c}`}
              style={shimmerStyle({ height: 14, flex: 1 })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TextSkeleton({ lines }: { lines: number }): ReactNode {
  return (
    <div className="sk-text">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          style={shimmerStyle({
            height: 14,
            width: i === lines - 1 ? "55%" : "100%",
            marginBottom: 10,
          })}
        />
      ))}
    </div>
  );
}

function AvatarSkeleton({ count }: { count: number }): ReactNode {
  return (
    <div className="sk-avatars" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={shimmerStyle({ height: 40, width: 40, borderRadius: "50%" })} />
          <div>
            <div style={shimmerStyle({ height: 14, width: 80, marginBottom: 6 })} />
            <div style={shimmerStyle({ height: 12, width: 60 })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InlineSkeleton(): ReactNode {
  return (
    <span
      className="sk-inline"
      style={{
        display: "inline-block",
        ...shimmerStyle({ height: "1em", width: "6em", verticalAlign: "middle" }),
      }}
    />
  );
}

/* ── Main component ── */

export function Skeleton({
  variant = "card",
  count = 3,
  className,
  style,
  loadingText,
  lines = 4,
}: SkeletonProps): ReactNode {
  let content: ReactNode;

  switch (variant) {
    case "card":
      content = <CardSkeleton count={count} />;
      break;
    case "table":
      content = <TableSkeleton count={count} />;
      break;
    case "text":
      content = <TextSkeleton lines={lines} />;
      break;
    case "avatar":
      content = <AvatarSkeleton count={count} />;
      break;
    case "inline":
      content = <InlineSkeleton />;
      break;
    default:
      content = <CardSkeleton count={count} />;
  }

  return (
    <div className={`skeleton-wrapper ${className ?? ""}`} style={style}>
      {content}
      {loadingText && (
        <p className="skeleton-loading-text" style={{ textAlign: "center", color: "#8b8b8b", marginTop: 12, fontSize: 13 }}>
          {loadingText}
        </p>
      )}
    </div>
  );
}

/* ── Convenience pre-built fallback for lazy routes ── */

export function LazyFallback({ text = "加载中…" }: { text?: string }): ReactNode {
  return (
    <div className="page-loader" style={{ minHeight: 200 }}>
      <Skeleton variant="card" count={1} loadingText={text} />
    </div>
  );
}
