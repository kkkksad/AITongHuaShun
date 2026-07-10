import { useState, useCallback } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Bell,
  ShieldAlert,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────
interface ApiKeyEntry {
  provider: string;
  label: string;
  key: string;
  masked: boolean;
}

interface NotificationPrefs {
  emailAlerts: boolean;
  pushAlerts: boolean;
  inAppAlerts: boolean;
  dailySummary: boolean;
  tradeExecution: boolean;
  riskBreach: boolean;
}

interface RiskParams {
  maxPositionPercent: number;
  dailyLossLimit: number;
  maxDrawdownLimit: number;
  maxLeverage: number;
  orderSizeLimit: number;
  autoStopTrading: boolean;
}

// ── Defaults ───────────────────────────────────────────────────
const defaultApiKeys: ApiKeyEntry[] = [
  { provider: "tonghuashun", label: "同花顺 OpenAPI", key: "", masked: true },
  { provider: "tushare", label: "Tushare Pro", key: "", masked: true },
  { provider: "deepseek", label: "DeepSeek AI", key: "", masked: true },
];

const defaultNotifications: NotificationPrefs = {
  emailAlerts: true,
  pushAlerts: false,
  inAppAlerts: true,
  dailySummary: true,
  tradeExecution: false,
  riskBreach: true,
};

const defaultRiskParams: RiskParams = {
  maxPositionPercent: 25,
  dailyLossLimit: 5,
  maxDrawdownLimit: 15,
  maxLeverage: 1,
  orderSizeLimit: 100000,
  autoStopTrading: true,
};

// ── Helper ─────────────────────────────────────────────────────
function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

// ── Sub-components ─────────────────────────────────────────────

function ApiKeySection({
  keys,
  onUpdate,
}: {
  keys: ApiKeyEntry[];
  onUpdate: (keys: ApiKeyEntry[]) => void;
}) {
  const [saved, setSaved] = useState(false);

  const handleKeyChange = (index: number, value: string) => {
    const next = [...keys];
    next[index] = { ...next[index], key: value };
    onUpdate(next);
    setSaved(false);
  };

  const toggleMask = (index: number) => {
    const next = [...keys];
    next[index] = { ...next[index], masked: !next[index].masked };
    onUpdate(next);
  };

  const handleSave = () => {
    // In a real app this would persist to localStorage or backend
    localStorage.setItem("kairos_api_keys", JSON.stringify(keys));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <KeyRound size={18} />
        <div>
          <h2>API 密钥配置</h2>
          <p>管理外部数据源与 AI 服务的访问凭据。密钥仅存储于本地浏览器。</p>
        </div>
      </div>

      <div className="settings-fields">
        {keys.map((entry, i) => (
          <div className="settings-field" key={entry.provider}>
            <label>{entry.label}</label>
            <div className="settings-input-group">
              <input
                aria-label={`${entry.label} API Key`}
                onChange={(e) => handleKeyChange(i, e.target.value)}
                placeholder="输入 API 密钥..."
                type={entry.masked ? "password" : "text"}
                value={entry.key}
              />
              <button
                aria-label={entry.masked ? "显示密钥" : "隐藏密钥"}
                className="settings-input-action"
                onClick={() => toggleMask(i)}
                type="button"
              >
                {entry.masked ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
            {entry.key && (
              <span className="settings-field-hint">
                当前: {maskKey(entry.key)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="settings-section-footer">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          type="button"
        >
          <Save size={16} />
          保存密钥
        </button>
        {saved && (
          <span className="settings-saved-badge">
            <CheckCircle2 size={14} />
            已保存
          </span>
        )}
      </div>
    </section>
  );
}

function NotificationSection({
  prefs,
  onUpdate,
}: {
  prefs: NotificationPrefs;
  onUpdate: (prefs: NotificationPrefs) => void;
}) {
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof NotificationPrefs) => {
    onUpdate({ ...prefs, [key]: !prefs[key] });
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem("kairos_notification_prefs", JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const toggles: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
    { key: "emailAlerts", label: "邮件告警", desc: "接收每日报告与关键事件邮件" },
    { key: "pushAlerts", label: "推送通知", desc: "浏览器推送通知（需授权）" },
    { key: "inAppAlerts", label: "应用内通知", desc: "在通知中心显示实时提醒" },
    { key: "dailySummary", label: "每日摘要", desc: "每个交易日结束后发送组合摘要" },
    { key: "tradeExecution", label: "交易执行通知", desc: "每次模拟交易成交时通知" },
    { key: "riskBreach", label: "风控预警", desc: "当触及风控限制时立即告警" },
  ];

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <Bell size={18} />
        <div>
          <h2>通知偏好</h2>
          <p>选择希望接收的通知类型与渠道。</p>
        </div>
      </div>

      <div className="settings-toggles">
        {toggles.map(({ key, label, desc }) => (
          <label className="settings-toggle-row" key={key}>
            <div>
              <strong>{label}</strong>
              <p>{desc}</p>
            </div>
            <input
              checked={prefs[key]}
              className="settings-switch"
              onChange={() => toggle(key)}
              type="checkbox"
            />
          </label>
        ))}
      </div>

      <div className="settings-section-footer">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          type="button"
        >
          <Save size={16} />
          保存偏好
        </button>
        {saved && (
          <span className="settings-saved-badge">
            <CheckCircle2 size={14} />
            已保存
          </span>
        )}
      </div>
    </section>
  );
}

function RiskSection({
  params,
  onUpdate,
}: {
  params: RiskParams;
  onUpdate: (params: RiskParams) => void;
}) {
  const [saved, setSaved] = useState(false);

  const handleChange = (key: keyof RiskParams, value: number | boolean) => {
    onUpdate({ ...params, [key]: value });
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem("kairos_risk_params", JSON.stringify(params));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    onUpdate(defaultRiskParams);
    setSaved(false);
  };

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <ShieldAlert size={18} />
        <div>
          <h2>风控参数</h2>
          <p>这些参数作为模拟交易的安全边界，所有策略均受其约束。</p>
        </div>
      </div>

      <div className="settings-fields">
        <div className="settings-field">
          <label>最大单仓位 (%)</label>
          <div className="settings-range-row">
            <input
              aria-label="最大单仓位"
              max={100}
              min={1}
              onChange={(e) => handleChange("maxPositionPercent", Number(e.target.value))}
              type="range"
              value={params.maxPositionPercent}
            />
            <span className="settings-range-value">{params.maxPositionPercent}%</span>
          </div>
          <span className="settings-field-hint">
            单一标的占总权益的最大比例
          </span>
        </div>

        <div className="settings-field">
          <label>单日亏损上限 (%)</label>
          <div className="settings-range-row">
            <input
              aria-label="单日亏损上限"
              max={20}
              min={1}
              onChange={(e) => handleChange("dailyLossLimit", Number(e.target.value))}
              type="range"
              value={params.dailyLossLimit}
            />
            <span className="settings-range-value">{params.dailyLossLimit}%</span>
          </div>
          <span className="settings-field-hint">
            触及后自动平仓并暂停当日交易
          </span>
        </div>

        <div className="settings-field">
          <label>最大回撤限制 (%)</label>
          <div className="settings-range-row">
            <input
              aria-label="最大回撤限制"
              max={50}
              min={5}
              onChange={(e) => handleChange("maxDrawdownLimit", Number(e.target.value))}
              type="range"
              value={params.maxDrawdownLimit}
            />
            <span className="settings-range-value">{params.maxDrawdownLimit}%</span>
          </div>
          <span className="settings-field-hint">
            从权益峰值计算的最大允许回撤
          </span>
        </div>

        <div className="settings-field">
          <label>最大杠杆倍数</label>
          <div className="settings-range-row">
            <input
              aria-label="最大杠杆倍数"
              max={5}
              min={1}
              onChange={(e) => handleChange("maxLeverage", Number(e.target.value))}
              step={0.5}
              type="range"
              value={params.maxLeverage}
            />
            <span className="settings-range-value">{params.maxLeverage}x</span>
          </div>
        </div>

        <div className="settings-field">
          <label>单笔订单上限 (CNY)</label>
          <input
            aria-label="单笔订单上限"
            className="settings-number-input"
            min={1000}
            onChange={(e) => handleChange("orderSizeLimit", Number(e.target.value))}
            step={10000}
            type="number"
            value={params.orderSizeLimit}
          />
        </div>

        <label className="settings-toggle-row">
          <div>
            <strong>自动熔断</strong>
            <p>触及风控限制时自动停止所有策略交易</p>
          </div>
          <input
            checked={params.autoStopTrading}
            className="settings-switch"
            onChange={(e) => handleChange("autoStopTrading", e.target.checked)}
            type="checkbox"
          />
        </label>
      </div>

      <div className="settings-section-footer">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          type="button"
        >
          <Save size={16} />
          保存参数
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleReset}
          type="button"
        >
          <RotateCcw size={16} />
          恢复默认
        </button>
        {saved && (
          <span className="settings-saved-badge">
            <CheckCircle2 size={14} />
            已保存
          </span>
        )}
      </div>

      <div className="settings-risk-note">
        <AlertTriangle size={16} />
        <span>
          风控参数一经修改，将立即应用于所有运行中的策略。建议在非交易时段调整。
        </span>
      </div>
    </section>
  );
}

// ── Main Settings Component ─────────────────────────────────────
export function Settings() {
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>(() => {
    try {
      const saved = localStorage.getItem("kairos_api_keys");
      return saved ? JSON.parse(saved) : defaultApiKeys;
    } catch {
      return defaultApiKeys;
    }
  });

  const [notifications, setNotifications] = useState<NotificationPrefs>(() => {
    try {
      const saved = localStorage.getItem("kairos_notification_prefs");
      return saved ? JSON.parse(saved) : defaultNotifications;
    } catch {
      return defaultNotifications;
    }
  });

  const [riskParams, setRiskParams] = useState<RiskParams>(() => {
    try {
      const saved = localStorage.getItem("kairos_risk_params");
      return saved ? JSON.parse(saved) : defaultRiskParams;
    } catch {
      return defaultRiskParams;
    }
  });

  const handleSaveAll = useCallback(() => {
    localStorage.setItem("kairos_api_keys", JSON.stringify(apiKeys));
    localStorage.setItem("kairos_notification_prefs", JSON.stringify(notifications));
    localStorage.setItem("kairos_risk_params", JSON.stringify(riskParams));
  }, [apiKeys, notifications, riskParams]);

  return (
    <div className="page-stack settings-page">
      <section className="settings-hero">
        <div>
          <span className="section-kicker">系统配置</span>
          <h2>设置</h2>
          <p>管理 API 密钥、通知偏好与风控参数。所有设置保存在本地浏览器中。</p>
        </div>
        <div className="settings-hero-actions">
          <button
            className="btn btn-primary"
            onClick={handleSaveAll}
            type="button"
          >
            <Zap size={16} />
            保存全部设置
          </button>
        </div>
      </section>

      <ApiKeySection keys={apiKeys} onUpdate={setApiKeys} />
      <NotificationSection prefs={notifications} onUpdate={setNotifications} />
      <RiskSection params={riskParams} onUpdate={setRiskParams} />
    </div>
  );
}
