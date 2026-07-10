import { useState, type ReactNode } from "react";
import { OrderHistory } from "../components/OrderHistory";
import { PaperAccount } from "../components/PaperAccount";
import { Portfolio } from "../components/Portfolio";
import { RiskPanel } from "../components/RiskPanel";
import type { TradingBackend } from "../hooks/useTradingBackend";

type AccountTab = "portfolio" | "trading" | "orders" | "risk";

const accountTabs: { id: AccountTab; label: string }[] = [
  { id: "portfolio", label: "持仓分析" },
  { id: "trading", label: "交易下单" },
  { id: "orders", label: "订单历史" },
  { id: "risk", label: "风控面板" },
];

interface AccountPageProps {
  trading: TradingBackend;
}

export default function AccountPage({ trading }: AccountPageProps) {
  const [accountTab, setAccountTab] = useState<AccountTab>("portfolio");

  const accountTabContent: Record<AccountTab, ReactNode> = {
    portfolio: (
      <Portfolio
        equity={trading.account?.equity}
        market={trading.market}
        positions={trading.positions}
      />
    ),
    trading: <PaperAccount backend={trading} />,
    orders: (
      <OrderHistory
        orders={trading.orders}
        onCancelOrder={async (orderId) => {
          await trading.cancelOrder(orderId);
        }}
        pendingAction={trading.pendingAction}
      />
    ),
    risk: <RiskPanel account={trading.account} limits={trading.limits} />,
  };

  return (
    <div className="page-stack">
      {trading.account && (
        <section className="panel account-hero-panel">
          <div className="account-hero-row">
            <div>
              <span className="section-kicker">
                {trading.account.accountId} · {trading.mode}
              </span>
              <h2>
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0,
                }).format(trading.account.equity)}
              </h2>
              <p>
                今日权益{" "}
                <strong
                  className={trading.account.dailyPnl >= 0 ? "positive" : "negative"}
                >
                  {trading.account.dailyPnl >= 0 ? "+" : ""}
                  {(trading.account.dailyPnlPercent * 100).toFixed(2)}%
                </strong>
                {" · "}可用{" "}
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                  maximumFractionDigits: 0,
                }).format(trading.account.cash)}
              </p>
            </div>
          </div>
        </section>
      )}

      <nav className="account-tabs" aria-label="账户子页面">
        {accountTabs.map((tab) => (
          <button
            className={accountTab === tab.id ? "account-tab active" : "account-tab"}
            key={tab.id}
            onClick={() => setAccountTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {accountTabContent[accountTab]}
    </div>
  );
}
