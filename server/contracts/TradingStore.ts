import type {
  AccountSnapshot,
  AuditEvent,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PaperStrategyProfile,
  PositionSnapshot,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";

/**
 * 交易数据持久化契约 —— 所有存储后端（内存、PostgreSQL、SQLite）
 * 都必须实现此接口。
 *
 * 设计原则：
 * - 纯接口，不包含具体存储逻辑。
 * - 返回数据为不可变副本，调用方不应修改。
 * - 方法按领域分组：账户、持仓、订单、审计。
 */
export interface TradingStore {
  // ── 账户生命周期 ──

  /** 是否处于暂停交易状态。 */
  isPaused(): boolean;

  /** 切换暂停 / 恢复状态。 */
  setPaused(paused: boolean): void;

  /** 获取可用现金（已扣除冻结资金）。 */
  getAvailableCash(): number;

  /** 获取总现金（含冻结）。 */
  getCash(): number;

  /** 获取当前本地 paper 策略风险档位。 */
  getStrategyProfile(): PaperStrategyProfile;

  /** 修改后续 paper 计划使用的策略风险档位。 */
  setStrategyProfile(profile: PaperStrategyProfile): void;

  /** 清空旧 paper 账户状态并以纯现金开始新一轮模拟。 */
  resetAccount(input: {
    startingCash: number;
    strategyProfile: PaperStrategyProfile;
  }): void;

  // ── 持仓 ──

  /** 获取某个标的的持仓数量。 */
  getPositionQuantity(symbol: string): number;

  /** 按当前行情计算持仓明细。 */
  getPositions(snapshot: MarketSnapshot): PositionSnapshot[];

  // ── 账户快照 ──

  /** 按当前行情与风控限额计算账户快照。 */
  getAccount(mode: TradingMode, snapshot: MarketSnapshot, limits: RiskLimits): AccountSnapshot;

  // ── 订单 ──

  /** 按客户端订单 ID 查重。 */
  findByClientOrderId(clientOrderId?: string): OrderRecord | undefined;

  /** 按内部订单 ID 查找。 */
  findOrderById(id: string): OrderRecord | undefined;

  /** 获取所有挂单（status === 'pending'）。 */
  getPendingOrders(): OrderRecord[];

  /** 创建订单记录（不执行风控、不撮合）。 */
  createOrder(request: OrderRequest, requestedPrice: number, name?: string): OrderRecord;

  /** 标记订单为已拒绝。 */
  rejectOrder(order: OrderRecord, reason: string, code: string): OrderRecord;

  /** 撤销挂单。 */
  cancelOrder(order: OrderRecord): OrderRecord;

  /** 检查限价单是否满足成交条件。 */
  checkLimitOrderFill(
    order: OrderRecord,
    quote: { symbol: string; name: string; price: number },
  ): boolean;

  /** 成交订单并更新持仓与现金。 */
  fillOrder(
    order: OrderRecord,
    name: string,
    fillPrice: number,
    commission: number,
  ): OrderRecord;

  /** 订单列表（最近优先）。 */
  listOrders(limit?: number): OrderRecord[];

  // ── 审计 ──

  /** 审计事件列表（最近优先）。 */
  listAudit(limit?: number): AuditEvent[];

  /** 追加审计事件。 */
  appendAudit(
    category: AuditEvent["category"],
    action: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
}
