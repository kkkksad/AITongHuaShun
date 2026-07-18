import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Ban,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Search,
  X,
  XCircle,
} from "lucide-react";
import type { OrderRecord, OrderSide, OrderStatus } from "../../shared/trading";
import { resolveOrderName } from "../lib/orderPresentation";

export { resolveOrderName } from "../lib/orderPresentation";

const PAGE_SIZE = 15;

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    accepted: "已接收",
    filled: "已成交",
    rejected: "已拒绝",
    cancelled: "已撤销",
    pending: "挂单中",
  };
  return map[status];
}

function statusIcon(status: OrderStatus) {
  switch (status) {
    case "filled":
      return <CheckCircle2 size={14} />;
    case "pending":
      return <Clock size={14} />;
    case "cancelled":
      return <Ban size={14} />;
    case "rejected":
      return <XCircle size={14} />;
    default:
      return <CheckCircle2 size={14} />;
  }
}

function sideLabel(side: OrderSide): string {
  return side === "buy" ? "买入" : "卖出";
}

interface OrderHistoryProps {
  orders: OrderRecord[];
  symbolNames?: ReadonlyMap<string, string>;
  onCancelOrder?: (orderId: string) => Promise<void>;
  pendingAction?: boolean;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

type StatusFilter = OrderStatus | "all";
type SideFilter = OrderSide | "all";

export function OrderHistory({
  orders,
  symbolNames = new Map(),
  onCancelOrder,
  pendingAction,
}: OrderHistoryProps) {
  const [searchSymbol, setSearchSymbol] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [page, setPage] = useState(0);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const filtered = useMemo(() => {
    let result = [...orders];

    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (sideFilter !== "all") {
      result = result.filter((o) => o.side === sideFilter);
    }
    if (searchSymbol.trim()) {
      const upper = searchSymbol.trim().toUpperCase();
      result = result.filter((order) => (
        order.symbol.toUpperCase().includes(upper) ||
        resolveOrderName(order, symbolNames)?.toUpperCase().includes(upper)
      ));
    }

    result.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return sortOrder === "desc" ? db - da : da - db;
    });

    return result;
  }, [orders, statusFilter, sideFilter, searchSymbol, sortOrder, symbolNames]);

  const stats = useMemo(() => {
    const total = orders.length;
    const filled = orders.filter((o) => o.status === "filled").length;
    const pending = orders.filter((o) => o.status === "pending").length;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const rejected = orders.filter((o) => o.status === "rejected").length;
    const totalCommission = orders
      .filter((o) => o.status === "filled")
      .reduce((sum, o) => sum + o.commission, 0);
    const totalNotional = orders
      .filter((o) => o.status === "filled")
      .reduce((sum, o) => sum + o.notional, 0);
    return { total, filled, pending, cancelled, rejected, totalCommission, totalNotional };
  }, [orders]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageOrders = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleExport = () => {
    const header = "ID,代码,名称,方向,类型,状态,数量,价格,成交价,成交数量,金额,手续费,创建时间,更新时间\n";
    const rows = filtered.map((o) =>
      [
        o.id,
        o.symbol,
        resolveOrderName(o, symbolNames) ?? "",
        sideLabel(o.side),
        o.type === "limit" ? "限价" : "市价",
        statusLabel(o.status),
        o.quantity,
        o.limitPrice ?? o.requestedPrice,
        o.filledPrice ?? "",
        o.filledQuantity,
        o.notional,
        o.commission,
        o.createdAt,
        o.updatedAt,
      ].map(csvCell).join(","),
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="order-history">
      {/* Statistics Bar */}
      <div className="order-stats-bar">
        <div className="stat-chip">
          <span>总订单</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat-chip filled">
          <CheckCircle2 size={14} />
          <span>已成交</span>
          <strong>{stats.filled}</strong>
        </div>
        <div className="stat-chip pending">
          <Clock size={14} />
          <span>挂单中</span>
          <strong>{stats.pending}</strong>
        </div>
        <div className="stat-chip cancelled">
          <Ban size={14} />
          <span>已撤销</span>
          <strong>{stats.cancelled}</strong>
        </div>
        <div className="stat-chip rejected">
          <XCircle size={14} />
          <span>已拒绝</span>
          <strong>{stats.rejected}</strong>
        </div>
        <div className="stat-chip">
          <span>成交金额</span>
          <strong>{money(stats.totalNotional)}</strong>
        </div>
        <div className="stat-chip">
          <span>手续费</span>
          <strong>{money(stats.totalCommission)}</strong>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="order-filter-bar">
        <div className="filter-group">
          <Filter size={15} />
          <label>
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(0);
              }}
            >
              <option value="all">全部状态</option>
              <option value="filled">已成交</option>
              <option value="pending">挂单中</option>
              <option value="cancelled">已撤销</option>
              <option value="rejected">已拒绝</option>
              <option value="accepted">已接收</option>
            </select>
          </label>
          <label>
            <span>方向</span>
            <select
              value={sideFilter}
              onChange={(e) => {
                setSideFilter(e.target.value as SideFilter);
                setPage(0);
              }}
            >
              <option value="all">全部</option>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </label>
        </div>
        <div className="filter-group">
          <label className="search-label">
            <Search size={15} />
            <input
              placeholder="搜索股票名称或代码..."
              value={searchSymbol}
              onChange={(e) => {
                setSearchSymbol(e.target.value);
                setPage(0);
              }}
            />
            {searchSymbol && (
              <button
                className="clear-search"
                onClick={() => setSearchSymbol("")}
                type="button"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <button
            className="secondary-button"
            onClick={() => setSortOrder((s) => (s === "desc" ? "asc" : "desc"))}
            type="button"
            title={sortOrder === "desc" ? "最新在前" : "最早在前"}
          >
            <ArrowDownUp size={15} />
            {sortOrder === "desc" ? "最新" : "最早"}
          </button>
          <button className="secondary-button" onClick={handleExport} type="button">
            <Download size={15} />
            导出
          </button>
        </div>
      </div>

      {/* Order Table */}
      <div className="table-scroll" style={{ maxHeight: "56vh" }}>
        <table className="data-table order-history-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>标的</th>
              <th>方向</th>
              <th>类型</th>
              <th>数量</th>
              <th>价格</th>
              <th>成交价</th>
              <th>成交/总量</th>
              <th>金额</th>
              <th>手续费</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageOrders.length === 0 && (
              <tr>
                <td className="empty-row" colSpan={12}>
                  暂无匹配的订单记录
                </td>
              </tr>
            )}
            {pageOrders.map((order) => (
              <tr key={order.id}>
                <td className="time-cell">
                  {new Date(order.createdAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}
                </td>
                <td className="symbol-cell">
                  <strong>{resolveOrderName(order, symbolNames) ?? order.symbol}</strong>
                  <span className="table-subline">
                    {resolveOrderName(order, symbolNames) ? order.symbol : "名称未记录"}
                  </span>
                </td>
                <td>
                  <span className={order.side === "buy" ? "side buy" : "side sell"}>
                    {sideLabel(order.side)}
                  </span>
                </td>
                <td>
                  <span className="order-type-tag">
                    {order.type === "limit" ? "限价" : "市价"}
                  </span>
                </td>
                <td>{order.quantity.toLocaleString("zh-CN")}</td>
                <td>¥{(order.limitPrice ?? order.requestedPrice).toFixed(2)}</td>
                <td>
                  {order.filledPrice != null ? `¥${order.filledPrice.toFixed(2)}` : "—"}
                </td>
                <td>
                  {order.filledQuantity} / {order.quantity}
                </td>
                <td>{money(order.notional)}</td>
                <td className="commission-cell">
                  {order.commission > 0 ? `¥${order.commission.toFixed(2)}` : "—"}
                </td>
                <td>
                  <span className={`order-status-badge status-${order.status}`}>
                    {statusIcon(order.status)}
                    {statusLabel(order.status)}
                  </span>
                </td>
                <td>
                  {order.status === "pending" && onCancelOrder && (
                    <button
                      className="cancel-order-btn"
                      disabled={pendingAction}
                      onClick={() => onCancelOrder(order.id)}
                      type="button"
                    >
                      <X size={14} />
                      撤单
                    </button>
                  )}
                  {order.status === "rejected" && order.rejectionReason && (
                    <small className="rejection-reason" title={order.rejectionReason}>
                      {order.rejectionReason.slice(0, 20)}
                      {order.rejectionReason.length > 20 ? "…" : ""}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination-bar">
          <span className="pagination-info">
            共 {filtered.length} 条，第 {page + 1} / {totalPages} 页
          </span>
          <div className="pagination-buttons">
            <button
              className="secondary-button"
              disabled={page === 0}
              onClick={() => setPage(0)}
              type="button"
            >
              首页
            </button>
            <button
              className="secondary-button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              type="button"
            >
              上一页
            </button>
            <button
              className="secondary-button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              type="button"
            >
              下一页
            </button>
            <button
              className="secondary-button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              type="button"
            >
              末页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
