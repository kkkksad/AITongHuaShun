import {
  useMutation,
  useQuery,
  useQueryClient,
  isCancelledError,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PaperExecutionStrategy,
  PaperStrategyProfile,
  PositionSnapshot,
  RiskLimits,
  TradingEvent,
  TradingMode,
} from "../../shared/trading";
import {
  cancelPaperOrder,
  fetchTradingBootstrap,
  fetchRecentOrders,
  getTradingSocketUrl,
  isUnauthorizedWebSocketClose,
  notifyAuthExpired,
  setPaperTradingPaused,
  resetPaperAccount,
  submitPaperOrder,
  updatePaperExecutionStrategy,
  updatePaperStrategyProfile,
  type MarketDataProviderName,
  type TradingBootstrap,
} from "../lib/tradingApi";
import {
  applyBootstrapEvent,
  BootstrapSynchronization,
  upsertOrder,
  type BootstrapDataEvent,
} from "../lib/bootstrapSynchronization";

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
    executionStrategy?: PaperExecutionStrategy;
    confirmation: "重置模拟账户";
  }): Promise<void>;
  setStrategyProfile(profile: PaperStrategyProfile): Promise<void>;
  setExecutionStrategy(strategy: PaperExecutionStrategy): Promise<void>;
}

interface UseTradingBackendOptions {
  enabled?: boolean;
}

const tradingQueryKey = ["trading-bootstrap"] as const;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_GRACE_MS = 60_000;
const HEARTBEAT_CHECK_MS = 15_000;

function errorMessage(error: unknown, fallback?: string): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function isReadCancellation(error: unknown): boolean {
  return isCancelledError(error) || (error instanceof Error && error.name === "AbortError");
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
  const [orderSyncError, setOrderSyncError] = useState<string>();
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const reconnectAttemptRef = useRef(0);
  const synchronizationRef = useRef<BootstrapSynchronization | null>(null);
  if (!synchronizationRef.current) synchronizationRef.current = new BootstrapSynchronization();
  const synchronization = synchronizationRef.current;
  const ordersControllerRef = useRef<AbortController | undefined>(undefined);
  const socketGenerationRef = useRef(0);

  const invalidateReads = useCallback(() => {
    synchronization.invalidate();
    ordersControllerRef.current?.abort();
    return queryClient.cancelQueries({ queryKey: tradingQueryKey, exact: true });
  }, [queryClient, synchronization]);

  const loadBootstrap = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    ordersControllerRef.current?.abort();
    const token = synchronization.beginBootstrap(Boolean(queryClient.getQueryData(tradingQueryKey)));
    try {
      const data = await fetchTradingBootstrap(signal);
      if (signal.aborted || !synchronization.isCurrentBootstrap(token)) {
        throw new DOMException("Bootstrap read was cancelled", "AbortError");
      }
      return synchronization.finishBootstrap(token, data);
    } catch (error) {
      if (!signal.aborted && synchronization.isCurrentBootstrap(token) && synchronization.ordersIncomplete) {
        setOrderSyncError(`订单同步失败，列表可能不完整：${errorMessage(error, "请刷新或重新连接")}`);
      }
      synchronization.failBootstrap(token);
      throw error;
    }
  }, [queryClient, synchronization]);

  const bootstrapQuery = useQuery({
    queryKey: tradingQueryKey,
    queryFn: loadBootstrap,
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

  const applyDataEvent = useCallback((event: BootstrapDataEvent) => {
    synchronization.record(event, Boolean(queryClient.getQueryData(tradingQueryKey)));
    updateBootstrap((current) => applyBootstrapEvent(current, event));
    if (event.type === "orders.snapshot") setOrderSyncError(undefined);
  }, [queryClient, synchronization, updateBootstrap]);

  useEffect(() => {
    if (!enabled || !bootstrapQuery.data) return;
    if (!synchronization.ordersIncomplete) setOrderSyncError(undefined);
    const token = synchronization.takeOrdersCatchup();
    if (!token) return;
    const controller = new AbortController();
    ordersControllerRef.current = controller;
    const socketGeneration = socketGenerationRef.current;
    setOrderSyncError("订单更新超出初始化缓冲，正在重新同步；当前列表可能不完整。");
    const isCurrent = () => !controller.signal.aborted &&
      socketGenerationRef.current === socketGeneration && synchronization.isCurrentOrders(token);
    void (async () => {
      try {
        const result = await fetchRecentOrders(controller.signal);
        if (!isCurrent()) return;
        const orders = synchronization.finishOrders(token, result);
        if (orders) applyDataEvent({ type: "orders.snapshot", data: orders });
        else setOrderSyncError("订单更新仍超出同步缓冲，列表可能不完整，请刷新或重新连接。");
      } catch (error) {
        if (!isCurrent()) return;
        synchronization.cancelOrders();
        if (synchronization.ordersIncomplete) {
          setOrderSyncError(`订单同步失败，列表可能不完整：${errorMessage(error, "请刷新或重新连接")}`);
        }
      } finally {
        if (ordersControllerRef.current === controller) ordersControllerRef.current = undefined;
      }
    })();
  }, [enabled, bootstrapQuery.dataUpdatedAt, bootstrapQuery.data, synchronization, applyDataEvent]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const generation = synchronization.generation;
    try {
      await queryClient.fetchQuery({
        queryKey: tradingQueryKey,
        queryFn: loadBootstrap,
        staleTime: 0,
      });
      if (synchronization.generation === generation) setTransportError(undefined);
    } catch (refreshError) {
      if (isReadCancellation(refreshError) || synchronization.generation !== generation) return;
      setRealtimeState("offline");
      setTransportError(errorMessage(refreshError, "交易后端不可用"));
      throw refreshError;
    }
  }, [enabled, queryClient, loadBootstrap, synchronization]);

  useEffect(() => {
    if (!enabled) {
      void invalidateReads();
      void queryClient.resetQueries({ queryKey: tradingQueryKey, exact: true });
      setRealtimeState("offline");
      setTransportError(undefined);
      setOrderSyncError(undefined);
      reconnectAttemptRef.current = 0;
      return;
    }

    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let lastMessageTime = Date.now();
    let active = true;
    const connectionGeneration = synchronization.generation;
    const isCurrentConnection = () => active && synchronization.generation === connectionGeneration;

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
      if (!isCurrentConnection()) {
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
        if (!isCurrentConnection()) {
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
        case "account.snapshot":
        case "positions.snapshot":
        case "orders.snapshot":
        case "order.updated":
          applyDataEvent(event);
          break;
        case "system.status":
          setNotice(event.data.message);
          break;
      }
    };

    const connect = () => {
      if (!isCurrentConnection()) {
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
      socketGenerationRef.current++;
      const currentSocket = new WebSocket(getTradingSocketUrl());
      socket = currentSocket;
      const isCurrentSocket = () => isCurrentConnection() && socket === currentSocket;

      currentSocket.addEventListener("open", () => {
        if (!isCurrentSocket()) {
          currentSocket.close();
          return;
        }
        setRealtimeState("connected");
        setTransportError(undefined);
        resetReconnectDelay();
        startHeartbeat();
      });

      currentSocket.addEventListener("message", (message) => {
        if (!isCurrentSocket()) {
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
        if (!isCurrentSocket()) return;
        if (isUnauthorizedWebSocketClose(event)) {
          notifyAuthExpired();
          return;
        }
        if (isCurrentSocket()) {
          ordersControllerRef.current?.abort();
          synchronization.cancelOrders();
          if (synchronization.ordersIncomplete) {
            setOrderSyncError("订单同步未完成，列表可能不完整，等待实时通道重新连接。");
          }
          socket = undefined;
          scheduleReconnect();
        }
      });

      currentSocket.addEventListener("error", () => {
        if (!isCurrentSocket()) {
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
      void invalidateReads();
    };
  }, [enabled, connectionEpoch, applyDataEvent, invalidateReads, queryClient, synchronization]);

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
    onSuccess: async (result) => {
      await invalidateReads();
      updateBootstrap((current) => ({
        ...current,
        account: result.account,
        positions: result.positions,
        orders: result.orders,
      }));
      setOrderSyncError(undefined);
      setConnectionEpoch((current) => current + 1);
      setNotice(
        `已开始新的本地模拟：初始资金 ¥${result.account.equity.toLocaleString("zh-CN")}，旧 Paper 数据已删除`,
      );
    },
    onError: (resetError) => {
      setTransportError(errorMessage(resetError, "重置模拟账户失败"));
    },
  });

  const executionStrategyMutation = useMutation({
    mutationFn: updatePaperExecutionStrategy,
    onMutate: () => {
      setNotice(undefined);
      setTransportError(undefined);
    },
    onSuccess: (result) => {
      updateBootstrap((current) => ({ ...current, account: result.account }));
      void queryClient.invalidateQueries({ queryKey: ["paper-trading-plan"] });
      setNotice("Paper 执行策略已更新，下一轮 Paper 买入计划开始生效");
    },
    onError: (strategyError) => {
      setTransportError(errorMessage(strategyError, "更新执行策略失败"));
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
      void queryClient.invalidateQueries({ queryKey: ["paper-trading-plan"] });
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
    ? orderSyncError ?? transportError ?? (bootstrap ? undefined : errorMessage(bootstrapQuery.error, "交易后端不可用"))
    : undefined;
  const pendingAction =
    submitMutation.isPending ||
    cancelMutation.isPending ||
    pauseMutation.isPending;
  const accountControlPending =
    resetAccountMutation.isPending ||
    strategyProfileMutation.isPending ||
    executionStrategyMutation.isPending;
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
    setExecutionStrategy: async (strategy) => {
      await executionStrategyMutation.mutateAsync(strategy);
    },
  };
}
