import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PaperStrategyProfile,
  PositionSnapshot,
  RiskLimits,
  TradingEvent,
  TradingMode,
} from "../../shared/trading";
import {
  cancelPaperOrder,
  fetchTradingBootstrap,
  getTradingSocketUrl,
  isUnauthorizedWebSocketClose,
  notifyAuthExpired,
  setPaperTradingPaused,
  resetPaperAccount,
  submitPaperOrder,
  updatePaperStrategyProfile,
  type MarketDataProviderName,
  type TradingBootstrap,
} from "../lib/tradingApi";

export type ConnectionState = "connecting" | "connected" | "offline";

export interface TradingBackend {
  connectionState: ConnectionState;
  realtimeState: ConnectionState;
  mode: TradingMode;
  marketDataProvider: MarketDataProviderName;
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
  resetAccount(input: {
    startingCash: number;
    strategyProfile: PaperStrategyProfile;
    confirmation: "重置模拟账户";
  }): Promise<void>;
  setStrategyProfile(profile: PaperStrategyProfile): Promise<void>;
}

interface UseTradingBackendOptions {
  enabled?: boolean;
}

const tradingQueryKey = ["trading-bootstrap"] as const;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_GRACE_MS = 60_000;
const HEARTBEAT_CHECK_MS = 15_000;

function upsertOrder(orders: OrderRecord[], next: OrderRecord): OrderRecord[] {
  const existingIndex = orders.findIndex((order) => order.id === next.id);
  if (existingIndex < 0) {
    return [next, ...orders].slice(0, 50);
  }

  return orders.map((order, index) => (index === existingIndex ? next : order));
}

function errorMessage(error: unknown, fallback?: string): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useTradingBackend(
  options: UseTradingBackendOptions = {},
): TradingBackend {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const [realtimeState, setRealtimeState] =
    useState<ConnectionState>("connecting");
  const [transportError, setTransportError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const reconnectAttemptRef = useRef(0);

  const bootstrapQuery = useQuery({
    queryKey: tradingQueryKey,
    queryFn: fetchTradingBootstrap,
    enabled,
  });

  const updateBootstrap = useCallback(
    (updater: (current: TradingBootstrap) => TradingBootstrap) => {
      queryClient.setQueryData<TradingBootstrap>(
        tradingQueryKey,
        (current) => (current ? updater(current) : current),
      );
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      await queryClient.fetchQuery({
        queryKey: tradingQueryKey,
        queryFn: fetchTradingBootstrap,
        staleTime: 0,
      });
      setTransportError(undefined);
    } catch (refreshError) {
      setRealtimeState("offline");
      setTransportError(errorMessage(refreshError, "交易后端不可用"));
      throw refreshError;
    }
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!enabled) {
      setRealtimeState("offline");
      setTransportError(undefined);
      reconnectAttemptRef.current = 0;
      return;
    }

    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let lastMessageTime = Date.now();
    let active = true;

    const resetReconnectDelay = () => {
      reconnectAttemptRef.current = 0;
    };

    const clearTimers = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }
      setRealtimeState("offline");
      const attempt = reconnectAttemptRef.current;
      const jitter = Math.round(Math.random() * 250);
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** attempt,
        RECONNECT_MAX_MS,
      ) + jitter;
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const startHeartbeat = () => {
      lastMessageTime = Date.now();
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }
      heartbeatTimer = window.setInterval(() => {
        if (!active) {
          return;
        }
        if (Date.now() - lastMessageTime > HEARTBEAT_GRACE_MS) {
          setTransportError("实时通道心跳超时，正在重连");
          socket?.close();
        }
      }, HEARTBEAT_CHECK_MS);
    };

    const applyEvent = (event: TradingEvent) => {
      switch (event.type) {
        case "market.snapshot":
          updateBootstrap((current) => ({
            ...current,
            health: {
              ...current.health,
              mode: event.data.mode,
            },
            market: event.data,
          }));
          break;
        case "account.snapshot":
          updateBootstrap((current) => ({
            ...current,
            account: event.data,
          }));
          break;
        case "positions.snapshot":
          updateBootstrap((current) => ({
            ...current,
            positions: event.data,
          }));
          break;
        case "order.updated":
          updateBootstrap((current) => ({
            ...current,
            orders: upsertOrder(current.orders, event.data),
          }));
          break;
        case "system.status":
          setNotice(event.data.message);
          break;
      }
    };

    const connect = () => {
      if (!active) {
        return;
      }
      if (
        socket &&
        (socket.readyState === WebSocket.CONNECTING ||
          socket.readyState === WebSocket.OPEN)
      ) {
        return;
      }
      setRealtimeState("connecting");
      const currentSocket = new WebSocket(getTradingSocketUrl());
      socket = currentSocket;

      currentSocket.addEventListener("open", () => {
        if (!active || socket !== currentSocket) {
          currentSocket.close();
          return;
        }
        setRealtimeState("connected");
        setTransportError(undefined);
        resetReconnectDelay();
        startHeartbeat();
      });

      currentSocket.addEventListener("message", (message) => {
        if (!active || socket !== currentSocket) {
          return;
        }
        lastMessageTime = Date.now();
        try {
          applyEvent(JSON.parse(message.data as string) as TradingEvent);
        } catch {
          setTransportError("实时通道返回了无法解析的消息");
        }
      });

      currentSocket.addEventListener("close", (event) => {
        if (isUnauthorizedWebSocketClose(event)) {
          notifyAuthExpired();
          return;
        }
        if (active && socket === currentSocket) {
          socket = undefined;
          scheduleReconnect();
        }
      });

      currentSocket.addEventListener("error", () => {
        if (!active || socket !== currentSocket) {
          return;
        }
        setTransportError("实时通道连接失败，正在重试");
      });
    };

    connect();

    return () => {
      active = false;
      clearTimers();
      socket?.close();
      socket = undefined;
    };
  }, [enabled, updateBootstrap]);

  const submitMutation = useMutation({
    mutationFn: submitPaperOrder,
    onMutate: () => {
      setNotice(undefined);
      setTransportError(undefined);
    },
    onSuccess: (result) => {
      updateBootstrap((current) => ({
        ...current,
        account: result.account,
        positions: result.positions,
        orders: upsertOrder(current.orders, result.order),
      }));

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
    },
    onError: (submitError) => {
      setTransportError(errorMessage(submitError, "模拟下单失败"));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPaperOrder,
    onMutate: () => {
      setNotice(undefined);
      setTransportError(undefined);
    },
    onSuccess: (result) => {
      updateBootstrap((current) => ({
        ...current,
        account: result.account,
        positions: result.positions,
        orders: upsertOrder(current.orders, result.order),
      }));
      setNotice("订单已撤销");
    },
    onError: (cancelError) => {
      setTransportError(errorMessage(cancelError, "撤单失败"));
    },
  });

  const pauseMutation = useMutation({
    mutationFn: setPaperTradingPaused,
    onMutate: () => {
      setTransportError(undefined);
    },
    onSuccess: (result, paused) => {
      updateBootstrap((current) => ({
        ...current,
        account: result.account,
      }));
      setNotice(paused ? "模拟交易已暂停" : "模拟交易已恢复");
    },
    onError: (pauseError) => {
      setTransportError(errorMessage(pauseError, "交易状态更新失败"));
    },
  });

  const resetAccountMutation = useMutation({
    mutationFn: resetPaperAccount,
    onMutate: () => {
      setNotice(undefined);
      setTransportError(undefined);
    },
    onSuccess: (result) => {
      updateBootstrap((current) => ({
        ...current,
        account: result.account,
        positions: result.positions,
        orders: result.orders,
      }));
      setNotice(
        `已开始新的本地模拟：初始资金 ¥${result.account.equity.toLocaleString("zh-CN")}，旧 Paper 数据已删除`,
      );
    },
    onError: (resetError) => {
      setTransportError(errorMessage(resetError, "重置模拟账户失败"));
    },
  });

  const strategyProfileMutation = useMutation({
    mutationFn: updatePaperStrategyProfile,
    onMutate: () => {
      setNotice(undefined);
      setTransportError(undefined);
    },
    onSuccess: (result) => {
      updateBootstrap((current) => ({ ...current, account: result.account }));
      setNotice("Paper 策略档位已更新，下一轮计划开始生效");
    },
    onError: (profileError) => {
      setTransportError(errorMessage(profileError, "更新策略档位失败"));
    },
  });

  const submitOrder = useCallback(
    async (request: OrderRequest) =>
      (await submitMutation.mutateAsync(request)).order,
    [submitMutation],
  );

  const cancelOrder = useCallback(
    async (orderId: string) =>
      (await cancelMutation.mutateAsync(orderId)).order,
    [cancelMutation],
  );

  const setPaused = useCallback(
    async (paused: boolean) => {
      await pauseMutation.mutateAsync(paused);
    },
    [pauseMutation],
  );

  const bootstrap = enabled ? bootstrapQuery.data : undefined;
  const backendError = enabled
    ? transportError ?? (bootstrap ? undefined : errorMessage(bootstrapQuery.error, "交易后端不可用"))
    : undefined;
  const pendingAction =
    submitMutation.isPending ||
    cancelMutation.isPending ||
    pauseMutation.isPending;
  const accountControlPending =
    resetAccountMutation.isPending || strategyProfileMutation.isPending;
  const connectionState: ConnectionState = bootstrap
    ? "connected"
    : bootstrapQuery.isError || realtimeState === "offline"
      ? "offline"
      : "connecting";

  return {
    connectionState,
    realtimeState,
    mode: bootstrap?.health.mode ?? bootstrap?.market.mode ?? "mock",
    marketDataProvider:
      bootstrap?.capabilities.marketData.provider ??
      bootstrap?.health.marketDataProvider ??
      "mock",
    market: bootstrap?.market,
    account: bootstrap?.account,
    positions: bootstrap?.positions ?? [],
    orders: bootstrap?.orders ?? [],
    limits: bootstrap?.limits,
    error: backendError,
    notice,
    pendingAction: pendingAction || accountControlPending,
    refresh,
    submitOrder,
    cancelOrder,
    setPaused,
    resetAccount: async (input) => {
      await resetAccountMutation.mutateAsync(input);
    },
    setStrategyProfile: async (profile) => {
      await strategyProfileMutation.mutateAsync(profile);
    },
  };
}
