import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingEvent,
  TradingMode,
} from "../../shared/trading";
import {
  cancelPaperOrder,
  fetchTradingBootstrap,
  getTradingSocketUrl,
  setPaperTradingPaused,
  submitPaperOrder,
} from "../lib/tradingApi";

export type ConnectionState = "connecting" | "connected" | "offline";

export interface TradingBackend {
  connectionState: ConnectionState;
  mode: TradingMode;
  market?: MarketSnapshot;
  account?: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  limits?: RiskLimits;
  error?: string;
  notice?: string;
  pendingAction: boolean;
  refresh(): Promise<void>;
  submitOrder(request: OrderRequest): Promise<OrderRecord>;
  cancelOrder(orderId: string): Promise<OrderRecord>;
  setPaused(paused: boolean): Promise<void>;
}

function upsertOrder(orders: OrderRecord[], next: OrderRecord): OrderRecord[] {
  const existingIndex = orders.findIndex((order) => order.id === next.id);
  if (existingIndex < 0) {
    return [next, ...orders].slice(0, 50);
  }

  return orders.map((order, index) => (index === existingIndex ? next : order));
}

export function useTradingBackend(): TradingBackend {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [mode, setMode] = useState<TradingMode>("mock");
  const [market, setMarket] = useState<MarketSnapshot>();
  const [account, setAccount] = useState<AccountSnapshot>();
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [limits, setLimits] = useState<RiskLimits>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingAction, setPendingAction] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const bootstrap = await fetchTradingBootstrap();
      if (!mountedRef.current) {
        return;
      }

      setMode(bootstrap.health.mode);
      setMarket(bootstrap.market);
      setAccount(bootstrap.account);
      setPositions(bootstrap.positions);
      setOrders(bootstrap.orders);
      setLimits(bootstrap.limits);
      setError(undefined);
    } catch (refreshError) {
      if (mountedRef.current) {
        setConnectionState("offline");
        setError(refreshError instanceof Error ? refreshError.message : "交易后端不可用");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    const connect = () => {
      setConnectionState("connecting");
      socket = new WebSocket(getTradingSocketUrl());

      socket.addEventListener("open", () => {
        setConnectionState("connected");
        setError(undefined);
      });
      socket.addEventListener("message", (message) => {
        const event = JSON.parse(message.data as string) as TradingEvent;

        switch (event.type) {
          case "market.snapshot":
            setMarket(event.data);
            setMode(event.data.mode);
            break;
          case "account.snapshot":
            setAccount(event.data);
            break;
          case "positions.snapshot":
            setPositions(event.data);
            break;
          case "order.updated":
            setOrders((current) => upsertOrder(current, event.data));
            break;
          case "system.status":
            setNotice(event.data.message);
            break;
        }
      });
      socket.addEventListener("close", () => {
        if (!mountedRef.current) {
          return;
        }
        setConnectionState("offline");
        reconnectTimer = window.setTimeout(connect, 2000);
      });
      socket.addEventListener("error", () => {
        setError("实时通道连接失败，正在重试");
      });
    };

    void refresh();
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [refresh]);

  const submitOrder = useCallback(async (request: OrderRequest) => {
    setPendingAction(true);
    setNotice(undefined);
    try {
      const result = await submitPaperOrder(request);
      setAccount(result.account);
      setPositions(result.positions);
      setOrders((current) => upsertOrder(current, result.order));
      if (result.order.status === "rejected") {
        setNotice(
          `订单被拒绝：${result.order.rejectionReason ?? "未通过风险检查"}`,
        );
      } else if (result.order.status === "pending") {
        setNotice(
          `限价单已挂单：${result.order.symbol} ${result.order.quantity} 股 @ ¥${result.order.limitPrice}`,
        );
      } else {
        setNotice(
          `模拟订单已成交：${result.order.symbol} ${result.order.quantity} 股`,
        );
      }
      return result.order;
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "模拟下单失败";
      setError(message);
      throw submitError;
    } finally {
      setPendingAction(false);
    }
  }, []);

  const cancelOrder = useCallback(async (orderId: string) => {
    setPendingAction(true);
    setNotice(undefined);
    try {
      const result = await cancelPaperOrder(orderId);
      setAccount(result.account);
      setPositions(result.positions);
      setOrders((current) => upsertOrder(current, result.order));
      setNotice(`订单已撤销`);
      return result.order;
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : "撤单失败";
      setError(message);
      throw cancelError;
    } finally {
      setPendingAction(false);
    }
  }, []);

  const setPaused = useCallback(async (paused: boolean) => {
    setPendingAction(true);
    try {
      const result = await setPaperTradingPaused(paused);
      setAccount(result.account);
      setNotice(paused ? "模拟交易已暂停" : "模拟交易已恢复");
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "交易状态更新失败");
      throw pauseError;
    } finally {
      setPendingAction(false);
    }
  }, []);

  return {
    connectionState,
    mode,
    market,
    account,
    positions,
    orders,
    limits,
    error,
    notice,
    pendingAction,
    refresh,
    submitOrder,
    cancelOrder,
    setPaused,
  };
}
