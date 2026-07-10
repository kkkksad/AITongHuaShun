import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Calculator,
  Grid3X3,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────

interface PositionPlan {
  symbol: string;
  name: string;
  targetWeight: number; // 0-1
  currentPrice: number;
  targetShares: number;
  currentShares: number;
  remaining: number;
  reason: string;
}

interface GridConfig {
  symbol: string;
  basePrice: number;
  gridLevels: number;
  spacingPercent: number;
  lotsPerGrid: number;
  upperPrice: number;
  lowerPrice: number;
  estimatedCapital: number;
}

interface DCAPlan {
  symbol: string;
  name: string;
  amountPerPeriod: number;
  period: "daily" | "weekly" | "monthly";
  periods: number;
  totalCapital: number;
  currentPrice: number;
  estimatedShares: number;
}

type StrategyTab = "position" | "grid" | "dca";

// ─── Mock data ─────────────────────────────────────────────────────────────

const mockPositionPlans: PositionPlan[] = [
  {
    symbol: "600519",
    name: "贵州茅台",
    targetWeight: 0.25,
    currentPrice: 1680.5,
    targetShares: 1500,
    currentShares: 0,
    remaining: 1500,
    reason: "核心蓝筹底仓，长期持有",
  },
  {
    symbol: "000858",
    name: "五粮液",
    targetWeight: 0.15,
    currentPrice: 142.3,
    targetShares: 10500,
    currentShares: 3000,
    remaining: 7500,
    reason: "消费龙头，分批建仓",
  },
  {
    symbol: "300750",
    name: "宁德时代",
    targetWeight: 0.20,
    currentPrice: 185.6,
    targetShares: 10800,
    currentShares: 0,
    remaining: 10800,
    reason: "新能源核心标的",
  },
  {
    symbol: "600036",
    name: "招商银行",
    targetWeight: 0.15,
    currentPrice: 38.2,
    targetShares: 39300,
    currentShares: 10000,
    remaining: 29300,
    reason: "金融权重配置",
  },
  {
    symbol: "002415",
    name: "海康威视",
    targetWeight: 0.10,
    currentPrice: 32.8,
    targetShares: 30500,
    currentShares: 0,
    remaining: 30500,
    reason: "科技安防龙头",
  },
];

const mockGridConfig: GridConfig = {
  symbol: "510300",
  basePrice: 3.85,
  gridLevels: 5,
  spacingPercent: 2,
  lotsPerGrid: 10000,
  upperPrice: 4.25,
  lowerPrice: 3.48,
  estimatedCapital: 75000,
};

const mockDCAPlans: DCAPlan[] = [
  {
    symbol: "510300",
    name: "沪深300ETF",
    amountPerPeriod: 5000,
    period: "weekly",
    periods: 52,
    totalCapital: 260000,
    currentPrice: 3.85,
    estimatedShares: 67532,
  },
  {
    symbol: "159915",
    name: "创业板ETF",
    amountPerPeriod: 3000,
    period: "weekly",
    periods: 52,
    totalCapital: 156000,
    currentPrice: 2.15,
    estimatedShares: 72558,
  },
  {
    symbol: "510500",
    name: "中证500ETF",
    amountPerPeriod: 2000,
    period: "monthly",
    periods: 24,
    totalCapital: 48000,
    currentPrice: 5.92,
    estimatedShares: 8108,
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────

function PositionPlanCard({ plan }: { plan: PositionPlan }) {
  const progress = plan.targetShares > 0
    ? ((plan.targetShares - plan.remaining) / plan.targetShares) * 100
    : 0;
  const notional = plan.remaining * plan.currentPrice;

  return (
    <div className="position-plan-card">
      <div className="plan-header">
        <div>
          <strong>{plan.name}</strong>
          <span className="plan-symbol">{plan.symbol}</span>
        </div>
        <span className="plan-weight">
          {(plan.targetWeight * 100).toFixed(0)}% 权重
        </span>
      </div>

      <div className="plan-progress-bar">
        <div
          className="plan-progress-fill"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      <div className="plan-metrics">
        <div>
          <span>目标</span>
          <strong>{plan.targetShares.toLocaleString()} 股</strong>
        </div>
        <div>
          <span>已建</span>
          <strong>{plan.currentShares.toLocaleString()} 股</strong>
        </div>
        <div>
          <span>剩余</span>
          <strong className="plan-remaining">
            {plan.remaining.toLocaleString()} 股
          </strong>
        </div>
        <div>
          <span>金额</span>
          <strong>
            ¥{notional.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}
          </strong>
        </div>
      </div>

      <p className="plan-reason">{plan.reason}</p>
    </div>
  );
}

function GridVisualization({ config }: { config: GridConfig }) {
  const levels: { price: number; label: string; action: "buy" | "sell" | "hold" }[] = [];

  for (let i = -config.gridLevels; i <= config.gridLevels; i++) {
    const price = config.basePrice * Math.pow(1 + config.spacingPercent / 100, i);
    const action: "buy" | "sell" | "hold" =
      i < 0 ? "buy" : i > 0 ? "sell" : "hold";
    levels.push({
      price,
      label: i === 0 ? "基准" : `${i > 0 ? "+" : ""}${i}层`,
      action,
    });
  }

  // Reverse so highest price is at the top visually
  levels.reverse();

  return (
    <div className="grid-visual">
      <h4>网格分层</h4>
      <div className="grid-levels">
        {levels.map((level, idx) => (
          <div
            className={`grid-level grid-level-${level.action}`}
            key={idx}
            style={{
              opacity: level.action === "hold" ? 0.7 : 1,
            }}
          >
            <span className="grid-level-label">{level.label}</span>
            <span className="grid-level-price">
              ¥{level.price.toFixed(2)}
            </span>
            <span className="grid-level-action">
              {level.action === "buy" ? (
                <ArrowDownToLine size={14} />
              ) : level.action === "sell" ? (
                <ArrowUpToLine size={14} />
              ) : (
                "—"
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="grid-summary">
        <div>
          <span>上限</span>
          <strong>¥{config.upperPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>基准</span>
          <strong>¥{config.basePrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>下限</span>
          <strong>¥{config.lowerPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>每格手数</span>
          <strong>{config.lotsPerGrid.toLocaleString()}</strong>
        </div>
        <div>
          <span>预估资金</span>
          <strong>
            ¥{config.estimatedCapital.toLocaleString("zh-CN", {
              maximumFractionDigits: 0,
            })}
          </strong>
        </div>
      </div>
    </div>
  );
}

function DCACard({ plan }: { plan: DCAPlan }) {
  const periodLabel = { daily: "日", weekly: "周", monthly: "月" }[plan.period];

  return (
    <div className="dca-card">
      <div className="dca-header">
        <div>
          <strong>{plan.name}</strong>
          <span className="dca-symbol">{plan.symbol}</span>
        </div>
        <span className="dca-period-badge">
          {plan.periods}期 · 每{periodLabel}
        </span>
      </div>

      <div className="dca-metrics">
        <div>
          <span>每期投入</span>
          <strong>
            ¥{plan.amountPerPeriod.toLocaleString("zh-CN")}
          </strong>
        </div>
        <div>
          <span>总资金</span>
          <strong>
            ¥{plan.totalCapital.toLocaleString("zh-CN")}
          </strong>
        </div>
        <div>
          <span>当前价</span>
          <strong>¥{plan.currentPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>预估份额</span>
          <strong>{plan.estimatedShares.toLocaleString()} 份</strong>
        </div>
      </div>

      <div className="dca-bar">
        {Array.from({ length: Math.min(plan.periods, 24) }).map((_, i) => (
          <div
            className={`dca-bar-segment dca-segment-${i < 3 ? "done" : "pending"}`}
            key={i}
            title={`第 ${i + 1} 期`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function TradingStrategies() {
  const [activeTab, setActiveTab] = useState<StrategyTab>("position");

  const tabs: { id: StrategyTab; label: string; icon: ReactNode }[] = [
    { id: "position", label: "建仓计划", icon: <Wallet size={16} /> },
    { id: "grid", label: "网格交易", icon: <Grid3X3 size={16} /> },
    { id: "dca", label: "定投策略", icon: <Calculator size={16} /> },
  ];

  const totalTarget = mockPositionPlans.reduce(
    (sum, p) => sum + p.targetWeight,
    0,
  );
  const totalRemainingNotional = mockPositionPlans.reduce(
    (sum, p) => sum + p.remaining * p.currentPrice,
    0,
  );

  return (
    <div className="trading-strategies">
      <div className="panel-header">
        <div>
          <span className="section-kicker">策略工具</span>
          <h2>交易策略</h2>
        </div>
        <BarChart3 size={20} />
      </div>

      <nav className="strategy-tabs" aria-label="策略类型">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "strategy-tab active" : "strategy-tab"}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* ── 建仓计划 ── */}
      {activeTab === "position" && (
        <div className="position-plans">
          <div className="plan-summary-banner">
            <div>
              <TrendingUp size={18} />
              <span>总目标仓位 {totalTarget * 100}%</span>
            </div>
            <div>
              <Wallet size={18} />
              <span>
                待建仓资金 ¥
                {totalRemainingNotional.toLocaleString("zh-CN", {
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </div>

          {mockPositionPlans.map((plan) => (
            <PositionPlanCard key={plan.symbol} plan={plan} />
          ))}

          <div className="plan-note">
            <p>
              以上为模拟建仓计划，不构成投资建议。实际建仓需结合市场流动性、冲击成本和风控限制分批执行。
            </p>
          </div>
        </div>
      )}

      {/* ── 网格交易 ── */}
      {activeTab === "grid" && (
        <div className="grid-trading">
          <GridVisualization config={mockGridConfig} />

          <div className="grid-params">
            <h4>参数配置</h4>
            <div className="param-grid">
              <div className="param-item">
                <label>标的</label>
                <span>{mockGridConfig.symbol} 沪深300ETF</span>
              </div>
              <div className="param-item">
                <label>网格层数</label>
                <span>{mockGridConfig.gridLevels} 层（上下对称）</span>
              </div>
              <div className="param-item">
                <label>间距</label>
                <span>{mockGridConfig.spacingPercent}%</span>
              </div>
              <div className="param-item">
                <label>每格手数</label>
                <span>{mockGridConfig.lotsPerGrid.toLocaleString()} 份</span>
              </div>
            </div>
          </div>

          <div className="grid-note">
            <p>
              网格策略在震荡市中低买高卖，自动捕捉波动收益。注意：单边趋势市中可能出现持仓累积或卖空风险。
              实际交易前需确认标的流动性充足，并设置合理的价格区间。
            </p>
          </div>
        </div>
      )}

      {/* ── 定投策略 ── */}
      {activeTab === "dca" && (
        <div className="dca-plans">
          <div className="dca-summary">
            <div>
              <TrendingDown size={18} />
              <span>定投组合</span>
            </div>
            <strong>
              总计划资金 ¥
              {mockDCAPlans
                .reduce((s, p) => s + p.totalCapital, 0)
                .toLocaleString("zh-CN")}
            </strong>
          </div>

          {mockDCAPlans.map((plan) => (
            <DCACard key={plan.symbol} plan={plan} />
          ))}

          <div className="dca-note">
            <p>
              定投策略通过定期定额买入，平摊持仓成本，降低择时风险。适合长期资产配置。
              以上为模拟演示，实际执行需考虑手续费、最小交易单位和市场流动性。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
