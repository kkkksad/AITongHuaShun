// ── KAIROS i18n Translations ──────────────────────────────────
// All UI strings in Chinese (zh) and English (en).
// Add new keys here and use the t() function in components.

export type Locale = "zh" | "en";
export type TranslationKey = keyof typeof translations.zh;

export const translations = {
  zh: {
    // ── App Shell / Navigation ──────────────────────────
    "nav.overview": "总览",
    "nav.strategy": "策略实验室",
    "nav.market": "市场观察",
    "nav.account": "模拟账户",
    "nav.learning": "研究管线",
    "nav.settings": "系统设置",

    "title.overview": "今日总览",
    "title.strategy": "参数与回测",
    "title.market": "指数、资金与事件",
    "title.account": "账户与订单",
    "title.learning": "候选验证与审批",
    "title.settings": "设置",

    "eyebrow.overview": "研究控制台",
    "eyebrow.strategy": "策略研究",
    "eyebrow.market": "市场观察",
    "eyebrow.account": "模拟交易",
    "eyebrow.learning": "受控学习",
    "eyebrow.settings": "系统配置",

    "brand.subtitle": "量化工作台",
    "sidebar.note.title": "研究环境",
    "sidebar.note.connected": "行情与账户来自本地模拟后端，真实交易保持关闭。",
    "sidebar.note.offline": "后端未连接，页面保留静态研究数据作为降级展示。",
    "profile.name": "Research Desk",
    "profile.role": "本地工作区",

    "search.placeholder": "搜索标的或策略",
    "theme.light": "切换到暗色主题",
    "theme.dark": "切换到亮色主题",
    "theme.mode.light": "暗色模式",
    "theme.mode.dark": "亮色模式",

    "connection.connected": "模拟行情实时连接",
    "connection.connecting": "正在连接交易后端",
    "connection.offline": "后端离线，静态演示",

    "menu.open": "打开菜单",
    "menu.close": "关闭菜单",

    // ── Settings ─────────────────────────────────────────
    "settings.saveAll": "保存全部设置",
    "settings.saved": "已保存",

    "settings.apiKeys.title": "API 密钥配置",
    "settings.apiKeys.desc": "管理外部数据源与 AI 服务的访问凭据。密钥仅存储于本地浏览器。",
    "settings.apiKeys.placeholder": "输入 API 密钥...",
    "settings.apiKeys.show": "显示密钥",
    "settings.apiKeys.hide": "隐藏密钥",
    "settings.apiKeys.current": "当前:",
    "settings.apiKeys.save": "保存密钥",

    "settings.notifications.title": "通知偏好",
    "settings.notifications.desc": "选择希望接收的通知类型与渠道。",
    "settings.notifications.save": "保存偏好",
    "settings.notifications.emailAlerts": "邮件告警",
    "settings.notifications.emailAlerts.desc": "接收每日报告与关键事件邮件",
    "settings.notifications.pushAlerts": "推送通知",
    "settings.notifications.pushAlerts.desc": "浏览器推送通知（需授权）",
    "settings.notifications.inAppAlerts": "应用内通知",
    "settings.notifications.inAppAlerts.desc": "在通知中心显示实时提醒",
    "settings.notifications.dailySummary": "每日摘要",
    "settings.notifications.dailySummary.desc": "每个交易日结束后发送组合摘要",
    "settings.notifications.tradeExecution": "交易执行通知",
    "settings.notifications.tradeExecution.desc": "每次模拟交易成交时通知",
    "settings.notifications.riskBreach": "风控预警",
    "settings.notifications.riskBreach.desc": "当触及风控限制时立即告警",

    "settings.risk.title": "风控参数",
    "settings.risk.desc": "这些参数作为模拟交易的安全边界，所有策略均受其约束。",
    "settings.risk.save": "保存参数",
    "settings.risk.reset": "恢复默认",
    "settings.risk.maxPositionPercent": "最大单仓位 (%)",
    "settings.risk.maxPositionPercent.hint": "单一标的占总权益的最大比例",
    "settings.risk.dailyLossLimit": "单日亏损上限 (%)",
    "settings.risk.dailyLossLimit.hint": "触及后自动平仓并暂停当日交易",
    "settings.risk.maxDrawdownLimit": "最大回撤限制 (%)",
    "settings.risk.maxDrawdownLimit.hint": "从权益峰值计算的最大允许回撤",
    "settings.risk.maxLeverage": "最大杠杆倍数",
    "settings.risk.orderSizeLimit": "单笔订单上限 (CNY)",
    "settings.risk.autoStopTrading": "自动熔断",
    "settings.risk.autoStopTrading.desc": "触及风控限制时自动停止所有策略交易",
    "settings.risk.warning": "风控参数一经修改，将立即应用于所有运行中的策略。建议在非交易时段调整。",

    // ── PWA ──────────────────────────────────────────────
    "pwa.install.title": "安装 KAIROS",
    "pwa.install.desc": "将此应用安装到桌面以获得更佳体验",
    "pwa.install.button": "安装",
    "pwa.install.dismiss": "暂不",
    "pwa.offline": "您当前处于离线状态，显示缓存数据。",
    "pwa.update": "新版本可用，刷新以更新。",

    // ── Language Switcher ────────────────────────────────
    "lang.switch": "English",
    "lang.label": "语言",
  },

  en: {
    // ── App Shell / Navigation ──────────────────────────
    "nav.overview": "Overview",
    "nav.strategy": "Strategy Lab",
    "nav.market": "Market Watch",
    "nav.account": "Paper Account",
    "nav.learning": "Research Pipeline",
    "nav.settings": "Settings",

    "title.overview": "Today's Overview",
    "title.strategy": "Parameters & Backtest",
    "title.market": "Indices, Flows & Events",
    "title.account": "Account & Orders",
    "title.learning": "Candidate Validation",
    "title.settings": "Settings",

    "eyebrow.overview": "Research Console",
    "eyebrow.strategy": "Strategy Research",
    "eyebrow.market": "Market Watch",
    "eyebrow.account": "Paper Trading",
    "eyebrow.learning": "Controlled Learning",
    "eyebrow.settings": "System Config",

    "brand.subtitle": "Quant Workbench",
    "sidebar.note.title": "Research Environment",
    "sidebar.note.connected":
      "Market data and account from local simulation backend. Live trading is disabled.",
    "sidebar.note.offline":
      "Backend disconnected. Static research data shown as fallback.",
    "profile.name": "Research Desk",
    "profile.role": "Local Workspace",

    "search.placeholder": "Search symbols or strategies",
    "theme.light": "Switch to dark theme",
    "theme.dark": "Switch to light theme",
    "theme.mode.light": "Dark Mode",
    "theme.mode.dark": "Light Mode",

    "connection.connected": "Live simulated feed",
    "connection.connecting": "Connecting to backend",
    "connection.offline": "Backend offline, demo",

    "menu.open": "Open menu",
    "menu.close": "Close menu",

    // ── Settings ─────────────────────────────────────────
    "settings.saveAll": "Save All Settings",
    "settings.saved": "Saved",

    "settings.apiKeys.title": "API Key Configuration",
    "settings.apiKeys.desc":
      "Manage credentials for external data sources and AI services. Keys stored locally in your browser.",
    "settings.apiKeys.placeholder": "Enter API key...",
    "settings.apiKeys.show": "Show key",
    "settings.apiKeys.hide": "Hide key",
    "settings.apiKeys.current": "Current:",
    "settings.apiKeys.save": "Save Keys",

    "settings.notifications.title": "Notification Preferences",
    "settings.notifications.desc": "Choose which notifications you want to receive.",
    "settings.notifications.save": "Save Preferences",
    "settings.notifications.emailAlerts": "Email Alerts",
    "settings.notifications.emailAlerts.desc":
      "Receive daily reports and key event emails",
    "settings.notifications.pushAlerts": "Push Notifications",
    "settings.notifications.pushAlerts.desc":
      "Browser push notifications (requires permission)",
    "settings.notifications.inAppAlerts": "In-App Alerts",
    "settings.notifications.inAppAlerts.desc":
      "Real-time alerts in notification center",
    "settings.notifications.dailySummary": "Daily Summary",
    "settings.notifications.dailySummary.desc":
      "Portfolio summary after each trading day",
    "settings.notifications.tradeExecution": "Trade Execution",
    "settings.notifications.tradeExecution.desc":
      "Notify on each simulated trade fill",
    "settings.notifications.riskBreach": "Risk Breach Alerts",
    "settings.notifications.riskBreach.desc":
      "Immediate alert when risk limits are hit",

    "settings.risk.title": "Risk Parameters",
    "settings.risk.desc":
      "These parameters act as safety boundaries for simulated trading. All strategies are bound by them.",
    "settings.risk.save": "Save Parameters",
    "settings.risk.reset": "Reset to Defaults",
    "settings.risk.maxPositionPercent": "Max Single Position (%)",
    "settings.risk.maxPositionPercent.hint":
      "Maximum percentage of total equity per single holding",
    "settings.risk.dailyLossLimit": "Daily Loss Limit (%)",
    "settings.risk.dailyLossLimit.hint":
      "Auto-close positions and suspend trading for the day when hit",
    "settings.risk.maxDrawdownLimit": "Max Drawdown Limit (%)",
    "settings.risk.maxDrawdownLimit.hint":
      "Maximum allowed drawdown from equity peak",
    "settings.risk.maxLeverage": "Max Leverage",
    "settings.risk.orderSizeLimit": "Max Order Size (CNY)",
    "settings.risk.autoStopTrading": "Auto Circuit Breaker",
    "settings.risk.autoStopTrading.desc":
      "Automatically stop all strategy trading when risk limits are breached",
    "settings.risk.warning":
      "Risk parameter changes take effect immediately on all running strategies. Adjust during non-trading hours if possible.",

    // ── PWA ──────────────────────────────────────────────
    "pwa.install.title": "Install KAIROS",
    "pwa.install.desc":
      "Add this app to your home screen for a better experience",
    "pwa.install.button": "Install",
    "pwa.install.dismiss": "Not now",
    "pwa.offline": "You are offline. Showing cached data.",
    "pwa.update": "New version available. Refresh to update.",

    // ── Language Switcher ────────────────────────────────
    "lang.switch": "中文",
    "lang.label": "Language",
  },
} as const;

// ── Locale metadata ──────────────────────────────────────────
export const localeLabels: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};
