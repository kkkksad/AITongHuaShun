/**
 * AkShare 行情适配器 —— 对接 AkShare Python 桥接微服务。
 *
 * 本质是 HttpMarketProvider 的预配置版本：
 * - 默认连接 http://localhost:8800（AkShare 桥接默认端口）
 * - 带缓存优化的轮询间隔
 * - 支持 A 股代码格式
 *
 * 使用方式：
 *   const provider = new AkShareMarketProvider({ symbols: ["600519", "000858"] });
 *   provider.start();
 */
import { HttpMarketProvider } from "./HttpMarketProvider";
import type { HttpMarketConfig } from "./HttpMarketProvider";
import type { TradingMode } from "../../shared/trading";

export interface AkShareMarketConfig {
  /** AkShare 桥接服务地址 */
  baseUrl?: string;
  /** 监控的股票代码列表 */
  symbols?: string[];
  /** 轮询间隔（毫秒），建议 ≥3000 避免触发反爬 */
  tickMs?: number;
  /** 交易模式 */
  mode?: TradingMode;
  /** API 超时（毫秒） */
  timeout?: number;
  /** 服务端桥接令牌，不得暴露到浏览器。 */
  apiKey?: string;
}

/** A 股核心资产默认列表 */
export const AKSHARE_DEFAULT_SYMBOLS = [
  "600519", // 贵州茅台
  "000858", // 五粮液
  "300750", // 宁德时代
  "601318", // 中国平安
  "000001", // 平安银行
  "600036", // 招商银行
  "002594", // 比亚迪
  "688981", // 中芯国际
];

export class AkShareMarketProvider extends HttpMarketProvider {
  constructor(config: AkShareMarketConfig = {}) {
    const httpConfig: HttpMarketConfig = {
      baseUrl: config.baseUrl ?? "http://localhost:8800",
      tickMs: config.tickMs ?? 5000, // AkShare 有反爬，默认 5s
      mode: config.mode ?? "paper",
      symbols: config.symbols ?? AKSHARE_DEFAULT_SYMBOLS,
      timeout: config.timeout ?? 15_000, // AkShare 可能较慢
      apiKey: config.apiKey || undefined,
    };
    super(httpConfig);
  }
}
