import { useState } from "react";
import { CircleDollarSign, Pause, Play, ShieldAlert } from "lucide-react";
import { paperOrders, positions } from "../data/mockData";

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PaperAccount() {
  const [paused, setPaused] = useState(false);
  const marketValue = positions.reduce(
    (total, position) => total + position.quantity * position.currentPrice,
    0,
  );
  const unrealized = positions.reduce(
    (total, position) =>
      total + position.quantity * (position.currentPrice - position.averagePrice),
    0,
  );

  return (
    <section className="panel account-panel">
      <div className="account-hero">
        <div>
          <span className="section-kicker">Paper Account CN-01</span>
          <h2>{money(1_286_420)}</h2>
          <p>
            今日权益 <strong className="positive">+0.84%</strong>
          </p>
        </div>
        <div className="account-actions">
          <span className={paused ? "account-state paused" : "account-state"}>
            <span className="status-dot" />
            {paused ? "交易已暂停" : "模拟撮合运行中"}
          </span>
          <button
            className={paused ? "secondary-button" : "danger-button"}
            onClick={() => setPaused((value) => !value)}
            type="button"
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? "恢复撮合" : "暂停撮合"}
          </button>
        </div>
      </div>

      <div className="account-metrics">
        <div>
          <CircleDollarSign size={19} />
          <span>持仓市值</span>
          <strong>{money(marketValue)}</strong>
        </div>
        <div>
          <span className="metric-icon neutral">¥</span>
          <span>可用资金</span>
          <strong>{money(1_286_420 - marketValue)}</strong>
        </div>
        <div>
          <span className="metric-icon positive">↗</span>
          <span>浮动盈亏</span>
          <strong className="positive">{money(unrealized)}</strong>
        </div>
        <div>
          <ShieldAlert size={19} />
          <span>风险占用</span>
          <strong>62.4%</strong>
        </div>
      </div>

      <div className="account-columns">
        <div>
          <div className="table-heading">
            <h3>当前持仓</h3>
            <span>{positions.length} 个标的</span>
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
                {positions.map((position) => {
                  const pnl =
                    (position.currentPrice - position.averagePrice) * position.quantity;
                  return (
                    <tr key={position.symbol}>
                      <td>
                        <strong>{position.name}</strong>
                        <small className="table-subline">{position.symbol}</small>
                      </td>
                      <td>{position.quantity.toLocaleString("zh-CN")}</td>
                      <td>
                        {position.averagePrice.toFixed(2)} / {position.currentPrice.toFixed(2)}
                      </td>
                      <td className={pnl >= 0 ? "positive" : "negative"}>{money(pnl)}</td>
                      <td>{position.weight.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="table-heading">
            <h3>今日订单</h3>
            <span>模拟撮合</span>
          </div>
          <div className="order-list">
            {paperOrders.map((order) => (
              <article key={order.id}>
                <div>
                  <span className={order.side === "买入" ? "side buy" : "side sell"}>
                    {order.side}
                  </span>
                  <strong>{order.symbol}</strong>
                  <small>{order.time}</small>
                </div>
                <div>
                  <strong>
                    {order.quantity} 股 × ¥{order.price.toFixed(2)}
                  </strong>
                  <span>{order.status}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
