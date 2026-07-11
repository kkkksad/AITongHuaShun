import { useCallback, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleUserRound,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import type { ConnectionState } from "../hooks/useTradingBackend";
import { useTheme } from "../hooks/useTheme";
import { useI18n, type Locale } from "../i18n";
import type { TradingMode } from "../../shared/trading";
import { MobileNav } from "./MobileNav";

export type ViewId = "overview" | "strategy" | "market" | "account" | "learning" | "settings";

interface AppShellProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  connectionState: ConnectionState;
  mode: TradingMode;
  children: ReactNode;
}

export function AppShell({
  activeView,
  onViewChange,
  connectionState,
  mode,
  children,
}: AppShellProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (view: ViewId) => {
    onViewChange(view);
    setMobileMenuOpen(false);
  };

  const toggleLocale = useCallback(() => {
    setLocale(locale === "zh" ? "en" : "zh");
  }, [locale, setLocale]);

  const navigation = [
    { id: "overview" as const, label: t("nav.overview"), icon: LayoutDashboard },
    { id: "strategy" as const, label: t("nav.strategy"), icon: FlaskConical },
    { id: "market" as const, label: t("nav.market"), icon: ChartNoAxesCombined },
    { id: "account" as const, label: t("nav.account"), icon: BriefcaseBusiness },
    { id: "learning" as const, label: t("nav.learning"), icon: BookOpenCheck },
    { id: "settings" as const, label: t("nav.settings"), icon: Settings },
  ];

  const titles: Record<ViewId, { eyebrow: string; title: string }> = {
    overview: { eyebrow: t("eyebrow.overview"), title: t("title.overview") },
    strategy: { eyebrow: t("eyebrow.strategy"), title: t("title.strategy") },
    market: { eyebrow: t("eyebrow.market"), title: t("title.market") },
    account: { eyebrow: t("eyebrow.account"), title: t("title.account") },
    learning: { eyebrow: t("eyebrow.learning"), title: t("title.learning") },
    settings: { eyebrow: t("eyebrow.settings"), title: t("title.settings") },
  };

  const connectionLabels: Record<ConnectionState, string> = {
    connected: t("connection.connected"),
    connecting: t("connection.connecting"),
    offline: t("connection.offline"),
  };

  return (
    <div className="app-shell">
      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
          role="presentation"
        />
      )}

      <aside className={`sidebar${mobileMenuOpen ? " mobile-open" : ""}`}>
        {/* Close button for mobile */}
        <button
          aria-label={t("menu.close")}
          className="mobile-menu-close"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        >
          <X size={20} />
        </button>

        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BarChart3 size={21} />
          </div>
          <div>
            <strong>KAIROS</strong>
            <span>{t("brand.subtitle")}</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label={locale === "zh" ? "主导航" : "Main navigation"}>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={activeView === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => handleNavClick(id)}
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
            <span>{t("sidebar.note.title")}</span>
          </div>
          <p>
            {connectionState === "connected"
              ? t("sidebar.note.connected")
              : t("sidebar.note.offline")}
          </p>
        </div>

        <div className="profile">
          <CircleUserRound size={30} />
          <div>
            <strong>{t("profile.name")}</strong>
            <span>{t("profile.role")}</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left-group">
            {/* Mobile hamburger */}
            <button
              aria-label={t("menu.open")}
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
            >
              <Menu size={20} />
            </button>
            <div>
              <span className="eyebrow">{titles[activeView].eyebrow}</span>
              <h1>{titles[activeView].title}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label={locale === "zh" ? "搜索" : "Search"}
                id="global-search"
                name="global-search"
                placeholder={t("search.placeholder")}
              />
            </label>
            {/* Language switcher */}
            <button
              aria-label={t("lang.label")}
              className="lang-toggle"
              onClick={toggleLocale}
              title={t("lang.switch")}
              type="button"
            >
              <Globe size={17} />
              <span className="lang-label">{locale === "zh" ? "EN" : "中文"}</span>
            </button>
            <button
              aria-label={theme === "light" ? t("theme.light") : t("theme.dark")}
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "light" ? t("theme.mode.light") : t("theme.mode.dark")}
              type="button"
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
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
        <MobileNav activeView={activeView} onViewChange={onViewChange} />
      </div>
    </div>
  );
}
