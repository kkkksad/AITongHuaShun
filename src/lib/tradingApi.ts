import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";

export interface HealthSnapshot {
  ok: boolean;
  service: string;
  mode: TradingMode;
  realTradingEnabled: boolean;
  websocketConnections: number;
  timestamp: string;
}

export interface TradingBootstrap {
  health: HealthSnapshot;
  market: MarketSnapshot;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
  orders: OrderRecord[];
  limits: RiskLimits;
}

export interface OrderSubmission {
  order: OrderRecord;
  account: AccountSnapshot;
  positions: PositionSnapshot[];
}

interface AccountResponse {
  account: AccountSnapshot;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & {
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message ?? `请求失败：${response.status}`);
  }

  return payload;
}

export async function fetchTradingBootstrap(): Promise<TradingBootstrap> {
  const [health, market, account, positions, orders, limits] = await Promise.all([
    request<HealthSnapshot>("/api/health"),
    request<MarketSnapshot>("/api/market/snapshot"),
    request<AccountSnapshot>("/api/account"),
    request<PositionSnapshot[]>("/api/positions"),
    request<OrderRecord[]>("/api/orders?limit=50"),
    request<RiskLimits>("/api/risk/limits"),
  ]);

  return { health, market, account, positions, orders, limits };
}

export function submitPaperOrder(order: OrderRequest): Promise<OrderSubmission> {
  return request<OrderSubmission>("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function cancelPaperOrder(orderId: string): Promise<OrderSubmission> {
  return request<OrderSubmission>(`/api/orders/${orderId}`, {
    method: "DELETE",
  });
}

export function setPaperTradingPaused(paused: boolean): Promise<AccountResponse> {
  return request<AccountResponse>(
    paused ? "/api/trading/pause" : "/api/trading/resume",
    { method: "POST" },
  );
}

export function fetchAuditEvents(limit = 100): Promise<AuditEvent[]> {
  return request<AuditEvent[]>(`/api/audit?limit=${limit}`);
}

export function getTradingSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
