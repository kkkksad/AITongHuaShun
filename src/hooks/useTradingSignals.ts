import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SignalSubscription,
  TradingSignal,
  WsSubscriptionRequest,
  WsUnsubscribeRequest,
} from "../../shared/trading";

// ── 类型 ──────────────────────────────────────────────────

export interface TradingSignalsState {
  /** 当前活跃信号列表 */
  activeSignals: TradingSignal[];
  /** 最新收到的信号 */
  latestSignal: TradingSignal | null;
  /** WebSocket 连接状态 */
  connected: boolean;
  /** 信号历史（最近N条） */
  signalHistory: TradingSignal[];
  /** 订阅筛选条件 */
  subscription: SignalSubscription;
  /** 更新订阅筛选 */
  setSubscription: (filter: SignalSubscription) => void;
}

const MAX_HISTORY = 200;

// ── Hook ──────────────────────────────────────────────────

export function useTradingSignals(
  wsUrl: string = `ws://${window.location.hostname}:8787/ws`,
  initialSubscription?: SignalSubscription,
): TradingSignalsState {
  const [connected, setConnected] = useState(false);
  const [latestSignal, setLatestSignal] = useState<TradingSignal | null>(null);
  const [activeSignals, setActiveSignals] = useState<TradingSignal[]>([]);
  const [signalHistory, setSignalHistory] = useState<TradingSignal[]>([]);
  const [subscription, setSubscription] = useState<SignalSubscription>(
    initialSubscription ?? {},
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const mountedRef = useRef(true);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttempts.current = 0;
        setConnected(true);

        // 订阅信号频道
        const subReq: WsSubscriptionRequest = {
          type: "subscribe",
          topic: "signals",
          filter: subscription,
        };
        ws.send(JSON.stringify(subReq));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.type === "signal" && msg.data) {
            const signal = msg.data as TradingSignal;
            setLatestSignal(signal);

            setSignalHistory((prev) => {
              const next = [signal, ...prev];
              if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
              return next;
            });

            setActiveSignals((prev) => {
              // 更新或添加信号
              const idx = prev.findIndex((s) => s.id === signal.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = signal;
                return updated;
              }
              return [signal, ...prev];
            });

            // 移除过期/已执行/已取消的信号
            if (
              signal.status === "expired" ||
              signal.status === "executed" ||
              signal.status === "cancelled"
            ) {
              setActiveSignals((prev) =>
                prev.filter((s) => s.id !== signal.id),
              );
            }
          }
        } catch {
          // 忽略无效消息
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);

        // 指数退避重连
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts.current),
          30000,
        );
        reconnectAttempts.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // onclose will handle reconnection
        ws.close();
      };
    } catch {
      // 连接失败，稍后重试
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    }
  }, [wsUrl, subscription]);

  // 初始连接
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        // 取消订阅
        try {
          const unsubReq: WsUnsubscribeRequest = {
            type: "unsubscribe",
            topic: "signals",
          };
          wsRef.current.send(JSON.stringify(unsubReq));
        } catch {
          // 忽略
        }
        wsRef.current.close();
      }
    };
  }, [connect]);

  // 当订阅条件变化时，重新发送订阅请求
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const subReq: WsSubscriptionRequest = {
        type: "subscribe",
        topic: "signals",
        filter: subscription,
      };
      wsRef.current.send(JSON.stringify(subReq));
    }
  }, [subscription]);

  return {
    activeSignals,
    latestSignal,
    connected,
    signalHistory,
    subscription,
    setSubscription,
  };
}
