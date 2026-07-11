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
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 配置 ──────────────────────────────────────────────────

HOST = os.getenv("AKSHARE_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("AKSHARE_BRIDGE_PORT", "8800"))
CACHE_TTL_SEC = float(os.getenv("AKSHARE_BRIDGE_CACHE_TTL", "3.0"))
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


INDEX_SYMBOL_MAP = {
    "000001": "SH000001",  # 上证指数
    "399001": "SZ399001",  # 深证成指
    "399006": "SZ399006",  # 创业板指
    "000300": "SH000300",  # 沪深300
}


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
