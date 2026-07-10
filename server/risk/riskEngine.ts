import type {
  AccountSnapshot,
  MarketQuote,
  OrderRequest,
  PositionSnapshot,
  RiskDecision,
  RiskLimits,
  TradingMode,
} from "../../shared/trading";

export class RiskEngine {
  constructor(private readonly limits: RiskLimits) {}

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  evaluate(input: {
    request: OrderRequest;
    quote?: MarketQuote;
    account: AccountSnapshot;
    position?: PositionSnapshot;
    reservedSellQuantity?: number;
    mode: TradingMode;
  }): RiskDecision {
    const {
      request,
      quote,
      account,
      position,
      reservedSellQuantity = 0,
      mode,
    } = input;

    if (mode === "live" && !this.limits.realTradingEnabled) {
      return this.reject("LIVE_TRADING_DISABLED", "真实交易开关未启用");
    }

    if (account.paused) {
      return this.reject("TRADING_PAUSED", "交易已暂停");
    }

    if (!quote) {
      return this.reject("UNKNOWN_SYMBOL", "没有可用的行情报价");
    }

    if (!quote.tradable) {
      return this.reject("NON_TRADABLE_SYMBOL", "当前标的仅用于行情展示，不能下单");
    }

    if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
      return this.reject("INVALID_QUANTITY", "订单数量必须是正整数");
    }

    if (request.quantity % this.limits.lotSize !== 0) {
      return this.reject(
        "INVALID_LOT_SIZE",
        `订单数量必须是 ${this.limits.lotSize} 的整数倍`,
      );
    }

    const orderPrice =
      request.type === "limit" ? (request.limitPrice ?? quote.price) : quote.price;
    const notional = orderPrice * request.quantity;
    if (notional > this.limits.maxOrderNotional) {
      return this.reject("ORDER_NOTIONAL_LIMIT", "订单金额超过单笔限额");
    }

    if (account.dailyPnlPercent <= -this.limits.maxDailyLoss) {
      return this.reject("DAILY_LOSS_LIMIT", "账户已触发每日亏损停止线");
    }

    if (request.side === "buy") {
      if (notional > account.cash) {
        return this.reject("INSUFFICIENT_CASH", "可用资金不足");
      }

      const currentValue = position?.marketValue ?? 0;
      const postTradeWeight =
        account.equity === 0 ? 1 : (currentValue + notional) / account.equity;

      if (postTradeWeight > this.limits.maxPositionWeight) {
        return this.reject("POSITION_WEIGHT_LIMIT", "成交后单一标的仓位将超过限制");
      }
    }

    if (request.side === "sell") {
      const availableQuantity = Math.max(
        0,
        (position?.quantity ?? 0) - reservedSellQuantity,
      );
      if (request.quantity > availableQuantity) {
        return this.reject("INSUFFICIENT_POSITION", "可卖持仓不足");
      }
    }

    return {
      allowed: true,
      code: "APPROVED",
      message: "风险检查通过",
    };
  }

  private reject(code: string, message: string): RiskDecision {
    return { allowed: false, code, message };
  }
}
