import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
} from "../../shared/trading";

export type BrokerEnvironment = "paper" | "sandbox" | "live";

/**
 * 券商适配器契约 —— 隔离连接生命周期与订单执行入口。
 *
 * 设计原则：
 * - 适配器不得自行绕过风控、审批或幂等检查。
 * - 所有方法返回不可变副本，不持有外部引用
 * - 事件语义：'order.updated' / 'account.updated' / 'connection.status'
 * - 连接生命周期与行情分离，支持独立 connect/disconnect
 */
export interface BrokerAdapter {
  // ── 连接管理 ──

  /** 连接到券商网关（认证、建立会话）。 */
  connect(): Promise<void>;

  /** 断开连接，释放资源。 */
  disconnect(): Promise<void>;

  /** 连接状态。 */
  isConnected(): boolean;

  // ── 订单管理 ──

  /**
   * 提交订单到券商。
   * 返回的 OrderRecord 初始状态为 'accepted'，后续状态通过事件异步推送。
   */
  submitOrder(request: OrderRequest): Promise<OrderRecord>;

  /**
   * 撤销指定订单。
   * 抛出异常如果订单不存在或无法撤销。
   */
  cancelOrder(orderId: string): Promise<OrderRecord>;

  /**
   * 查询当前券商侧的订单列表。
   * @param limit 最大返回数量
   */
  getOrders(limit?: number): Promise<OrderRecord[]>;

  // ── 持仓与账户 ──

  /**
   * 获取当前持仓快照。
   * @param snapshot 可选行情快照用于计算市值
   */
  getPositions(snapshot?: MarketSnapshot): Promise<PositionSnapshot[]>;

  /**
   * 获取账户快照。
   * @param snapshot 可选行情快照用于计算市值
   */
  getAccount(snapshot?: MarketSnapshot): Promise<AccountSnapshot>;

  // ── 事件 ──

  /** 订阅订单状态更新事件。 */
  on(event: "order.updated", listener: (order: OrderRecord) => void): this;

  /** 取消订阅订单状态更新事件。 */
  off(event: "order.updated", listener: (order: OrderRecord) => void): this;

  /** 订阅账户更新事件。 */
  on(event: "account.updated", listener: (account: AccountSnapshot) => void): this;

  /** 取消订阅账户更新事件。 */
  off(event: "account.updated", listener: (account: AccountSnapshot) => void): this;

  /** 订阅连接状态变更事件。 */
  on(
    event: "connection.status",
    listener: (status: { connected: boolean; message: string }) => void,
  ): this;

  /** 取消订阅连接状态变更事件。 */
  off(
    event: "connection.status",
    listener: (status: { connected: boolean; message: string }) => void,
  ): this;
}

/**
 * 券商适配器配置基类。
 * 各券商实现在此基础上扩展。
 */
export interface BrokerAdapterConfig {
  /** 券商标识（如 'htsc'、'citic'、'eastmoney'） */
  brokerId: string;

  /** 券商名称（展示用） */
  brokerName: string;

  /** 券商 API 网关地址 */
  endpoint: string;

  /** 运行环境；模拟实现必须拒绝 live。 */
  environment?: BrokerEnvironment;

  /** 服务端密钥管理系统中的凭据引用，不保存明文 Token。 */
  credentialsRef?: string;

  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatMs?: number;

  /** 请求超时（毫秒），默认 10000 */
  timeoutMs?: number;
}
