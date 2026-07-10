import {
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  FlaskConical,
  LayoutDashboard,
} from "lucide-react";
import type { ViewId } from "./AppShell";

interface MobileNavProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

type NavItem = {
  id: ViewId;
  icon: typeof LayoutDashboard;
  labelKey: string;
};

const navItems: NavItem[] = [
  { id: "overview", icon: LayoutDashboard, labelKey: "总览" },
  { id: "strategy", icon: FlaskConical, labelKey: "策略" },
  { id: "market", icon: ChartNoAxesCombined, labelKey: "行情" },
  { id: "account", icon: BriefcaseBusiness, labelKey: "账户" },
  { id: "learning", icon: BookOpenCheck, labelKey: "研究" },
];

export function MobileNav({ activeView, onViewChange }: MobileNavProps) {
  return (
    <nav aria-label="移动端导航" className="mobile-nav">
      {navItems.map(({ id, icon: Icon, labelKey }) => {
        const isActive = activeView === id;
        return (
          <button
            className={`mobile-nav-item${isActive ? " active" : ""}`}
            key={id}
            onClick={() => onViewChange(id)}
            type="button"
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={22} />
            <span>{labelKey}</span>
            {isActive && <div className="mobile-nav-indicator" />}
          </button>
        );
      })}
    </nav>
  );
}
