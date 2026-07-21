import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { PaperStrategyProfile } from "../../shared/trading";
import type { TradingBackend } from "../hooks/useTradingBackend";

interface SettingsProps {
  trading: TradingBackend;
}

interface StrategyProfileOption {
  key: PaperStrategyProfile;
  label: string;
  cashReserve: string;
  pace: string;
  summary: string;
}

export const strategyProfileOptions: StrategyProfileOption[] = [
  {
    key: "capital-preservation",
    label: "现金防守",
    cashReserve: "至少 80% 现金",
    pace: "停止新增",
    summary: "市场不明或需要暂时收缩风险时，只处理已有持仓。",
  },
  {
    key: "defensive",
    label: "稳健",
    cashReserve: "至少 55% 现金",
    pace: "每轮最多 1 只",
    summary: "提高候选门槛并缩小新仓，优先控制回撤。",
  },
  {
    key: "balanced",
    label: "均衡",
    cashReserve: "至少 50% 现金",
    pace: "每轮最多 2 只",
    summary: "在现金缓冲和机会参与之间保持中等节奏。",
  },
  {
    key: "growth",
    label: "进取",
    cashReserve: "至少 20% 现金",
    pace: "每轮最多 3 只",
    summary: "允许更高资金参与，但不会放宽 T+1、整手和硬风控。",
  },
];

export function canResetPaperAccount(input: {
  startingCash: number;
  confirmation: string;
  acknowledged: boolean;
  mode: TradingBackend["mode"];
  pending: boolean;
}): boolean {
  return (
    input.mode === "paper" &&
    !input.pending &&
    input.acknowledged &&
    input.confirmation === "重置模拟账户" &&
    Number.isFinite(input.startingCash) &&
    input.startingCash >= 1_000 &&
    input.startingCash <= 100_000_000
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function Settings({ trading }: SettingsProps) {
  const [selectedProfile, setSelectedProfile] = useState<PaperStrategyProfile>(
    trading.account?.strategyProfile ?? "balanced",
  );
  const [startingCash, setStartingCash] = useState(
    String(trading.account?.startingEquity ?? 10_000),
  );
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    localStorage.removeItem("kairos_api_keys");
    localStorage.removeItem("kairos_risk_params");
  }, []);

  useEffect(() => {
    if (trading.account?.strategyProfile) {
      setSelectedProfile(trading.account.strategyProfile);
    }
    if (trading.account?.startingEquity !== undefined) {
      setStartingCash(String(trading.account.startingEquity));
    }
  }, [trading.account?.startingEquity, trading.account?.strategyProfile]);

  const numericStartingCash = Number(startingCash);
  const resetEnabled = useMemo(
    () => canResetPaperAccount({
      startingCash: numericStartingCash,
      confirmation,
      acknowledged,
      mode: trading.mode,
      pending: trading.pendingAction,
    }),
    [
      acknowledged,
      confirmation,
      numericStartingCash,
      trading.mode,
      trading.pendingAction,
    ],
  );

  const handleProfileChange = async (profile: PaperStrategyProfile) => {
    const previous = trading.account?.strategyProfile ?? "balanced";
    setSelectedProfile(profile);
    try {
      await trading.setStrategyProfile(profile);
    } catch {
      setSelectedProfile(previous);
    }
  };

  const handleReset = async () => {
    if (!resetEnabled) return;
    await trading.resetAccount({
      startingCash: numericStartingCash,
      strategyProfile: selectedProfile,
      confirmation: "重置模拟账户",
    });
    setConfirmation("");
    setAcknowledged(false);
  };

  return (
    <div className="page-stack settings-page">
      <section className="settings-hero">
        <div>
          <span className="section-kicker">Paper 控制台</span>
          <h2>模拟账户设置</h2>
          <p>选择后续计划节奏，或用新的初始资金开始一段独立模拟。</p>
        </div>
        <span className={`settings-mode-badge ${trading.mode === "paper" ? "is-paper" : ""}`}>
          {trading.mode === "paper" ? "本地 Paper" : "当前不可重置"}
        </span>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <Gauge size={18} />
          <div>
            <h2>策略档位</h2>
            <p>切换后从下一轮计划生效，已有账户和订单不会被清空。</p>
          </div>
        </div>

        <div className="strategy-profile-grid" role="radiogroup" aria-label="Paper 策略档位">
          {strategyProfileOptions.map((option) => {
            const selected = selectedProfile === option.key;
            return (
              <button
                aria-checked={selected}
                className={`strategy-profile-option ${selected ? "is-selected" : ""}`}
                disabled={trading.pendingAction || trading.mode !== "paper"}
                key={option.key}
                onClick={() => void handleProfileChange(option.key)}
                role="radio"
                type="button"
              >
                <span className="strategy-profile-title">
                  <strong>{option.label}</strong>
                  {selected && <CheckCircle2 aria-hidden="true" size={16} />}
                </span>
                <span>{option.summary}</span>
                <small>{option.cashReserve} · {option.pace}</small>
              </button>
            );
          })}
        </div>

        <div className="settings-risk-note">
          <ShieldCheck size={16} />
          <span>所有档位继续服从 A 股 T+1、100 股整手、可用现金、仓位上限、熔断和 paper-only 边界。</span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <Banknote size={18} />
          <div>
            <h2>当前模拟账户</h2>
            <p>账户重置会建立全新的本地 paper 记录。</p>
          </div>
        </div>

        <div className="settings-account-stats">
          <div>
            <span>初始权益</span>
            <strong>{formatCurrency(trading.account?.startingEquity ?? trading.account?.equity ?? 0)}</strong>
          </div>
          <div>
            <span>当前权益</span>
            <strong>{formatCurrency(trading.account?.equity ?? 0)}</strong>
          </div>
          <div>
            <span>可用现金</span>
            <strong>{formatCurrency(trading.account?.cash ?? 0)}</strong>
          </div>
          <div>
            <span>持仓 / 订单</span>
            <strong>{trading.positions.length} / {trading.orders.length}</strong>
          </div>
        </div>

        <div className="settings-reset-panel">
          <div className="settings-reset-heading">
            <Trash2 size={17} />
            <div>
              <strong>开始新模拟</strong>
              <span>清空旧持仓、挂单、历史订单和旧交易审计，研究缓存与登录配置保留。</span>
            </div>
          </div>

          <div className="settings-reset-grid">
            <label className="settings-field">
              <span>新初始资金（CNY）</span>
              <input
                aria-label="新初始资金"
                className="settings-number-input"
                max={100_000_000}
                min={1_000}
                onChange={(event) => setStartingCash(event.target.value)}
                step={1_000}
                type="number"
                value={startingCash}
              />
              <small>允许范围：1,000 至 100,000,000 元</small>
            </label>

            <label className="settings-field">
              <span>输入确认短语</span>
              <input
                aria-label="重置确认短语"
                className="settings-text-input"
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="重置模拟账户"
                type="text"
                value={confirmation}
              />
              <small>必须完整输入“重置模拟账户”</small>
            </label>
          </div>

          <label className="settings-destructive-check">
            <input
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            <span>我确认旧 Paper 交易记录将被删除，且该操作不能撤销。</span>
          </label>

          <div className="settings-section-footer">
            <button
              className="btn btn-danger"
              disabled={!resetEnabled}
              onClick={() => void handleReset()}
              type="button"
            >
              <RefreshCw size={16} />
              {trading.pendingAction ? "处理中" : "重置并开始"}
            </button>
            {(trading.notice || trading.error) && (
              <span className={trading.error ? "settings-error" : "settings-saved-badge"}>
                {trading.error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {trading.error ?? trading.notice}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
