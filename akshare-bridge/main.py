"""
AkShare A股实时行情桥接微服务
=============================
为 AI量化系统提供 A 股实时行情数据的 HTTP API 桥梁。

启动：
    pip install -r requirements.txt
    python main.py

默认监听：http://127.0.0.1:8800
"""

import asyncio
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import requests
from pydantic import BaseModel, Field

from research_cache import HistoryCacheKey, ResearchHistoryCache

# ── 配置 ──────────────────────────────────────────────────

HOST = os.getenv("AKSHARE_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("AKSHARE_BRIDGE_PORT", "8800"))
CACHE_TTL_SEC = float(os.getenv("AKSHARE_BRIDGE_CACHE_TTL", "3.0"))
RESEARCH_CACHE_TTL_SEC = float(
    os.getenv("AKSHARE_BRIDGE_RESEARCH_CACHE_TTL", "900.0")
)
RESEARCH_CACHE_STALE_TTL_SEC = float(
    os.getenv("AKSHARE_BRIDGE_RESEARCH_CACHE_STALE_TTL", "3600.0")
)
AUTH_TOKEN = os.getenv("AKSHARE_BRIDGE_TOKEN", "")
DISABLE_PROXY = os.getenv("AKSHARE_BRIDGE_DISABLE_PROXY", "true").strip().lower() not in {
    "0",
    "false",
    "no",
}
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AKSHARE_BRIDGE_ORIGINS",
        "http://127.0.0.1:8787",
    ).split(",")
    if origin.strip()
]

if DISABLE_PROXY:
    for proxy_var in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        os.environ.pop(proxy_var, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"

import akshare as ak

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [akshare-bridge] %(levelname)s %(message)s",
)
logger = logging.getLogger("akshare-bridge")


# ── 数据模型 ──────────────────────────────────────────────

class MarketQuote(BaseModel):
    symbol: str
    name: str
    tradable: bool = True
    price: float
    previousClose: float
    changePercent: float
    volume: int
    updatedAt: str
    open: float | None = None
    high: float | None = None
    low: float | None = None
    amount: float | None = None
    turnover: float | None = None
    amplitude: float | None = None


class QuotesResponse(BaseModel):
    quotes: list[MarketQuote]


class StockSearchItem(BaseModel):
    symbol: str
    name: str
    price: float
    changePercent: float
    updatedAt: str


class StockSearchResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[StockSearchItem] = Field(default_factory=list)
    warning: str | None = None


class HongKongQuote(BaseModel):
    symbol: str
    name: str
    price: float
    previousClose: float
    changePercent: float
    volume: int
    updatedAt: str
    source: str
    open: float | None = None
    high: float | None = None
    low: float | None = None
    amount: float | None = None


class HongKongQuotesResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[HongKongQuote] = Field(default_factory=list)
    warning: str | None = None


class NewsItem(BaseModel):
    id: str
    source: str
    title: str
    publishedAt: str
    fetchedAt: str
    url: str | None = None
    symbols: list[str] = []
    sentiment: str = "neutral"
    summary: str | None = None


class NewsResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[NewsItem]
    warning: str | None = None


class GlobalMarketQuote(BaseModel):
    symbol: str
    name: str
    region: str
    price: float
    changePercent: float
    updatedAt: str
    source: str


class GlobalMarketsResponse(BaseModel):
    provider: str
    fetchedAt: str
    markets: list[GlobalMarketQuote]
    warning: str | None = None


class FuturesQuote(BaseModel):
    symbol: str
    name: str
    category: str
    price: float
    previousSettlement: float
    changePercent: float
    volume: int
    openInterest: int
    updatedAt: str
    source: str
    quoteTime: str | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    bidPrice: float | None = None
    askPrice: float | None = None
    averagePrice: float | None = None


class FuturesQuotesResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[FuturesQuote] = Field(default_factory=list)
    warning: str | None = None


class IpoSubscriptionItem(BaseModel):
    symbol: str
    name: str
    subscriptionCode: str
    exchange: str
    board: str
    issueTotalWanShares: float | None = None
    onlineIssueShares: int | None = None
    marketValueRequirementWan: float | None = None
    maxSubscriptionShares: int | None = None
    issuePrice: float | None = None
    latestPrice: float | None = None
    subscriptionDate: str | None = None
    ballotDate: str | None = None
    paymentDate: str | None = None
    listingDate: str | None = None
    issuePe: float | None = None
    industryPe: float | None = None
    winningRate: float | None = None
    firstDayChangePercent: float | None = None


class IpoSubscriptionsResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    items: list[IpoSubscriptionItem] = Field(default_factory=list)
    warning: str | None = None


class SectorSnapshot(BaseModel):
    symbol: str
    name: str
    price: float
    changePercent: float
    updatedAt: str
    amount: float | None = None
    turnover: float | None = None
    advancers: int | None = None
    decliners: int | None = None
    leaderName: str | None = None
    leaderChangePercent: float | None = None
    mainNetInflow: float | None = None


class SectorSnapshotResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    sectors: list[SectorSnapshot] = Field(default_factory=list)
    warning: str | None = None


class HistoricalBar(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float | None = None
    changePercent: float | None = None
    turnover: float | None = None


class HistoricalSeries(BaseModel):
    symbol: str
    name: str
    source: str
    adjustment: str
    bars: list[HistoricalBar] = Field(default_factory=list)


class HistoricalBarsResponse(BaseModel):
    provider: str
    source: str
    fetchedAt: str
    series: list[HistoricalSeries] = Field(default_factory=list)
    warning: str | None = None


INDEX_SYMBOL_MAP = {
    "000001": "SH000001",  # 上证指数
    "399001": "SZ399001",  # 深证成指
    "399006": "SZ399006",  # 创业板指
    "000300": "SH000300",  # 沪深300
}

GLOBAL_MARKET_ALIASES = {
    "道琼斯": ("DJI", "道琼斯指数", "US"),
    "纳斯达克": ("IXIC", "纳斯达克指数", "US"),
    "标普500": ("SPX", "标普500", "US"),
    "恒生指数": ("HSI", "恒生指数", "HK"),
    "日经225": ("N225", "日经225", "JP"),
    "英国富时100": ("FTSE", "英国富时100", "EU"),
    "德国DAX30": ("GDAXI", "德国DAX30", "EU"),
    "法国CAC40": ("FCHI", "法国CAC40", "EU"),
    "欧洲Stoxx50": ("SX5E", "欧洲Stoxx50", "EU"),
}

FUTURES_WATCHLIST = {
    "IF0": ("沪深300股指", "股指"),
    "IH0": ("上证50股指", "股指"),
    "IC0": ("中证500股指", "股指"),
    "IM0": ("中证1000股指", "股指"),
    "AU0": ("沪金", "贵金属"),
    "AG0": ("沪银", "贵金属"),
    "CU0": ("沪铜", "有色"),
    "AL0": ("沪铝", "有色"),
    "RB0": ("螺纹钢", "黑色"),
    "I0": ("铁矿石", "黑色"),
    "SC0": ("原油", "能源化工"),
    "TA0": ("PTA", "能源化工"),
    "MA0": ("甲醇", "能源化工"),
    "M0": ("豆粕", "农产品"),
    "Y0": ("豆油", "农产品"),
    "RM0": ("菜粕", "农产品"),
}

FUTURES_REALTIME_NODES = {
    "IF0": "qz_qh",
    "IH0": "szgz_qh",
    "IC0": "zzgz_qh",
    "IM0": "im_qh",
    "AU0": "hj_qh",
    "AG0": "by_qh",
    "CU0": "tong_qh",
    "AL0": "lv_qh",
    "RB0": "lwg_qh",
    "I0": "tks_qh",
    "SC0": "yy_qh",
    "TA0": "pta_qh",
    "MA0": "zc_qh",
    "M0": "dp_qh",
    "Y0": "dy_qh",
    "RM0": "czp_qh",
}


def rank_stock_matches(
    quotes: list[MarketQuote],
    query: str,
    limit: int,
) -> list[StockSearchItem]:
    normalized = query.strip().casefold()
    if not normalized:
        return []

    ranked: list[tuple[int, int, str, MarketQuote]] = []
    for quote in quotes:
        symbol = quote.symbol.casefold()
        name = quote.name.strip()
        normalized_name = name.casefold()
        if symbol == normalized:
            priority = 0
        elif normalized_name == normalized:
            priority = 1
        elif symbol.startswith(normalized):
            priority = 2
        elif normalized_name.startswith(normalized):
            priority = 3
        elif normalized in normalized_name:
            priority = 4
        else:
            continue
        ranked.append((priority, len(name), quote.symbol, quote))

    ranked.sort(key=lambda item: item[:3])
    return [
        StockSearchItem(
            symbol=quote.symbol,
            name=quote.name,
            price=quote.price,
            changePercent=quote.changePercent,
            updatedAt=quote.updatedAt,
        )
        for _, _, _, quote in ranked[:max(1, min(limit, 20))]
    ]


# ── 行情缓存 ──────────────────────────────────────────────

class QuoteCache:
    """In-memory stock quote cache with stale-while-refresh behavior."""

    def __init__(self, ttl_sec: float = 3.0):
        self.ttl_sec = ttl_sec
        self._data: dict[str, MarketQuote] = {}
        self._last_update: float = 0
        self._last_error: str | None = None
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task | None = None

    async def refresh(self) -> None:
        async with self._lock:
            now = time.time()
            if now - self._last_update < self.ttl_sec:
                return
            try:
                loop = asyncio.get_running_loop()
                df = await loop.run_in_executor(None, fetch_a_share_spot_dataframe)
                self._parse_dataframe(df)
                self._last_update = now
                self._last_error = None
                logger.info(
                    "stock cache refreshed, %d symbols, %.1fs",
                    len(self._data),
                    time.time() - now,
                )
            except Exception as exc:
                self._last_error = str(exc)
                logger.error("stock quote refresh failed: %s", exc)
                if not self._data:
                    raise

    def _needs_refresh(self) -> bool:
        return time.time() - self._last_update >= self.ttl_sec

    def _schedule_refresh(self) -> None:
        if self._refresh_task and not self._refresh_task.done():
            return
        self._refresh_task = asyncio.create_task(self._refresh_safely())

    async def _refresh_safely(self) -> None:
        try:
            await self.refresh()
        except Exception:
            pass

    def _safe_float(self, value, default: float = 0.0) -> float | None:
        if value is None:
            return None
        try:
            v = float(value)
            if v == 0:
                return None
            return v
        except (ValueError, TypeError):
            return None

    def _parse_dataframe(self, df) -> None:
        new_data: dict[str, MarketQuote] = {}
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

        for _, row in df.iterrows():
            try:
                symbol = normalize_a_share_symbol(row.get("代码", ""))
                if symbol is None:
                    continue

                name = str(row.get("名称", symbol))
                price = float(row.get("最新价", 0) or 0)
                previous_close = float(row.get("昨收", 0) or 0)
                change_pct = float(row.get("涨跌幅", 0) or 0)
                volume = int(float(row.get("成交量", 0) or 0))

                new_data[symbol] = MarketQuote(
                    symbol=symbol,
                    name=name,
                    tradable=True,
                    price=price,
                    previousClose=previous_close,
                    changePercent=change_pct,
                    volume=volume,
                    updatedAt=now_iso,
                    open=self._safe_float(row.get("今开")),
                    high=self._safe_float(row.get("最高")),
                    low=self._safe_float(row.get("最低")),
                    amount=self._safe_float(row.get("成交额")),
                    turnover=self._safe_float(row.get("换手率")),
                    amplitude=self._safe_float(row.get("振幅")),
                )
            except (ValueError, TypeError):
                continue

        self._data = new_data

    async def get_quotes(self, symbols: list[str]) -> list[MarketQuote]:
        if self._data and self._needs_refresh():
            self._schedule_refresh()
        elif not self._data:
            await self.refresh()

        results: list[MarketQuote] = []
        for sym in symbols:
            sym = sym.strip()
            if sym in self._data:
                results.append(self._data[sym])
        return results

    async def search(self, query: str, limit: int) -> list[StockSearchItem]:
        if self._data and self._needs_refresh():
            self._schedule_refresh()
        elif not self._data:
            await self.refresh()
        return rank_stock_matches(list(self._data.values()), query, limit)

    @property
    def count(self) -> int:
        return len(self._data)

    @property
    def age_sec(self) -> float:
        if self._last_update == 0:
            return float("inf")
        return time.time() - self._last_update

    @property
    def last_error(self) -> str | None:
        return self._last_error


class IndexCache:
    """In-memory index quote cache separated from stock quote symbols."""

    def __init__(self, ttl_sec: float = 3.0):
        self.ttl_sec = ttl_sec
        self._data: dict[str, MarketQuote] = {}
        self._last_update: float = 0
        self._last_error: str | None = None
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task | None = None

    async def refresh(self) -> None:
        async with self._lock:
            now = time.time()
            if now - self._last_update < self.ttl_sec:
                return
            try:
                loop = asyncio.get_running_loop()
                df = await loop.run_in_executor(None, fetch_a_share_index_dataframe)
                self._parse_dataframe(df)
                self._last_update = now
                self._last_error = None
                logger.info(
                    "index cache refreshed, %d indices, %.1fs",
                    len(self._data),
                    time.time() - now,
                )
            except Exception as exc:
                self._last_error = str(exc)
                logger.error("index quote refresh failed: %s", exc)
                if not self._data:
                    raise

    def _needs_refresh(self) -> bool:
        return time.time() - self._last_update >= self.ttl_sec

    def _schedule_refresh(self) -> None:
        if self._refresh_task and not self._refresh_task.done():
            return
        self._refresh_task = asyncio.create_task(self._refresh_safely())

    async def _refresh_safely(self) -> None:
        try:
            await self.refresh()
        except Exception:
            pass

    def _safe_float(self, value, default: float = 0.0) -> float | None:
        if value is None:
            return None
        try:
            v = float(value)
            if v == 0:
                return None
            return v
        except (ValueError, TypeError):
            return None

    def _parse_dataframe(self, df) -> None:
        new_data: dict[str, MarketQuote] = {}
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

        for _, row in df.iterrows():
            try:
                symbol = normalize_index_symbol(row.get("代码", ""))
                if symbol is None:
                    continue

                name = str(row.get("名称", symbol))
                price = float(row.get("最新价", 0) or 0)
                previous_close = float(row.get("昨收", 0) or 0)
                change_pct = float(row.get("涨跌幅", 0) or 0)
                volume = int(float(row.get("成交量", 0) or 0))

                new_data[symbol] = MarketQuote(
                    symbol=symbol,
                    name=name,
                    tradable=False,
                    price=price,
                    previousClose=previous_close,
                    changePercent=change_pct,
                    volume=volume,
                    updatedAt=now_iso,
                    open=self._safe_float(row.get("今开")),
                    high=self._safe_float(row.get("最高")),
                    low=self._safe_float(row.get("最低")),
                    amount=self._safe_float(row.get("成交额")),
                    amplitude=self._safe_float(row.get("振幅")),
                )
            except (ValueError, TypeError):
                continue

        self._data = new_data

    async def get_indices(self, symbols: list[str]) -> list[MarketQuote]:
        if self._data and self._needs_refresh():
            self._schedule_refresh()
        elif not self._data:
            await self.refresh()

        results: list[MarketQuote] = []
        for sym in symbols:
            normalized = normalize_index_symbol(sym)
            if normalized in self._data:
                results.append(self._data[normalized])
        return results

    @property
    def count(self) -> int:
        return len(self._data)

    @property
    def age_sec(self) -> float:
        if self._last_update == 0:
            return float("inf")
        return time.time() - self._last_update

    @property
    def last_error(self) -> str | None:
        return self._last_error


def fetch_a_share_spot_dataframe():
    """Fetch A-share spot quotes with provider fallback.

    AkShare's Eastmoney endpoint is faster, but it can be rejected by local
    network/proxy conditions. The legacy A-share spot endpoint is slower but
    proved more reliable in this Windows development environment.
    """
    providers = (
        ("eastmoney", ak.stock_zh_a_spot_em),
        ("a-share-spot", ak.stock_zh_a_spot),
    )
    last_error: Exception | None = None

    for provider_name, provider in providers:
        started_at = time.time()
        try:
            df = provider()
            logger.info(
                "行情源 %s 返回 %d 行，耗时 %.1fs",
                provider_name,
                len(df),
                time.time() - started_at,
            )
            return df
        except Exception as exc:
            last_error = exc
            logger.warning("行情源 %s 失败，尝试下一个来源: %s", provider_name, exc)

    assert last_error is not None
    raise last_error


def fetch_a_share_index_dataframe():
    """Fetch A-share index spot quotes with provider fallback."""
    providers = (
        ("eastmoney-index", ak.stock_zh_index_spot_em),
        ("sina-index", ak.stock_zh_index_spot_sina),
    )
    last_error: Exception | None = None

    for provider_name, provider in providers:
        started_at = time.time()
        try:
            df = provider()
            logger.info(
                "指数源 %s 返回 %d 行，耗时 %.1fs",
                provider_name,
                len(df),
                time.time() - started_at,
            )
            return df
        except Exception as exc:
            last_error = exc
            logger.warning("指数源 %s 失败，尝试下一个来源: %s", provider_name, exc)

    assert last_error is not None
    raise last_error


def fetch_hk_spot_dataframe():
    """Fetch the real read-only Hong Kong stock snapshot."""
    providers = (
        ("sina-hk-spot", ak.stock_hk_spot),
        ("eastmoney-hk-spot", ak.stock_hk_spot_em),
    )
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            return provider(), provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("港股行情源 %s 失败，尝试下一个来源: %s", provider_name, exc)
    assert last_error is not None
    raise last_error


def fetch_global_market_dataframe():
    """Fetch major global index quotes with provider fallback."""
    providers = []
    current_provider = getattr(ak, "index_global_spot_em", None)
    legacy_provider = getattr(ak, "stock_zh_index_global_spot_em", None)
    if callable(current_provider):
        providers.append(("global-index-em", current_provider))
    if callable(legacy_provider):
        providers.append(("global-index-em-legacy", legacy_provider))
    providers.append(("sina-global-history-latest", fetch_global_market_sina_snapshot_dataframe))
    if not providers:
        raise RuntimeError("当前 AkShare 版本没有可用的全球指数实时接口")
    last_error: Exception | None = None

    for provider_name, provider in providers:
        started_at = time.time()
        try:
            df = provider()
            logger.info(
                "全球指数源 %s 返回 %d 行，耗时 %.1fs",
                provider_name,
                len(df),
                time.time() - started_at,
            )
            return df, provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("全球指数源 %s 失败，尝试下一个来源: %s", provider_name, exc)

    assert last_error is not None
    raise last_error


def fetch_futures_spot_dataframe(symbols: list[str]):
    """Fetch real domestic main-contract snapshots from Sina through AkShare."""
    try:
        dataframe = ak.futures_zh_spot(
            symbol=",".join(symbols),
            market="CF",
            adjust="0",
        )
        return dataframe, "sina-domestic-futures-spot"
    except Exception as exc:
        logger.warning("AkShare 期货批量快照解析失败，使用新浪 JSON 兼容读取: %s", exc)
        return (
            fetch_sina_futures_realtime_dataframe(symbols),
            "sina-domestic-futures-realtime-compat",
        )


def fetch_sina_futures_realtime_dataframe(symbols: list[str]):
    """Read controlled continuous rows from Sina's structured futures endpoint."""
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "Market_Center.getHQFuturesData"
    )

    def fetch_one(symbol: str) -> dict[str, object]:
        node = FUTURES_REALTIME_NODES[symbol]
        response = requests.get(
            url,
            params={
                "page": "1",
                "sort": "position",
                "asc": "0",
                "node": node,
                "base": "futures",
            },
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise RuntimeError(f"{symbol}: 新浪期货响应不是列表")
        continuous = next(
            (
                row
                for row in payload
                if str(row.get("symbol", "")).strip().upper() == symbol
            ),
            None,
        )
        if continuous is None:
            raise RuntimeError(f"{symbol}: 未找到连续合约行")
        return {
            "contract": symbol,
            "symbol": continuous.get("name", symbol),
            "time": continuous.get("ticktime"),
            "open": continuous.get("open"),
            "high": continuous.get("high"),
            "low": continuous.get("low"),
            "current_price": continuous.get("trade"),
            "bid_price": continuous.get("bidprice1"),
            "ask_price": continuous.get("askprice1"),
            "hold": continuous.get("position"),
            "volume": continuous.get("volume"),
            "avg_price": continuous.get("settlement"),
            "last_close": continuous.get("preclose"),
            "last_settle_price": (
                continuous.get("presettlement")
                or continuous.get("prevsettlement")
            ),
        }

    rows_by_symbol: dict[str, dict[str, object]] = {}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=min(4, len(symbols))) as executor:
        futures = {
            executor.submit(fetch_one, symbol): symbol
            for symbol in symbols
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                rows_by_symbol[symbol] = future.result()
            except Exception as exc:
                errors.append(f"{symbol}: {exc}")

    rows = [rows_by_symbol[symbol] for symbol in symbols if symbol in rows_by_symbol]
    if not rows:
        raise RuntimeError("新浪期货兼容源全部失败: " + "; ".join(errors[:6]))
    if errors:
        logger.warning("新浪期货兼容源部分失败: %s", "; ".join(errors[:6]))
    return pd.DataFrame(rows)


def fetch_futures_history_dataframe(
    symbol: str,
    start_date: str,
    end_date: str,
):
    """Fetch a domestic main continuous daily series from Sina through AkShare."""
    dataframe = ak.futures_main_sina(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
    )
    return dataframe, "sina-domestic-main-continuous"


def fetch_global_market_sina_snapshot_dataframe():
    """Build a small real global snapshot from Sina's latest two daily bars."""
    symbols = (
        ("日经225指数", "NKY", "日经225"),
        ("英国富时100指数", "UKX", "英国富时100"),
        ("德国DAX 30种股价指数", "DAX", "德国DAX30"),
        ("法CAC40指数", "CAC", "法国CAC40"),
        ("欧洲Stoxx50指数", "SX5E", "欧洲Stoxx50"),
    )
    rows: list[dict[str, object]] = []
    errors: list[str] = []
    for query_name, symbol, name in symbols:
        try:
            df = ak.index_global_hist_sina(symbol=query_name)
            if len(df) < 2:
                errors.append(f"{symbol}: 历史不足")
                continue
            latest = df.iloc[-1]
            previous = df.iloc[-2]
            close = parse_float(latest.get("close"), 0)
            previous_close = parse_float(previous.get("close"), 0)
            if close <= 0 or previous_close <= 0:
                errors.append(f"{symbol}: 收盘价无效")
                continue
            rows.append({
                "代码": symbol,
                "名称": name,
                "最新价": close,
                "涨跌幅": (close / previous_close - 1) * 100,
            })
        except Exception as exc:
            errors.append(f"{symbol}: {exc}")
    if not rows:
        raise RuntimeError("新浪全球指数回退不可用: " + "; ".join(errors[:5]))
    return pd.DataFrame(rows)


def fetch_financial_news_dataframe():
    """Fetch public financial news with provider fallback."""
    providers = (
        ("eastmoney-financial-news", lambda: ak.stock_news_em()),
    )
    last_error: Exception | None = None

    for provider_name, provider in providers:
        started_at = time.time()
        try:
            df = provider()
            logger.info(
                "新闻源 %s 返回 %d 行，耗时 %.1fs",
                provider_name,
                len(df),
                time.time() - started_at,
            )
            return df, provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("新闻源 %s 失败，尝试下一个来源: %s", provider_name, exc)

    assert last_error is not None
    raise last_error


def fetch_ipo_subscriptions_dataframe():
    """Fetch the EastMoney A-share IPO subscription/listing table."""
    return ak.stock_xgsglb_em(symbol="全部股票"), "eastmoney-ipo-subscription"


def fetch_sector_snapshot_dataframe():
    """Fetch the current industry-board snapshot with a THS fallback."""
    providers = (
        ("eastmoney-industry-board", ak.stock_board_industry_name_em),
        ("ths-industry-summary", ak.stock_board_industry_summary_ths),
    )
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            return provider(), provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("行业板块源 %s 失败，尝试下一个来源: %s", provider_name, exc)
    assert last_error is not None
    raise last_error


def fetch_sector_fund_flow_dataframe():
    """Fetch current industry main-fund flow; callers may degrade without it."""
    return ak.stock_sector_fund_flow_rank(
        indicator="今日",
        sector_type="行业资金流",
    )


def fetch_sector_history_dataframe(
    sector: str,
    start_date: str,
    end_date: str,
):
    """Fetch unadjusted industry-board daily bars with a THS fallback."""
    providers = (
        (
            "eastmoney-industry-history",
            lambda: ak.stock_board_industry_hist_em(
                symbol=sector,
                start_date=start_date,
                end_date=end_date,
                period="日k",
                adjust="",
            ),
        ),
        (
            "ths-industry-history",
            lambda: ak.stock_board_industry_index_ths(
                symbol=sector,
                start_date=start_date,
                end_date=end_date,
            ),
        ),
    )
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            return provider(), provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("板块历史源 %s 失败，尝试下一个来源: %s", provider_name, exc)
    assert last_error is not None
    raise last_error


def a_share_market_symbol(symbol: str) -> str:
    if symbol.startswith(("4", "8", "9")):
        return f"bj{symbol}"
    if symbol.startswith(("5", "6", "7")):
        return f"sh{symbol}"
    return f"sz{symbol}"


def fetch_stock_history_dataframe(
    symbol: str,
    start_date: str,
    end_date: str,
):
    """Fetch forward-adjusted A-share daily bars with public fallbacks."""
    market_symbol = a_share_market_symbol(symbol)
    providers = (
        (
            "eastmoney-stock-history",
            lambda: ak.stock_zh_a_hist(
                symbol=symbol,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
                timeout=12,
            ),
        ),
        (
            "tencent-stock-history",
            lambda: ak.stock_zh_a_hist_tx(
                symbol=market_symbol,
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
                timeout=12,
            ),
        ),
        (
            "sina-stock-history",
            lambda: ak.stock_zh_a_daily(
                symbol=market_symbol,
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
            ),
        ),
    )
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            return provider(), provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("股票历史源 %s 失败，尝试下一个来源: %s", provider_name, exc)
    assert last_error is not None
    raise last_error


def fetch_hk_history_dataframe(
    symbol: str,
    start_date: str,
    end_date: str,
):
    """Fetch forward-adjusted Hong Kong daily bars from EastMoney."""
    providers = (
        (
            "eastmoney-hk-history",
            lambda: ak.stock_hk_hist(
                symbol=symbol,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
            ),
        ),
        (
            "sina-hk-history",
            lambda: ak.stock_hk_daily(symbol=symbol, adjust="qfq"),
        ),
    )
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            return provider(), provider_name
        except Exception as exc:
            last_error = exc
            logger.warning("港股历史源 %s 失败，尝试下一个来源: %s", provider_name, exc)
    assert last_error is not None
    raise last_error


def first_existing(row, names: tuple[str, ...], default=None):
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip() and str(value).strip().lower() != "nan":
            return value
    return default


def parse_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(str(value).replace("%", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return default


def parse_optional_float(value) -> float | None:
    if value is None or str(value).strip().lower() in {"", "nan", "none", "-"}:
        return None
    parsed = parse_float(value, float("nan"))
    return parsed if parsed == parsed else None


def parse_optional_int(value) -> int | None:
    parsed = parse_optional_float(value)
    return int(parsed) if parsed is not None else None


def normalize_datetime(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    text = text.replace("/", "-")
    if re.match(r"^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}", text):
        return text.replace(" ", "T")[:19] + "+08:00"
    if re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", text):
        return text + "T00:00:00+08:00"
    return text


def normalize_date_only(value: object) -> str | None:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip().replace("/", "-")
    if text.lower() in {"", "nan", "none", "-"}:
        return None
    match = re.match(r"^(\d{4}-\d{1,2}-\d{1,2})", text)
    if match is None:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def infer_sentiment(title: str) -> str:
    positive_words = ("增长", "上调", "突破", "利好", "回升", "上涨", "预增", "创新高")
    negative_words = ("下调", "风险", "亏损", "处罚", "下跌", "回落", "减持", "预亏")
    if any(word in title for word in positive_words):
        return "positive"
    if any(word in title for word in negative_words):
        return "negative"
    return "neutral"


def extract_symbols(text: str) -> list[str]:
    symbols = re.findall(r"(?<!\d)(\d{6})(?!\d)", text)
    return list(dict.fromkeys(symbols))[:8]


def normalize_news_dataframe(df, provider_name: str, limit: int) -> list[NewsItem]:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    items: list[NewsItem] = []

    for index, row in df.head(limit).iterrows():
        title = str(first_existing(row, ("新闻标题", "标题", "title", "内容"), "")).strip()
        if not title:
            continue
        source = str(first_existing(row, ("文章来源", "来源", "source"), provider_name)).strip()
        published = first_existing(row, ("发布时间", "时间", "日期", "datetime", "time"), fetched_at)
        url = first_existing(row, ("新闻链接", "链接", "url", "地址"), None)
        summary = first_existing(row, ("新闻内容", "摘要", "summary"), None)
        text_for_symbols = f"{title} {summary or ''}"

        items.append(NewsItem(
            id=f"{provider_name}-{index}-{abs(hash(title)) % 1000000}",
            source=source or provider_name,
            title=title,
            publishedAt=normalize_datetime(published),
            fetchedAt=fetched_at,
            url=str(url).strip() if url else None,
            symbols=extract_symbols(text_for_symbols),
            sentiment=infer_sentiment(title),
            summary=str(summary).strip()[:240] if summary else None,
        ))

    return items


def normalize_ipo_subscriptions_dataframe(
    df,
    limit: int,
) -> list[IpoSubscriptionItem]:
    items: list[IpoSubscriptionItem] = []

    for _, row in df.head(limit).iterrows():
        symbol = normalize_a_share_symbol(first_existing(row, ("股票代码",), ""))
        name = str(first_existing(row, ("股票简称",), "")).strip()
        subscription_code = normalize_a_share_symbol(
            first_existing(row, ("申购代码",), "")
        )
        if symbol is None or subscription_code is None or not name:
            continue
        items.append(IpoSubscriptionItem(
            symbol=symbol,
            name=name,
            subscriptionCode=subscription_code,
            exchange=str(first_existing(row, ("交易所",), "未知")).strip(),
            board=str(first_existing(row, ("板块",), "未知")).strip(),
            issueTotalWanShares=parse_optional_float(
                first_existing(row, ("发行总数",), None)
            ),
            onlineIssueShares=parse_optional_int(
                first_existing(row, ("网上发行",), None)
            ),
            marketValueRequirementWan=parse_optional_float(
                first_existing(row, ("顶格申购需配市值",), None)
            ),
            maxSubscriptionShares=parse_optional_int(
                first_existing(row, ("申购上限",), None)
            ),
            issuePrice=parse_optional_float(
                first_existing(row, ("发行价格",), None)
            ),
            latestPrice=parse_optional_float(
                first_existing(row, ("最新价",), None)
            ),
            subscriptionDate=normalize_date_only(
                first_existing(row, ("申购日期",), None)
            ),
            ballotDate=normalize_date_only(
                first_existing(row, ("中签号公布日",), None)
            ),
            paymentDate=normalize_date_only(
                first_existing(row, ("中签缴款日期",), None)
            ),
            listingDate=normalize_date_only(
                first_existing(row, ("上市日期",), None)
            ),
            issuePe=parse_optional_float(
                first_existing(row, ("发行市盈率",), None)
            ),
            industryPe=parse_optional_float(
                first_existing(row, ("行业市盈率",), None)
            ),
            winningRate=parse_optional_float(
                first_existing(row, ("中签率",), None)
            ),
            firstDayChangePercent=parse_optional_float(
                first_existing(row, ("涨幅",), None)
            ),
        ))

    return items


def normalize_global_market_dataframe(df, provider_name: str, limit: int) -> list[GlobalMarketQuote]:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    markets: list[GlobalMarketQuote] = []

    for _, row in df.iterrows():
        raw_name = str(first_existing(row, ("名称", "指数名称", "name"), "")).strip()
        raw_symbol = str(first_existing(row, ("代码", "symbol"), raw_name)).strip()
        alias = GLOBAL_MARKET_ALIASES.get(raw_name)
        symbol, name, region = alias if alias else (raw_symbol or raw_name, raw_name or raw_symbol, "GLOBAL")
        price = parse_float(first_existing(row, ("最新价", "最新", "price", "收盘"), 0))
        change_pct = parse_float(first_existing(row, ("涨跌幅", "涨幅", "changePercent"), 0))
        if not name or price <= 0:
            continue
        markets.append(GlobalMarketQuote(
            symbol=symbol,
            name=name,
            region=region,
            price=price,
            changePercent=change_pct,
            updatedAt=fetched_at,
            source=provider_name,
        ))
        if len(markets) >= limit:
            break

    return markets


def normalize_futures_quote_dataframe(
    df,
    requested_symbols: list[str],
    provider_name: str,
    limit: int,
) -> list[FuturesQuote]:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    items: list[FuturesQuote] = []

    for row_index, (_, row) in enumerate(df.iterrows()):
        contract = str(first_existing(row, ("contract", "代码"), "")).strip().upper()
        if contract not in FUTURES_WATCHLIST:
            contract = requested_symbols[row_index] if row_index < len(requested_symbols) else ""
        metadata = FUTURES_WATCHLIST.get(contract)
        if metadata is None:
            continue

        price = parse_float(first_existing(
            row,
            ("current_price", "最新价", "price", "收盘价"),
            0,
        ))
        previous_settlement = parse_float(first_existing(
            row,
            ("last_settle_price", "昨结算", "previousSettlement", "last_close"),
            0,
        ))
        if price <= 0:
            continue
        change_percent = parse_optional_float(first_existing(
            row,
            ("change_percent", "涨跌幅", "changePercent"),
            None,
        ))
        if change_percent is None:
            change_percent = (
                (price / previous_settlement - 1) * 100
                if previous_settlement > 0
                else 0
            )

        name, category = metadata
        items.append(FuturesQuote(
            symbol=contract,
            name=name,
            category=category,
            price=price,
            previousSettlement=previous_settlement,
            changePercent=change_percent,
            volume=max(0, int(parse_float(first_existing(row, ("volume", "成交量"), 0)))),
            openInterest=max(0, int(parse_float(first_existing(row, ("hold", "持仓量"), 0)))),
            updatedAt=fetched_at,
            source=provider_name,
            quoteTime=str(first_existing(row, ("time", "时间"), "")).strip() or None,
            open=parse_optional_float(first_existing(row, ("open", "开盘", "开盘价"), None)),
            high=parse_optional_float(first_existing(row, ("high", "最高", "最高价"), None)),
            low=parse_optional_float(first_existing(row, ("low", "最低", "最低价"), None)),
            bidPrice=parse_optional_float(first_existing(row, ("bid_price", "买价"), None)),
            askPrice=parse_optional_float(first_existing(row, ("ask_price", "卖价"), None)),
            averagePrice=parse_optional_float(first_existing(row, ("avg_price", "均价"), None)),
        ))
        if len(items) >= limit:
            break

    return items


def normalize_hk_quote_dataframe(
    df,
    provider_name: str,
    limit: int,
) -> list[HongKongQuote]:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    items: list[HongKongQuote] = []
    for _, row in df.iterrows():
        raw_symbol = str(first_existing(row, ("代码", "symbol"), "")).strip()
        match = re.search(r"(\d{5})$", raw_symbol)
        symbol = match.group(1) if match else ""
        name = str(first_existing(row, ("中文名称", "名称", "name"), "")).strip()
        price = parse_float(first_existing(
            row,
            ("最新价", "price", "收盘", "lasttrade"),
            0,
        ))
        previous_close = parse_float(first_existing(
            row,
            ("昨收", "previousClose", "prevclose"),
            0,
        ))
        if not symbol or not name or price <= 0:
            continue
        change_percent = parse_optional_float(
            first_existing(row, ("涨跌幅", "changePercent", "changepercent"), None)
        )
        if change_percent is None:
            change_percent = (
                (price / previous_close - 1) * 100
                if previous_close > 0
                else 0
            )
        items.append(HongKongQuote(
            symbol=symbol,
            name=name,
            price=price,
            previousClose=previous_close,
            changePercent=change_percent,
            volume=max(0, int(parse_float(first_existing(row, ("成交量", "volume"), 0)))),
            amount=parse_optional_float(first_existing(row, ("成交额", "amount"), None)),
            open=parse_optional_float(first_existing(row, ("今开", "开盘", "open"), None)),
            high=parse_optional_float(first_existing(row, ("最高", "high"), None)),
            low=parse_optional_float(first_existing(row, ("最低", "low"), None)),
            updatedAt=fetched_at,
            source=provider_name,
        ))

    items.sort(
        key=lambda item: item.amount if item.amount is not None else item.price * item.volume,
        reverse=True,
    )
    return items[:limit]


def normalize_sector_snapshot_dataframes(
    sector_df,
    flow_df,
    limit: int,
) -> list[SectorSnapshot]:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    flow_by_name: dict[str, float] = {}

    if flow_df is not None:
        for _, row in flow_df.iterrows():
            name = str(first_existing(row, ("名称", "板块名称"), "")).strip()
            net_flow = parse_optional_float(first_existing(
                row,
                (
                    "今日主力净流入-净额",
                    "主力净流入-净额",
                    "今日主力净流入净额",
                    "主力净流入净额",
                ),
                None,
            ))
            if name and net_flow is not None:
                flow_by_name[name] = net_flow

    sectors: list[SectorSnapshot] = []
    for _, row in sector_df.iterrows():
        is_ths_summary = first_existing(row, ("板块",), None) is not None
        name = str(first_existing(row, ("板块名称", "名称", "板块"), "")).strip()
        symbol = str(first_existing(row, ("板块代码", "代码"), name)).strip()
        price = parse_float(first_existing(row, ("最新价", "最新", "收盘", "均价"), 0))
        if not name or price <= 0:
            continue

        leader_name = first_existing(row, ("领涨股票", "领涨股"), None)
        amount = parse_optional_float(first_existing(row, ("成交额", "总成交额"), None))
        row_flow = parse_optional_float(first_existing(row, ("净流入",), None))
        if is_ths_summary:
            amount = amount * 100_000_000 if amount is not None else None
            row_flow = row_flow * 100_000_000 if row_flow is not None else None
        sectors.append(SectorSnapshot(
            symbol=symbol or name,
            name=name,
            price=price,
            changePercent=parse_float(first_existing(row, ("涨跌幅", "涨幅"), 0)),
            updatedAt=fetched_at,
            amount=amount,
            turnover=parse_optional_float(first_existing(row, ("换手率",), None)),
            advancers=parse_optional_int(first_existing(row, ("上涨家数",), None)),
            decliners=parse_optional_int(first_existing(row, ("下跌家数",), None)),
            leaderName=str(leader_name).strip() if leader_name else None,
            leaderChangePercent=parse_optional_float(first_existing(
                row,
                ("领涨股票-涨跌幅", "领涨股-涨跌幅"),
                None,
            )),
            mainNetInflow=flow_by_name.get(name, row_flow),
        ))
        if len(sectors) >= limit:
            break

    return sectors


def normalize_history_dataframe(
    df,
    symbol: str,
    name: str,
    source: str,
    adjustment: str,
    limit: int,
) -> HistoricalSeries:
    bars: list[HistoricalBar] = []
    for _, row in df.iterrows():
        date = str(first_existing(row, ("日期", "date", "时间"), "")).strip()[:10]
        open_price = parse_float(first_existing(row, ("开盘", "开盘价", "open"), 0))
        high = parse_float(first_existing(row, ("最高", "最高价", "high"), 0))
        low = parse_float(first_existing(row, ("最低", "最低价", "low"), 0))
        close = parse_float(first_existing(row, ("收盘", "收盘价", "close"), 0))
        if not date or min(open_price, high, low, close) <= 0:
            continue

        bars.append(HistoricalBar(
            date=date,
            open=open_price,
            high=high,
            low=low,
            close=close,
            volume=max(0, parse_float(first_existing(row, ("成交量", "volume", "amount"), 0))),
            amount=parse_optional_float(first_existing(row, ("成交额", "amount"), None)),
            changePercent=parse_optional_float(first_existing(row, ("涨跌幅",), None)),
            turnover=parse_optional_float(first_existing(row, ("换手率",), None)),
        ))

    bars.sort(key=lambda bar: bar.date)
    return HistoricalSeries(
        symbol=symbol,
        name=name,
        source=source,
        adjustment=adjustment,
        bars=bars[-limit:],
    )


def normalize_a_share_symbol(value: object) -> str | None:
    """Normalize AkShare symbols like sh600519, sz000001, bj920000 to 6 digits."""
    raw = str(value).strip().lower()
    match = re.search(r"(\d{6})$", raw)
    if match is None:
        return None
    return match.group(1)


def normalize_index_symbol(value: object) -> str | None:
    """Normalize index symbols and namespace them to avoid stock-code collisions."""
    raw = str(value).strip().upper()
    match = re.search(r"(\d{6})", raw)
    if match is None:
        return None
    code = match.group(1)
    if raw.startswith("SH") or raw.endswith(".SH"):
        return f"SH{code}"
    if raw.startswith("SZ") or raw.endswith(".SZ"):
        return f"SZ{code}"
    return INDEX_SYMBOL_MAP.get(code, code)


# ── 应用生命周期 ──────────────────────────────────────────

cache = QuoteCache(ttl_sec=CACHE_TTL_SEC)
index_cache = IndexCache(ttl_sec=CACHE_TTL_SEC)
research_cache: dict[str, tuple[float, BaseModel]] = {}
history_cache: ResearchHistoryCache[HistoricalSeries] = ResearchHistoryCache()


def get_cached_research(key: str):
    cached = research_cache.get(key)
    if cached is None:
        return None
    cached_at, value = cached
    if time.time() - cached_at >= RESEARCH_CACHE_TTL_SEC:
        research_cache.pop(key, None)
        return None
    return value


def set_cached_research(key: str, value: BaseModel):
    research_cache[key] = (time.time(), value)
    return value


def parse_query_values(value: str) -> list[str]:
    return list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))


def history_date_range(days: int) -> tuple[str, str]:
    end = datetime.now().date()
    start = end - timedelta(days=days * 2 + 30)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


async def build_history_response(
    identifiers: list[str],
    days: int,
    source: str,
    adjustment: str,
    fetcher,
    market: str | None = None,
) -> HistoricalBarsResponse:
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    start_date, end_date = history_date_range(days)
    loop = asyncio.get_running_loop()
    request_semaphore = asyncio.Semaphore(2)

    async def fetch_one(identifier: str) -> HistoricalSeries:
        async def fetch_and_normalize() -> HistoricalSeries:
            async with request_semaphore:
                result = await loop.run_in_executor(
                    None,
                    fetcher,
                    identifier,
                    start_date,
                    end_date,
                )
            dataframe = result
            item_source = source
            if isinstance(result, tuple) and len(result) == 2:
                dataframe, item_source = result
            normalized = normalize_history_dataframe(
                dataframe,
                symbol=identifier,
                name=identifier,
                source=str(item_source),
                adjustment=adjustment,
                limit=days,
            )
            if not normalized.bars:
                raise RuntimeError("无有效日线")
            return normalized

        if market is None:
            return await fetch_and_normalize()
        key = HistoryCacheKey(
            market=market,
            symbol=identifier,
            adjustment=adjustment,
            end_date=end_date,
            days=days,
            source=source,
        )
        return await history_cache.get_or_fetch(
            key,
            fetch_and_normalize,
            fresh_ttl_sec=RESEARCH_CACHE_TTL_SEC,
            stale_ttl_sec=RESEARCH_CACHE_STALE_TTL_SEC,
        )

    results = await asyncio.gather(*[
        fetch_one(identifier)
        for identifier in identifiers
    ], return_exceptions=True)

    series: list[HistoricalSeries] = []
    errors: list[str] = []
    actual_sources: list[str] = []
    for identifier, result in zip(identifiers, results):
        if isinstance(result, BaseException):
            errors.append(f"{identifier}: {result}")
            continue
        series.append(result)
        actual_sources.append(result.source)

    warning = None
    if errors:
        warning = "部分历史数据暂不可用: " + "; ".join(errors[:8])
    return HistoricalBarsResponse(
        provider="akshare",
        source="+".join(dict.fromkeys(actual_sources)) if actual_sources else source,
        fetchedAt=fetched_at,
        series=series,
        warning=warning,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时预热缓存。"""
    logger.info("AkShare 行情桥接服务启动，预热行情缓存...")
    try:
        await cache.refresh()
        logger.info("初始行情加载完成，共 %d 只标的", cache.count)
    except Exception as e:
        logger.error("初始行情加载失败: %s", e)
    try:
        await index_cache.refresh()
        logger.info("初始指数行情加载完成，共 %d 个指数", index_cache.count)
    except Exception as e:
        logger.error("初始指数行情加载失败: %s", e)
    yield
    logger.info("服务关闭")


app = FastAPI(
    title="AkShare Market Data Bridge",
    description="为 AI量化系统提供 A 股实时行情数据的 HTTP API 桥梁",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Authorization"],
)


# ── 认证中间件 ────────────────────────────────────────────

@app.middleware("http")
async def auth_middleware(request, call_next):
    public_paths = {"/health", "/api/health", "/docs", "/openapi.json"}
    if AUTH_TOKEN and request.url.path not in public_paths:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {AUTH_TOKEN}":
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"error": "Unauthorized", "message": "无效的认证令牌"},
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


# ── API 端点 ──────────────────────────────────────────────

@app.get("/health")
@app.get("/api/health")
async def health():
    """健康检查。"""
    cache_age = cache.age_sec
    index_cache_age = index_cache.age_sec
    return {
        "status": "ok",
        "service": "akshare-market-bridge",
        "cachedSymbols": cache.count,
        "cachedIndices": index_cache.count,
        "cacheAgeSec": None
        if cache_age == float("inf")
        else round(cache_age, 1),
        "indexCacheAgeSec": None
        if index_cache_age == float("inf")
        else round(index_cache_age, 1),
        "lastStockError": cache.last_error,
        "lastIndexError": index_cache.last_error,
        "proxyDisabled": DISABLE_PROXY,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.get("/api/market/quotes", response_model=QuotesResponse)
async def get_quotes(
    symbols: str = Query(
        ...,
        description="逗号分隔的股票代码，如 600519,000001,300750",
    ),
):
    """
    获取指定标的的实时行情。

    对应 TypeScript 端 HttpMarketProvider 的预期响应格式。
    """
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")

    if len(symbol_list) > 100:
        raise HTTPException(status_code=400, detail="单次最多查询 100 只标的")

    try:
        quotes = await cache.get_quotes(symbol_list)
    except Exception as e:
        logger.error("获取行情失败: %s", e)
        raise HTTPException(status_code=502, detail=f"行情数据获取失败: {e}")

    return QuotesResponse(quotes=quotes)


@app.get("/api/market/indices", response_model=QuotesResponse)
async def get_indices(
    symbols: str = Query(
        "SH000001,SZ399001,SZ399006,SH000300",
        description="逗号分隔的指数代码，如 SH000001,SZ399001,SZ399006,SH000300",
    ),
):
    """获取主要 A 股指数实时行情，和个股行情接口分开，避免代码冲突。"""
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")

    if len(symbol_list) > 50:
        raise HTTPException(status_code=400, detail="单次最多查询 50 个指数")

    try:
        quotes = await index_cache.get_indices(symbol_list)
    except Exception as e:
        logger.error("获取指数行情失败: %s", e)
        raise HTTPException(status_code=502, detail=f"指数行情数据获取失败: {e}")

    return QuotesResponse(quotes=quotes)


@app.get("/api/market/stock-search", response_model=StockSearchResponse)
async def search_stocks(
    query: str = Query(..., min_length=1, max_length=40),
    limit: int = Query(8, ge=1, le=20),
):
    """Search the bounded in-memory A-share quote cache by code or name."""
    normalized_query = query.strip()
    if not normalized_query:
        raise HTTPException(status_code=400, detail="query 参数不能为空")

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        items = await cache.search(normalized_query, limit)
    except Exception as exc:
        logger.error("股票搜索失败: %s", exc)
        return StockSearchResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            items=[],
            warning=f"股票名称与代码搜索暂不可用: {exc}",
        )

    return StockSearchResponse(
        provider="akshare",
        source="a-share-spot-cache",
        fetchedAt=fetched_at,
        items=items,
    )


@app.get("/api/market/hk/quotes", response_model=HongKongQuotesResponse)
async def get_hk_quotes(
    limit: int = Query(20, ge=1, le=50, description="返回港股快照数量上限"),
):
    """获取按成交额排序的真实港股只读快照。"""
    cache_key = f"hk-quotes:{limit}"
    cached = get_cached_research(cache_key)
    if cached is not None:
        return cached

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        loop = asyncio.get_running_loop()
        dataframe, source = await loop.run_in_executor(None, fetch_hk_spot_dataframe)
        response = HongKongQuotesResponse(
            provider="akshare",
            source=source,
            fetchedAt=fetched_at,
            items=normalize_hk_quote_dataframe(dataframe, source, limit),
        )
        return set_cached_research(cache_key, response) if response.items else response
    except Exception as exc:
        logger.error("获取港股行情失败: %s", exc)
        return HongKongQuotesResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            items=[],
            warning=f"港股行情源暂不可用: {exc}",
        )


@app.get("/api/market/hk/history", response_model=HistoricalBarsResponse)
async def get_hk_history(
    symbols: str = Query(..., description="逗号分隔的 5 位港股代码"),
    days: int = Query(180, ge=60, le=500, description="交易日数量上限"),
):
    """获取真实港股前复权日线，仅用于跨市场研究。"""
    symbol_list = parse_query_values(symbols)
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")
    if len(symbol_list) > 12:
        raise HTTPException(status_code=400, detail="单次最多查询 12 只港股")
    if any(re.fullmatch(r"\d{5}", symbol) is None for symbol in symbol_list):
        raise HTTPException(status_code=400, detail="symbols 必须是 5 位港股代码")

    response = await build_history_response(
        identifiers=symbol_list,
        days=days,
        source="eastmoney-hk-history",
        adjustment="qfq",
        fetcher=fetch_hk_history_dataframe,
        market="hong-kong",
    )
    return response


@app.get("/api/market/futures/quotes", response_model=FuturesQuotesResponse)
async def get_futures_quotes(
    limit: int = Query(16, ge=1, le=16, description="受控国内主连观察数量上限"),
):
    """获取受控国内期货主连真实快照，不读取期货账户。"""
    symbols = list(FUTURES_WATCHLIST)[:limit]
    cache_key = f"futures-quotes:{','.join(symbols)}"
    cached = get_cached_research(cache_key)
    if cached is not None:
        return cached

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        loop = asyncio.get_running_loop()
        dataframe, source = await loop.run_in_executor(
            None,
            fetch_futures_spot_dataframe,
            symbols,
        )
        response = FuturesQuotesResponse(
            provider="akshare",
            source=source,
            fetchedAt=fetched_at,
            items=normalize_futures_quote_dataframe(
                dataframe,
                symbols,
                source,
                limit,
            ),
        )
        if len(response.items) < len(symbols):
            response.warning = (
                f"请求 {len(symbols)} 个主连，仅取得 {len(response.items)} 个有效真实快照。"
            )
        return set_cached_research(cache_key, response) if response.items else response
    except Exception as exc:
        logger.error("获取国内期货主连行情失败: %s", exc)
        return FuturesQuotesResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            items=[],
            warning=f"期货行情源暂不可用: {exc}",
        )


@app.get("/api/market/futures/history", response_model=HistoricalBarsResponse)
async def get_futures_history(
    symbols: str = Query(..., description="逗号分隔的受控国内期货主连代码"),
    days: int = Query(180, ge=60, le=500, description="交易日数量上限"),
):
    """获取受控国内期货主连连续日线，不代表可交易具体合约。"""
    symbol_list = [symbol.upper() for symbol in parse_query_values(symbols)]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")
    if len(symbol_list) > 12:
        raise HTTPException(status_code=400, detail="单次最多查询 12 个期货主连")
    if any(symbol not in FUTURES_WATCHLIST for symbol in symbol_list):
        raise HTTPException(status_code=400, detail="symbols 必须来自受控主连观察池")

    response = await build_history_response(
        identifiers=symbol_list,
        days=days,
        source="sina-domestic-main-continuous",
        adjustment="continuous-main",
        fetcher=fetch_futures_history_dataframe,
        market="futures",
    )
    for series in response.series:
        series.name = FUTURES_WATCHLIST[series.symbol][0]
    return response


@app.get("/api/market/sectors", response_model=SectorSnapshotResponse)
async def get_sectors(
    limit: int = Query(20, ge=1, le=100, description="返回行业板块数量上限"),
):
    """获取真实行业板块快照，并尽力合并当日主力净流入。"""
    cache_key = f"sectors:{limit}"
    cached = get_cached_research(cache_key)
    if cached is not None:
        return cached

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    loop = asyncio.get_running_loop()
    try:
        sector_result = await loop.run_in_executor(None, fetch_sector_snapshot_dataframe)
    except Exception as e:
        logger.error("获取行业板块失败: %s", e)
        return SectorSnapshotResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            sectors=[],
            warning=f"行业板块源暂不可用: {e}",
        )

    sector_df = sector_result
    sector_source = "eastmoney-industry-board"
    if isinstance(sector_result, tuple) and len(sector_result) == 2:
        sector_df, sector_source = sector_result

    flow_df = None
    warning = None
    source = str(sector_source)
    if sector_source == "eastmoney-industry-board":
        try:
            flow_df = await loop.run_in_executor(None, fetch_sector_fund_flow_dataframe)
            source += "+eastmoney-sector-fund-flow"
        except Exception as e:
            warning = f"行业资金流暂不可用，板块涨跌仍为真实数据: {e}"
            logger.warning("获取行业资金流失败: %s", e)

    response = SectorSnapshotResponse(
        provider="akshare",
        source=source,
        fetchedAt=fetched_at,
        sectors=normalize_sector_snapshot_dataframes(sector_df, flow_df, limit),
        warning=warning,
    )
    return set_cached_research(cache_key, response)


@app.get("/api/market/sector-history", response_model=HistoricalBarsResponse)
async def get_sector_history(
    sectors: str = Query(..., description="逗号分隔的行业板块名称"),
    days: int = Query(180, ge=60, le=500, description="交易日数量上限"),
):
    """按行业板块名称获取真实、未复权日线。"""
    sector_list = parse_query_values(sectors)
    if not sector_list:
        raise HTTPException(status_code=400, detail="sectors 参数不能为空")
    if len(sector_list) > 20:
        raise HTTPException(status_code=400, detail="单次最多查询 20 个行业板块")
    if any(len(sector) > 40 for sector in sector_list):
        raise HTTPException(status_code=400, detail="行业板块名称过长")

    cache_key = f"sector-history:{days}:{','.join(sector_list)}"
    cached = get_cached_research(cache_key)
    if cached is not None:
        return cached
    response = await build_history_response(
        identifiers=sector_list,
        days=days,
        source="eastmoney-industry-history",
        adjustment="none",
        fetcher=fetch_sector_history_dataframe,
    )
    return set_cached_research(cache_key, response) if response.series else response


@app.get("/api/market/stock-history", response_model=HistoricalBarsResponse)
async def get_stock_history(
    symbols: str = Query(..., description="逗号分隔的 6 位 A 股代码"),
    days: int = Query(180, ge=60, le=500, description="交易日数量上限"),
):
    """获取真实 A 股前复权日线，仅用于研究。"""
    symbol_list = parse_query_values(symbols)
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")
    if len(symbol_list) > 12:
        raise HTTPException(status_code=400, detail="单次最多查询 12 只股票")
    if any(re.fullmatch(r"\d{6}", symbol) is None for symbol in symbol_list):
        raise HTTPException(status_code=400, detail="symbols 必须是 6 位 A 股代码")

    response = await build_history_response(
        identifiers=symbol_list,
        days=days,
        source="eastmoney-stock-history",
        adjustment="qfq",
        fetcher=fetch_stock_history_dataframe,
        market="a-share",
    )
    return response


@app.get("/api/research/news", response_model=NewsResponse)
async def get_research_news(
    limit: int = Query(20, ge=1, le=80, description="返回新闻数量上限"),
):
    """获取真实只读财经新闻，保留来源和抓取时间。"""
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        loop = asyncio.get_running_loop()
        df, provider_name = await loop.run_in_executor(None, fetch_financial_news_dataframe)
        return NewsResponse(
            provider="akshare",
            source=provider_name,
            fetchedAt=fetched_at,
            items=normalize_news_dataframe(df, provider_name, limit),
        )
    except Exception as e:
        logger.error("获取财经新闻失败: %s", e)
        return NewsResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            items=[],
            warning=f"真实新闻源暂不可用: {e}",
        )


@app.get("/api/research/ipo-subscriptions", response_model=IpoSubscriptionsResponse)
async def get_ipo_subscriptions(
    limit: int = Query(80, ge=1, le=200, description="返回新股申购与上市记录上限"),
):
    """获取真实只读新股申购与上市数据，不包含账户或申购能力。"""
    cache_key = f"ipo-subscriptions:{limit}"
    cached = get_cached_research(cache_key)
    if cached is not None:
        return cached

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        loop = asyncio.get_running_loop()
        df, provider_name = await loop.run_in_executor(
            None,
            fetch_ipo_subscriptions_dataframe,
        )
        response = IpoSubscriptionsResponse(
            provider="akshare",
            source=provider_name,
            fetchedAt=fetched_at,
            items=normalize_ipo_subscriptions_dataframe(df, limit),
        )
        return set_cached_research(cache_key, response) if response.items else response
    except Exception as e:
        logger.error("获取新股申购数据失败: %s", e)
        return IpoSubscriptionsResponse(
            provider="akshare",
            source="unavailable",
            fetchedAt=fetched_at,
            items=[],
            warning=f"新股申购源暂不可用: {e}",
        )


@app.get("/api/market/global", response_model=GlobalMarketsResponse)
async def get_global_markets(
    limit: int = Query(12, ge=1, le=40, description="返回全球指数数量上限"),
):
    """获取全球主要指数行情，用于只读跨市场影响研究。"""
    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        loop = asyncio.get_running_loop()
        df, provider_name = await loop.run_in_executor(None, fetch_global_market_dataframe)
        return GlobalMarketsResponse(
            provider="akshare",
            fetchedAt=fetched_at,
            markets=normalize_global_market_dataframe(df, provider_name, limit),
        )
    except Exception as e:
        logger.error("获取全球市场失败: %s", e)
        return GlobalMarketsResponse(
            provider="akshare",
            fetchedAt=fetched_at,
            markets=[],
            warning=f"全球市场源暂不可用: {e}",
        )


# ── 入口 ──────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logger.info("启动 AkShare 行情桥接服务 http://%s:%s", HOST, PORT)
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
