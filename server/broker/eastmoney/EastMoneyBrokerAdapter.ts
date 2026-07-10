/**
 * 东方财富纸面券商适配器。
 *
 * 当前版本只模拟连接生命周期，所有订单、费用、风控、幂等和账户状态
 * 都委托给标准 PaperBroker 运行时，不发送任何外部订单请求。
 *
 * 安全约束：
 * - tradingEnabled 或 environment=live 会在构造阶段失败
 * - 不读取真实账户凭据，不包含真实下单端点
 * - 仅供研究界面和适配器契约验证使用
 */

import { EventEmitter } from "node:events";
import type {
  AccountSnapshot,
  MarketQuote,
  MarketSnapshot,
  OrderRecord,
  OrderRequest,
  PositionSnapshot,
  RiskLimits,
} from "../../../shared/trading";
import type {
  BrokerAdapter,
  BrokerAdapterConfig,
} from "../../contracts/BrokerAdapter";
import type { MarketDataProvider } from "../../contracts/MarketDataProvider";
import { PaperBroker } from "../paperBroker";
import { RiskEngine } from "../../risk/riskEngine";
import { InMemoryTradingStore } from "../../store/inMemoryTradingStore";

/** 东方财富券商特定配置 */
export interface EastMoneyBrokerConfig extends BrokerAdapterConfig {
  /** 本地纸面账户展示 ID */
  accountId?: string;
  /** 已废弃；传入 true 会直接拒绝构造。 */
  tradingEnabled?: boolean;
  /** 初始资金（模拟模式） */
  initialCapital?: number;
}

class MutablePaperMarket extends EventEmitter implements MarketDataProvider {
  private sequence = 0;
  private quotes = new Map<string, MarketQuote>();
  private marketTime = new Date().toISOString();

  start(): void {}

  stop(): void {}

  tick(): MarketSnapshot {
    this.sequence += 1;
    this.marketTime = new Date().toISOString();
    const snapshot = this.getSnapshot();
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  updateQuotes(quotes: MarketQuote[]): MarketSnapshot {
    for (const quote of quotes) {
      this.quotes.set(quote.symbol, { ...quote });
    }
    return this.tick();
  }

  getQuote(symbol: string): MarketQuote | undefined {
    const quote = this.quotes.get(symbol);
    return quote ? { ...quote } : undefined;
  }

  getSnapshot(): MarketSnapshot {
    return {
      mode: "paper",
      sequence: this.sequence,
      marketTime: this.marketTime,
      quotes: [...this.quotes.values()].map((quote) => ({ ...quote })),
    };
  }
}

export class EastMoneyBrokerAdapter
  extends EventEmitter
  implements BrokerAdapter
{
  private readonly config: {
    brokerId: string;
    brokerName: string;
    endpoint: string;
    environment: "paper" | "sandbox";
    credentialsRef: string;
    accountId: string;
    heartbeatMs: number;
  };
  private readonly market = new MutablePaperMarket();
  private readonly paperBroker: PaperBroker;
  private connected = false;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(config: EastMoneyBrokerConfig) {
    super();

    const environment = config.environment ?? "paper";
    if (config.tradingEnabled || environment === "live") {
      throw new Error("东方财富真实交易未实现，当前适配器禁止实盘");
    }

    const initialCapital = config.initialCapital ?? 1_000_000;
    const limits: RiskLimits = {
      maxOrderNotional: Math.max(initialCapital, 1_000_000),
      maxPositionWeight: 1,
      maxDailyLoss: 0.2,
      lotSize: 100,
      realTradingEnabled: false,
    };
    const store = new InMemoryTradingStore(initialCapital, false);
    const risk = new RiskEngine(limits);
    risk.setInitialEquity(initialCapital);

    this.paperBroker = new PaperBroker(this.market, store, risk, {
      mode: "paper",
      commissionRate: 0.0003,
      minimumCommission: 5,
      slippageBps: 0,
      limits,
    });
    this.config = {
      brokerId: config.brokerId ?? "eastmoney",
      brokerName: config.brokerName ?? "东方财富",
      endpoint: config.endpoint ?? "paper://eastmoney",
      environment,
      credentialsRef: config.credentialsRef ?? "",
      accountId: config.accountId ?? "EM-PAPER",
      heartbeatMs: config.heartbeatMs ?? 30_000,
    };

    this.paperBroker.on("order.updated", (order: OrderRecord) => {
      if (this.connected) {
        this.emit("order.updated", order);
      }
    });
    this.paperBroker.on("account.updated", (account: AccountSnapshot) => {
      if (this.connected) {
        this.emit("account.updated", {
          ...account,
          accountId: this.config.accountId,
        });
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.delay(50);
    this.connected = true;
    this.heartbeatTimer = setInterval(() => {
      this.emit("connection.status", {
        connected: this.connected,
        message: `heartbeat ok (${this.config.brokerId})`,
      });
    }, this.config.heartbeatMs);
    this.heartbeatTimer.unref();

    this.emit("connection.status", {
      connected: true,
      message: `connected to ${this.config.brokerName} [PAPER]`,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
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
    return {
      ...this.paperBroker.getAccount(snapshot),
      accountId: this.config.accountId,
    };
  }

  /** 更新纸面运行时的行情缓存，不会触发任何外部订单请求。 */
  updateQuotes(quotes: MarketQuote[]): void {
    const snapshot = this.market.updateQuotes(quotes);
    if (this.connected) {
      this.paperBroker.markToMarket(snapshot);
    }
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
