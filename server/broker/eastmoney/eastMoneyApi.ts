/**
 * 东方财富公开行情 API 客户端。
 *
 * 使用东方财富公开 HTTP 接口获取 A 股实时行情数据。
 * 无需认证，有频率限制（建议不超过每秒 3 次）。
 *
 * API 参考：
 * - 个股行情：push2.eastmoney.com/api/qt/stock/get
 * - 板块列表：push2.eastmoney.com/api/qt/clist/get
 */

/** 东方财富 API 返回的原始个股行情 */
export interface EastMoneyQuoteRaw {
  /** 证券代码 */
  f57: string;
  /** 证券名称 */
  f58: string;
  /** 最新价（需除以 100 或 1000，视标的类型） */
  f43: number;
  /** 昨收 */
  f60: number;
  /** 开盘 */
  f46: number;
  /** 最高 */
  f44: number;
  /** 最低 */
  f45: number;
  /** 成交量（手） */
  f47: number;
  /** 成交额 */
  f48: number;
  /** 涨跌幅（%） */
  f170: number;
  /** 涨跌额 */
  f169: number;
  /** 量比 */
  f50: number;
  /** 换手率（%） */
  f168: number;
  /** 市盈率 */
  f162: number;
  /** 总市值 */
  f116: number;
  /** 流通市值 */
  f117: number;
  /** 更新时间 */
  f86?: number;
}

/** 东方财富 API 原始响应 */
interface EastMoneyApiResponse {
  rc: number;
  rt: number;
  svr: number;
  lt: number;
  full: number;
  data?: {
    /** 个股数据 */
    [secid: string]: EastMoneyQuoteRaw;
  } | null;
}

/** 转换后的标准行情数据 */
export interface NormalizedQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  changePercent: number;
  changeAmount: number;
  volume: number;
  turnover: number;
  pe: number;
  totalMarketCap: number;
  circulatingMarketCap: number;
  turnoverRate: number;
  updatedAt: number;
}

/**
 * 判断证券代码所属市场。
 * 上证：6xxxxx, 5xxxxx, 9xxxxx
 * 深证：0xxxxx, 3xxxxx, 2xxxxx
 */
export function getEastMoneyMarket(code: string): "1" | "0" {
  const prefix = code.charAt(0);
  if (["6", "5", "9"].includes(prefix)) return "1"; // 上海
  return "0"; // 深圳
}

/**
 * 构建东方财富 secid。
 * 例：600519 → 1.600519, 000001 → 0.000001
 */
export function buildSecId(code: string): string {
  const market = getEastMoneyMarket(code);
  return `${market}.${code}`;
}

/**
 * 从 secid 解析回纯代码。
 * 例：1.600519 → 600519
 */
export function parseSecId(secid: string): string {
  return secid.split(".")[1] ?? secid;
}

/**
 * 将东方财富原始行情转换为标准格式。
 */
export function normalizeQuote(raw: EastMoneyQuoteRaw): NormalizedQuote {
  // 价格精度：股票价格通常以分为单位存储（/100）
  // 但某些字段直接以元为单位，需根据标的类型判断
  const isStock = String(raw.f57).length <= 6;

  const price = isStock ? raw.f43 / 100 : raw.f43 / 1000;
  const prevClose = isStock ? raw.f60 / 100 : raw.f60 / 1000;
  const open = isStock ? raw.f46 / 100 : raw.f46 / 1000;
  const high = isStock ? raw.f44 / 100 : raw.f44 / 1000;
  const low = isStock ? raw.f45 / 100 : raw.f45 / 1000;

  return {
    symbol: String(raw.f57),
    name: String(raw.f58),
    price: Number(price.toFixed(2)),
    previousClose: Number(prevClose.toFixed(2)),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    changePercent: raw.f170 ?? 0,
    changeAmount: raw.f169 ?? 0,
    volume: raw.f47 ?? 0,
    turnover: raw.f48 ?? 0,
    pe: raw.f162 ?? 0,
    totalMarketCap: raw.f116 ?? 0,
    circulatingMarketCap: raw.f117 ?? 0,
    turnoverRate: raw.f168 ?? 0,
    updatedAt: raw.f86 ?? Date.now(),
  };
}

/** API 配置 */
export interface EastMoneyApiConfig {
  /** 基础 URL */
  baseUrl?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 两次请求最小间隔（毫秒，防频率限制） */
  minIntervalMs?: number;
}

const DEFAULT_CONFIG: Required<EastMoneyApiConfig> = {
  baseUrl: "https://push2.eastmoney.com/api/qt",
  timeoutMs: 10000,
  minIntervalMs: 350,
};

/**
 * 东方财富行情 API 客户端。
 */
export class EastMoneyApi {
  private readonly config: Required<EastMoneyApiConfig>;
  private lastRequestTime = 0;

  constructor(config: EastMoneyApiConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取单只/多只股票实时行情。
   *
   * @param codes 证券代码数组（如 ["600519", "000001"]）
   * @returns 原始行情数据映射
   */
  async getQuotes(codes: string[]): Promise<Map<string, NormalizedQuote>> {
    if (codes.length === 0) return new Map();

    const secids = codes.map(buildSecId).join(",");
    const fields = [
      "f43",  // 最新价
      "f44",  // 最高
      "f45",  // 最低
      "f46",  // 开盘
      "f47",  // 成交量
      "f48",  // 成交额
      "f50",  // 量比
      "f57",  // 代码
      "f58",  // 名称
      "f60",  // 昨收
      "f116", // 总市值
      "f117", // 流通市值
      "f162", // 市盈率
      "f168", // 换手率
      "f169", // 涨跌额
      "f170", // 涨跌幅
    ].join(",");

    const url = `${this.config.baseUrl}/stock/get?secid=${secids}&fields=${fields}`;
    const data = await this.fetch<EastMoneyApiResponse>(url);

    const result = new Map<string, NormalizedQuote>();
    if (data?.data) {
      for (const [secid, raw] of Object.entries(data.data)) {
        if (raw && raw.f57) {
          result.set(String(raw.f57), normalizeQuote(raw as EastMoneyQuoteRaw));
        }
      }
    }

    return result;
  }

  /**
   * 获取单只股票行情。
   */
  async getQuote(code: string): Promise<NormalizedQuote | null> {
    const quotes = await this.getQuotes([code]);
    return quotes.get(code) ?? null;
  }

  /**
   * 获取板块成分股列表（用于批量获取行情）。
   * 例如沪深300、上证50等。
   *
   * @param fs 板块类型：m:0+t:6 (沪A), m:0+t:13 (深A)
   * @param page 页码
   * @param pageSize 每页数量
   */
  async getStockList(
    fs = "m:0+t:6,m:0+t:13",
    page = 1,
    pageSize = 100,
  ): Promise<string[]> {
    const url =
      `${this.config.baseUrl}/clist/get` +
      `?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2` +
      `&fid=f3&fs=${encodeURIComponent(fs)}` +
      `&fields=f12`;

    const data = await this.fetch<{
      data?: { diff?: Array<{ f12: string }> };
    }>(url);

    if (data?.data?.diff) {
      return data.data.diff.map((item) => item.f12);
    }
    return [];
  }

  // ── 私有方法 ──

  private async fetch<T>(url: string): Promise<T | null> {
    await this.rateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://quote.eastmoney.com/",
        },
      });

      if (!response.ok) {
        throw new Error(`EastMoney API HTTP ${response.status}`);
      }

      const text = await response.text();
      // 东方财富 API 返回的是 JSONP 格式的 JSON
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.config.minIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.minIntervalMs - elapsed),
      );
    }
    this.lastRequestTime = Date.now();
  }
}
