import { Activity, Cpu, Server, Wifi, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/tradingApi";

interface SystemMetrics {
  ok: boolean;
  mode: string;
  marketDataProvider: string;
  websocketConnections: number;
  timestamp: string;
}

interface MetricCard {
  label: string;
  value: string;
  unit?: string;
  color?: "green" | "amber" | "red";
  icon: React.ReactNode;
}

export function SystemMonitor() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchMetrics = async () => {
      try {
        const data = await apiRequest<SystemMetrics>("/api/health");
        if (mounted) {
          setMetrics(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "连接失败");
        }
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const cards: MetricCard[] = [
    {
      label: "服务状态",
      value: metrics?.ok ? "正常" : "异常",
      color: metrics?.ok ? "green" : "red",
      icon: <Server size={18} />,
    },
    {
      label: "运行模式",
      value: metrics?.mode ?? "—",
      icon: <Activity size={18} />,
    },
    {
      label: "行情源",
      value: metrics?.marketDataProvider ?? "—",
      icon: <Zap size={18} />,
    },
    {
      label: "WS 连接数",
      value: metrics?.websocketConnections?.toString() ?? "0",
      unit: "个",
      icon: <Wifi size={18} />,
    },
  ];

  return (
    <div className="metrics-panel">
      {error && (
        <div className="metrics-endpoint">
          <p style={{ color: "var(--color-negative)" }}>
            ⚠ 无法获取系统指标：{error}
          </p>
        </div>
      )}

      <div className="metrics-grid">
        {cards.map((card) => (
          <div
            className={`metric-card${card.color ? ` metric-${card.color}` : ""}`}
            key={card.label}
          >
            <span className="metric-label">{card.label}</span>
            <span className="metric-value">{card.value}</span>
            {card.unit && <span className="metric-unit">{card.unit}</span>}
          </div>
        ))}
      </div>

      <div className="metrics-endpoint">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Cpu size={16} style={{ color: "var(--text-muted)" }} />
          <p>
            Prometheus 指标端点可用，用于集成 Grafana 等监控系统。
          </p>
        </div>
        <code>GET /metrics</code>
        {metrics?.timestamp && (
          <p style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted)" }}>
            最后更新：{new Date(metrics.timestamp).toLocaleTimeString("zh-CN")}
          </p>
        )}
      </div>
    </div>
  );
}
