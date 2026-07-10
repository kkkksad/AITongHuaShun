import type { ReactNode } from "react";
import {
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleUserRound,
  FlaskConical,
  LayoutDashboard,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ConnectionState } from "../hooks/useTradingBackend";
import type { TradingMode } from "../../shared/trading";

export type ViewId = "overview" | "strategy" | "market" | "account" | "learning";

interface AppShellProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  connectionState: ConnectionState;
  mode: TradingMode;
  children: ReactNode;
}

const navigation = [
  { id: "overview" as const, label: "总览", icon: LayoutDashboard },
  { id: "strategy" as const, label: "策略实验室", icon: FlaskConical },
  { id: "market" as const, label: "市场观察", icon: ChartNoAxesCombined },
  { id: "account" as const, label: "模拟账户", icon: BriefcaseBusiness },
  { id: "learning" as const, label: "研究管线", icon: BookOpenCheck },
];

const titles: Record<ViewId, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "研究控制台", title: "今日总览" },
  strategy: { eyebrow: "策略研究", title: "参数与回测" },
  market: { eyebrow: "市场观察", title: "指数、资金与事件" },
  account: { eyebrow: "模拟交易", title: "账户与订单" },
  learning: { eyebrow: "受控学习", title: "候选验证与审批" },
};

const connectionLabels: Record<ConnectionState, string> = {
  connected: "模拟行情实时连接",
  connecting: "正在连接交易后端",
  offline: "后端离线，静态演示",
};

export function AppShell({
  activeView,
  onViewChange,
  connectionState,
  mode,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BarChart3 size={21} />
          </div>
          <div>
            <strong>KAIROS</strong>
            <span>Quant Workbench</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={activeView === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => onViewChange(id)}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <div className="sidebar-note-title">
            <ShieldCheck size={17} />
            <span>研究环境</span>
          </div>
          <p>
            {connectionState === "connected"
              ? "行情与账户来自本地模拟后端，真实交易保持关闭。"
              : "后端未连接，页面保留静态研究数据作为降级展示。"}
          </p>
        </div>

        <div className="profile">
          <CircleUserRound size={30} />
          <div>
            <strong>Research Desk</strong>
            <span>本地工作区</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{titles[activeView].eyebrow}</span>
            <h1>{titles[activeView].title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input aria-label="搜索" placeholder="搜索标的或策略" />
            </label>
            <div className={`market-state connection-${connectionState}`}>
              <span
                className={
                  connectionState === "connected"
                    ? "status-dot"
                    : connectionState === "connecting"
                      ? "status-dot amber"
                      : "status-dot red"
                }
              />
              <span>{connectionLabels[connectionState]} · {mode}</span>
            </div>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
