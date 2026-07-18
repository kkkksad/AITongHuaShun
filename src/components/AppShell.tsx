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
  LogOut,
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
import type { MarketDataProviderName } from "../lib/tradingApi";
import { filterQuickNavigationItems, getQuickNavigationKeyAction } from "../lib/quickNavigation";
import { MobileNav } from "./MobileNav";

export type ViewId = "overview" | "strategy" | "market" | "account" | "learning" | "settings";

interface AppShellProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
  connectionState: ConnectionState;
  realtimeState?: ConnectionState;
  mode: TradingMode;
  marketDataProvider?: MarketDataProviderName;
  authEnabled?: boolean;
  authUser?: string | null;
  onLogout?: () => void;
  children: ReactNode;
}

export function AppShell({
  activeView,
  onViewChange,
  connectionState,
  realtimeState,
  mode,
  marketDataProvider,
  authEnabled = false,
  authUser,
  onLogout,
  children,
}: AppShellProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const handleNavClick = (view: ViewId) => {
    onViewChange(view);
    setMobileMenuOpen(false);
  };

  const toggleLocale = useCallback(() => {
    setLocale(locale === "zh" ? "en" : "zh");
  }, [locale, setLocale]);

  const navigationGroups = [
    {
      label: locale === "zh" ? "工作台" : "Workspace",
      items: [
        { id: "overview" as const, label: t("nav.overview"), icon: LayoutDashboard },
      ],
    },
    {
      label: locale === "zh" ? "研究" : "Research",
      items: [
        { id: "market" as const, label: t("nav.market"), icon: ChartNoAxesCombined },
        { id: "strategy" as const, label: t("nav.strategy"), icon: FlaskConical },
        { id: "learning" as const, label: t("nav.learning"), icon: BookOpenCheck },
      ],
    },
    {
      label: locale === "zh" ? "交易与管理" : "Trading & admin",
      items: [
        { id: "account" as const, label: t("nav.account"), icon: BriefcaseBusiness },
        { id: "settings" as const, label: t("nav.settings"), icon: Settings },
      ],
    },
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
  const quickKeywords: Record<ViewId, string[]> = locale === "zh" ? {
    overview: ["首页", "工作台"],
    market: ["行情", "研判", "股票"],
    strategy: ["回测", "验证", "实验"],
    account: ["模拟下单", "下单", "订单", "持仓", "风控"],
    learning: ["学习", "研究进度", "复盘"],
    settings: ["配置", "系统"],
  } : {
    overview: ["home", "workspace"],
    market: ["quotes", "stocks"],
    strategy: ["backtest", "validation"],
    account: ["paper order", "orders", "positions", "risk"],
    learning: ["pipeline", "review"],
    settings: ["configuration", "system"],
  };
  const quickItems = navigationGroups.flatMap((group) => group.items.map((item) => ({
    ...item,
    group: group.label,
    title: titles[item.id].title,
    keywords: quickKeywords[item.id],
  })));
  const quickMatches = filterQuickNavigationItems(quickItems, quickQuery);

  const handleQuickSelect = (view: ViewId) => {
    handleNavClick(view);
    setQuickQuery("");
    setQuickOpen(false);
  };
  const realtimeLabels: Record<ConnectionState, string> = {
    connected: t("connection.realtime.connected"),
    connecting: t("connection.realtime.connecting"),
    offline: t("connection.realtime.offline"),
  };
  const providerLabel =
    marketDataProvider === "akshare"
      ? t("connection.provider.akshare")
      : t("connection.provider.mock");
  const detailLabel = realtimeState
    ? `${mode} · ${providerLabel} · ${realtimeLabels[realtimeState]}`
    : `${mode} · ${providerLabel}`;

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
            <strong>玄枢 Quant</strong>
            <span>{t("brand.subtitle")}</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label={locale === "zh" ? "主导航" : "Main navigation"}>
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map(({ id, label, icon: Icon }) => (
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
            </div>
          ))}
        </nav>

        <div className="sidebar-note">
          <div className="sidebar-note-title">
            <ShieldCheck size={17} />
            <span>{t("sidebar.note.title")}</span>
          </div>
          <p>
            {connectionState === "connected"
              ? marketDataProvider === "akshare"
                ? t("sidebar.note.connected.akshare")
                : t("sidebar.note.connected")
              : t("sidebar.note.offline")}
          </p>
        </div>

        <div className="profile">
          <CircleUserRound size={30} />
          <div>
            <strong>{authUser || t("profile.name")}</strong>
            <span>{authEnabled ? t("profile.auth.enabled") : t("profile.auth.local")}</span>
          </div>
          {authEnabled && onLogout && (
            <button
              aria-label={t("auth.logout")}
              className="profile-logout"
              onClick={onLogout}
              title={t("auth.logout")}
              type="button"
            >
              <LogOut size={15} />
              <span>{t("auth.logout")}</span>
            </button>
          )}
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
            <div
              className="quick-nav"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setQuickOpen(false);
                }
              }}
            >
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-autocomplete="list"
                  aria-controls="quick-nav-results"
                  aria-expanded={quickOpen}
                  aria-label={locale === "zh" ? "快速跳转" : "Quick navigation"}
                  autoComplete="off"
                  id="global-search"
                  name="global-search"
                  onChange={(event) => {
                    setQuickQuery(event.target.value);
                    setQuickOpen(true);
                  }}
                  onFocus={() => setQuickOpen(true)}
                  onKeyDown={(event) => {
                    const action = getQuickNavigationKeyAction(event.key, quickMatches);
                    if (action.type === "close") {
                      event.preventDefault();
                      setQuickOpen(false);
                    } else if (action.type === "select") {
                      event.preventDefault();
                      handleQuickSelect(action.id);
                    }
                  }}
                  placeholder={locale === "zh" ? "快速跳转页面" : "Go to page"}
                  role="combobox"
                  value={quickQuery}
                />
              </div>
              {quickOpen && (
                <div className="quick-nav-results" id="quick-nav-results" role="listbox">
                  {quickMatches.length === 0 ? (
                    <span className="quick-nav-empty">没有匹配页面</span>
                  ) : quickMatches.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        aria-selected={activeView === item.id}
                        className={activeView === item.id ? "active" : ""}
                        key={item.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleQuickSelect(item.id)}
                        role="option"
                        type="button"
                      >
                        <Icon size={16} />
                        <span><strong>{item.label}</strong><small>{item.group}</small></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
            {authEnabled && onLogout && (
              <button
                aria-label={t("auth.logout")}
                className="topbar-logout"
                onClick={onLogout}
                title={t("auth.logout")}
                type="button"
              >
                <LogOut size={17} />
                <span>{t("auth.logout")}</span>
              </button>
            )}
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
              <span>
                {connectionLabels[connectionState]} · {detailLabel}
              </span>
            </div>
          </div>
        </header>
        <main className="main-content">{children}</main>
        <MobileNav activeView={activeView} onViewChange={onViewChange} />
      </div>
    </div>
  );
}
