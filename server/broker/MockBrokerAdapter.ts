import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
} from "../../shared/trading";
import type {
  BrokerAdapter,
  BrokerAdapterConfig,
} from "../contracts/BrokerAdapter";
import type { PaperBroker } from "./paperBroker";

/**
 * 模拟网络券商适配器。
 *
 * 它只负责连接生命周期、网络延迟和事件转发。订单撮合、费用、
 * 风控、幂等和账户更新全部委托给 PaperBroker，避免形成第二套交易逻辑。
 */
export class MockBrokerAdapter extends EventEmitter implements BrokerAdapter {
  private connected = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: BrokerAdapterConfig,
    private readonly paperBroker: PaperBroker,
  ) {
    super();

    if ((config.environment ?? "paper") === "live") {
      throw new Error("MockBrokerAdapter 禁止实盘环境");
    }

    this.paperBroker.on("order.updated", (order: OrderRecord) => {
      if (this.connected) {
        this.emit("order.updated", order);
      }
    });
    this.paperBroker.on("account.updated", (account: AccountSnapshot) => {
      if (this.connected) {
        this.emit("account.updated", account);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.delay(50);
    this.connected = true;

    const heartbeatMs = this.config.heartbeatMs ?? 30_000;
    this.heartbeatInterval = setInterval(() => {
      this.emit("connection.status", {
        connected: this.connected,
        message: `heartbeat ok (${this.config.brokerId})`,
      });
    }, heartbeatMs);
    this.heartbeatInterval.unref();

    this.emit("connection.status", {
      connected: true,
      message: `connected to ${this.config.brokerName}`,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    this.emit("connection.status", {
      connected: false,
      message: "disconnected",
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async submitOrder(request: OrderRequest): Promise<OrderRecord> {
    this.ensureConnected();
    await this.delay(30);
    return this.paperBroker.submitOrder(request);
  }

  async cancelOrder(orderId: string): Promise<OrderRecord> {
    this.ensureConnected();
    await this.delay(20);
    return this.paperBroker.cancelOrder(orderId);
  }

  async getOrders(limit?: number): Promise<OrderRecord[]> {
    this.ensureConnected();
    await this.delay(10);
    return this.paperBroker.getOrders(limit);
  }

  async getPositions(snapshot?: MarketSnapshot): Promise<PositionSnapshot[]> {
    this.ensureConnected();
    await this.delay(10);
    return this.paperBroker.getPositions(snapshot);
  }

  async getAccount(snapshot?: MarketSnapshot): Promise<AccountSnapshot> {
    this.ensureConnected();
    await this.delay(10);
    return this.paperBroker.getAccount(snapshot);
  }

  async checkPendingOrders(snapshot: MarketSnapshot): Promise<void> {
    this.ensureConnected();
    this.paperBroker.markToMarket(snapshot);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        `Broker ${this.config.brokerId} not connected. Call connect() first.`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
