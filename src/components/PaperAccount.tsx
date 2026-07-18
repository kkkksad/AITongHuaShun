import { useMemo, useState, type FormEvent } from "react";
import {
  CircleDollarSign,
  Pause,
  Play,
  SendHorizontal,
  ShieldAlert,
  X,
  Clock,
} from "lucide-react";
import type { OrderRecord, OrderRequest, OrderSide, OrderType } from "../../shared/trading";
import type { TradingBackend } from "../hooks/useTradingBackend";
import { buildOrderSymbolNames, resolveOrderName } from "../lib/orderPresentation";

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function orderLabel(status: string): string {
  return (
    {
      accepted: "已接收",
      filled: "已成交",
      rejected: "已拒绝",
      cancelled: "已撤销",
      pending: "挂单中",
    }[status] ?? status
  );
}

function orderTypeLabel(type: string): string {
  return type === "limit" ? "限价" : "市价";
}

interface PaperAccountProps {
  backend: TradingBackend;
}

function OrderSecurity({
  order,
  symbolNames,
}: {
  order: OrderRecord;
  symbolNames: ReadonlyMap<string, string>;
}) {
  const name = resolveOrderName(order, symbolNames);
  return (
    <span className="order-security">
      <strong>{name ?? order.symbol}</strong>
      <small>{name ? order.symbol : "名称暂不可用"}</small>
    </span>
  );
}

export function PaperAccount({ backend }: PaperAccountProps) {
  const [symbol, setSymbol] = useState("600519");
  const [side, setSide] = useState<OrderSide>("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [quantity, setQuantity] = useState(100);
  const [limitPrice, setLimitPrice] = useState("");
  const tradableQuotes = backend.market?.quotes.filter((quote) => quote.tradable) ?? [];
  const selectedQuote = tradableQuotes.find((quote) => quote.symbol === symbol);
  const selectedPrice = orderType === "limit" && limitPrice
    ? Number(limitPrice)
    : (selectedQuote?.price ?? 0);
  const estimatedNotional = selectedPrice * quantity;
  const account = backend.account;
  const orderSymbolNames = useMemo(
    () => buildOrderSymbolNames(backend.market, backend.positions),
    [backend.market, backend.positions],
  );

  const positionCount = backend.positions.length;
  const canSubmit =
    backend.connectionState === "connected" &&
    Boolean(account) &&
    !account?.paused &&
    !backend.pendingAction &&
    quantity > 0 &&
    (orderType !== "limit" || (limitPrice !== "" && Number(limitPrice) > 0));

  const riskHint = useMemo(() => {
    if (!backend.limits) {
      return "等待风险参数";
    }
    return `单笔上限 ${money(backend.limits.maxOrderNotional)} · 整手 ${backend.limits.lotSize} 股`;
  }, [backend.limits]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request: OrderRequest = {
      symbol,
      side,
      type: orderType,
      quantity,
      clientOrderId: globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}`,
    };
    if (orderType === "limit") {
      request.limitPrice = Number(limitPrice);
    }

    await backend.submitOrder(request).catch(() => undefined);
  };

  const handleCancel = async (orderId: string) => {
    await backend.cancelOrder(orderId).catch(() => undefined);
  };

  const pendingOrders = backend.orders.filter((o) => o.status === "pending");

  if (!account) {
    return (
      <section className="panel account-empty">
        <ShieldAlert size={24} />
        <div>
          <h2>模拟交易后端未连接</h2>
          <p>{backend.error ?? "正在获取账户、持仓和风控参数。"}</p>
        </div>
        <button className="secondary-button" onClick={() => void backend.refresh()} type="button">
          重新连接
        </button>
      </section>
    );
  }

  return (
    <section className="panel account-panel">
      <div className="account-hero">
        <div>
          <span className="section-kicker">{account.accountId}</span>
          <h2>{money(account.equity)}</h2>
          <p>
            今日权益{" "}
            <strong className={account.dailyPnl >= 0 ? "positive" : "negative"}>
              {account.dailyPnl >= 0 ? "+" : ""}
              {(account.dailyPnlPercent * 100).toFixed(2)}%
            </strong>
          </p>
        </div>
        <div className="account-actions">
          <span className={account.paused ? "account-state paused" : "account-state"}>
            <span className="status-dot" />
            {account.paused ? "交易已暂停" : "模拟撮合运行中"}
          </span>
          <button
            className={account.paused ? "secondary-button" : "danger-button"}
            disabled={backend.pendingAction || backend.connectionState !== "connected"}
            onClick={() => void backend.setPaused(!account.paused)}
            type="button"
          >
            {account.paused ? <Play size={16} /> : <Pause size={16} />}
            {account.paused ? "恢复撮合" : "暂停撮合"}
          </button>
        </div>
      </div>

      <div className="account-metrics">
        <div>
          <CircleDollarSign size={19} />
          <span>持仓市值</span>
          <strong>{money(account.marketValue)}</strong>
        </div>
        <div>
          <span className="metric-icon neutral">¥</span>
          <span>可用资金</span>
          <strong>{money(account.cash)}</strong>
        </div>
        <div>
          <span className="metric-icon positive">↗</span>
          <span>浮动盈亏</span>
          <strong className={account.unrealizedPnl >= 0 ? "positive" : "negative"}>
            {money(account.unrealizedPnl)}
          </strong>
        </div>
        <div>
          <ShieldAlert size={19} />
          <span>风险占用</span>
          <strong>{(account.riskUtilization * 100).toFixed(1)}%</strong>
        </div>
      </div>

      <div className="account-columns">
        <div>
          <div className="table-heading">
            <h3>当前持仓</h3>
            <span>{positionCount} 个标的 · 实时盯市</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标的</th>
                  <th>数量</th>
                  <th>成本 / 现价</th>
                  <th>盈亏</th>
                  <th>权重</th>
                </tr>
              </thead>
              <tbody>
                {backend.positions.map((position) => (
                  <tr key={position.symbol}>
                    <td>
                      <strong>{position.name}</strong>
                      <small className="table-subline">{position.symbol}</small>
                    </td>
                    <td>{position.quantity.toLocaleString("zh-CN")}</td>
                    <td>
                      {position.averagePrice.toFixed(2)} / {position.currentPrice.toFixed(2)}
                    </td>
                    <td
                      className={position.unrealizedPnl >= 0 ? "positive" : "negative"}
                    >
                      {money(position.unrealizedPnl)}
                    </td>
                    <td>{(position.weight * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pendingOrders.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <div className="table-heading">
                <h3>
                  <Clock size={16} style={{ marginRight: "0.4rem", verticalAlign: "middle" }} />
                  挂单队列
                </h3>
                <span>{pendingOrders.length} 笔待成交</span>
              </div>
              <div className="order-list">
                {pendingOrders.map((order) => (
                  <article key={order.id} className="pending-order">
                    <div>
                      <span className={order.side === "buy" ? "side buy" : "side sell"}>
                        {order.side === "buy" ? "买入" : "卖出"}
                      </span>
                      <OrderSecurity order={order} symbolNames={orderSymbolNames} />
                      <span className="order-type-tag">限价</span>
                      <small>
                        {new Date(order.createdAt).toLocaleTimeString("zh-CN", {
                          hour12: false,
                        })}
                      </small>
                    </div>
                    <div>
                      <strong>
                        {order.quantity} 股 @ ¥{order.limitPrice?.toFixed(2)}
                      </strong>
                      <button
                        className="cancel-order-btn"
                        disabled={backend.pendingAction}
                        onClick={() => handleCancel(order.id)}
                        type="button"
                        title="撤销订单"
                      >
                        <X size={14} />
                        撤单
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="trading-rail">
          <form className="order-ticket" onSubmit={handleSubmit}>
            <div className="table-heading">
              <h3>模拟下单</h3>
              <span>{orderType === "limit" ? "限价挂单" : "市价撮合"}</span>
            </div>
            <label>
              <span>交易标的</span>
              <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {tradableQuotes.map((quote) => (
                  <option key={quote.symbol} value={quote.symbol}>
                    {quote.name} · {quote.symbol}
                  </option>
                ))}
              </select>
            </label>
            <div className="side-switch" aria-label="买卖方向">
              <button
                className={side === "buy" ? "active buy" : ""}
                onClick={() => setSide("buy")}
                type="button"
              >
                买入
              </button>
              <button
                className={side === "sell" ? "active sell" : ""}
                onClick={() => setSide("sell")}
                type="button"
              >
                卖出
              </button>
            </div>
            <div className="side-switch" aria-label="订单类型" style={{ marginBottom: "0.5rem" }}>
              <button
                className={orderType === "market" ? "active" : ""}
                onClick={() => setOrderType("market")}
                type="button"
                style={{ fontSize: "0.8rem" }}
              >
                市价单
              </button>
              <button
                className={orderType === "limit" ? "active" : ""}
                onClick={() => setOrderType("limit")}
                type="button"
                style={{ fontSize: "0.8rem" }}
              >
                限价单
              </button>
            </div>
            <label>
              <span>数量</span>
              <input
                min={backend.limits?.lotSize ?? 100}
                onChange={(event) => setQuantity(Number(event.target.value))}
                step={backend.limits?.lotSize ?? 100}
                type="number"
                value={quantity}
              />
            </label>
            {orderType === "limit" && (
              <label>
                <span>限价 (¥)</span>
                <input
                  min="0.01"
                  onChange={(event) => setLimitPrice(event.target.value)}
                  placeholder={`现价 ¥${selectedQuote?.price.toFixed(2) ?? "--"}`}
                  step="0.01"
                  type="number"
                  value={limitPrice}
                />
              </label>
            )}
            <div className="order-estimate">
              <span>参考价</span>
              <strong>
                {orderType === "limit" && limitPrice
                  ? `¥${Number(limitPrice).toFixed(2)}`
                  : `¥${selectedQuote?.price.toFixed(2) ?? "--"}`}
              </strong>
              <span>预计金额</span>
              <strong>{money(estimatedNotional)}</strong>
            </div>
            <p className="risk-hint">{riskHint}</p>
            {(backend.notice || backend.error) && (
              <p className={backend.error ? "order-feedback error" : "order-feedback"}>
                {backend.error ?? backend.notice}
              </p>
            )}
            <button className="primary-button full-width" disabled={!canSubmit} type="submit">
              <SendHorizontal size={16} />
              {backend.pendingAction ? "处理中" : orderType === "limit" ? "提交限价单" : "提交模拟订单"}
            </button>
          </form>

          <div>
            <div className="table-heading">
              <h3>最近订单</h3>
              <span>{backend.orders.length} 笔</span>
            </div>
            <div className="order-list">
              {backend.orders.length === 0 && <p className="empty-copy">暂无模拟订单</p>}
              {backend.orders.slice(0, 12).map((order) => (
                <article key={order.id}>
                  <div>
                    <span className={order.side === "buy" ? "side buy" : "side sell"}>
                      {order.side === "buy" ? "买入" : "卖出"}
                    </span>
                    <OrderSecurity order={order} symbolNames={orderSymbolNames} />
                    <span className="order-type-tag">{orderTypeLabel(order.type)}</span>
                    <small>
                      {new Date(order.updatedAt).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}
                    </small>
                  </div>
                  <div>
                    <strong>
                      {order.quantity} 股 × ¥
                      {(order.filledPrice ?? order.limitPrice ?? order.requestedPrice).toFixed(2)}
                    </strong>
                    <span className={order.status === "rejected" ? "negative" : ""}>
                      {orderLabel(order.status)}
                    </span>
                    {order.status === "pending" && (
                      <button
                        className="cancel-order-btn"
                        disabled={backend.pendingAction}
                        onClick={() => handleCancel(order.id)}
                        type="button"
                        title="撤销订单"
                      >
                        <X size={14} />
                        撤单
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
