"""
AkShare 行情桥接微服务
======================
将 AkShare Python 库的 A 股行情能力通过 HTTP API 暴露，
供 TypeScript 后端的 HttpMarketProvider 消费。

安全约束：
- 仅读取公开行情数据，不执行任何交易操作
- 不持有券商凭证或交易 Token
- 可独立部署、独立限流
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import akshare as ak
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 日志配置 ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [AkShareBridge] %(levelname)s %(message)s",
)
logger = logging.getLogger("akshare-bridge")

# ── 数据模型 ──────────────────────────────────────────────

class MarketQuote(BaseModel):
    symbol: str
    name: str
    tradable: bool
    price: float
    previousClose: float
    changePercent: float
    volume: float
    updatedAt: str

class QuotesResponse(BaseModel):
    quotes: list[MarketQuote]

class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    symbols_count: int

# ── FastAPI 应用 ──────────────────────────────────────────

app = FastAPI(
    title="AkShare Market Bridge",
    description="A股行情桥接微服务 — 通过 AkShare 获取实时行情",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── 资金状态 ──────────────────────────────────────────────

start_time = time.time()

# 行情缓存（简单内存缓存，生产环境可用 Redis）
_cache: dict[str, MarketQuote] = {}
_cache_ttl_seconds = 5  # 缓存有效期（秒）
_cache_timestamps: dict[str, float] = {}

# 默认监控列表
DEFAULT_SYMBOLS = [
    "600519",  # 贵州茅台
    "000858",  # 五粮液
    "300750",  # 宁德时代
    "601318",  # 中国平安
    "000001",  # 平安银行
    "600036",  # 招商银行
    "002594",  # 比亚迪
    "688981",  # 中芯国际
]

DEFAULT_INDICES = [
    "000001",  # 上证指数
    "399001",  # 深证成指
    "399006",  # 创业板指
]

ALL_SYMBOLS = DEFAULT_SYMBOLS + DEFAULT_INDICES

# ── 核心行情获取 ──────────────────────────────────────────

def _fetch_akshare_realtime(symbols: list[str]) -> dict[str, dict]:
    """
    通过 AkShare 获取 A 股实时行情。
    
    AkShare 的 stock_zh_a_spot_em() 返回全市场行情 DataFrame，
    我们按需过滤。
    """
    try:
        # 获取全市场实时行情（东方财富源）
        df = ak.stock_zh_a_spot_em()
        
        result: dict[str, dict] = {}
        now = datetime.now(timezone.utc).isoformat()
        
        for code in symbols:
            # AkShare 代码格式如 "600519"，与我们的 symbol 一致
            row = df[df["代码"] == code]
            if row.empty:
                logger.warning(f"未找到标的: {code}")
                continue
            
            row = row.iloc[0]
            price = float(row["最新价"]) if pd.notna(row["最新价"]) else 0.0
            prev_close = float(row["昨收"]) if pd.notna(row["昨收"]) else 0.0
            
            # 计算涨跌幅
            if prev_close > 0:
                change_pct = round((price - prev_close) / prev_close * 100, 2)
            else:
                change_pct = 0.0
            
            name = str(row.get("名称", code))
            volume = float(row["成交量"]) if pd.notna(row.get("成交量")) else 0.0
            
            result[code] = {
                "symbol": code,
                "name": name,
                "tradable": code in DEFAULT_SYMBOLS,
                "price": price,
                "previousClose": prev_close,
                "changePercent": change_pct,
                "volume": volume,
                "updatedAt": now,
            }
        
        logger.info(f"获取到 {len(result)}/{len(symbols)} 个标的行情")
        return result
        
    except Exception as e:
        logger.error(f"AkShare 行情获取失败: {e}")
        raise


def _get_cached_or_fetch(symbols: list[str]) -> dict[str, dict]:
    """带缓存的行情获取 —— 有效期内直接返回缓存。"""
    now = time.time()
    result: dict[str, dict] = {}
    need_fetch: list[str] = []
    
    for sym in symbols:
        ts = _cache_timestamps.get(sym, 0)
        if now - ts < _cache_ttl_seconds and sym in _cache:
            q = _cache[sym]
            result[sym] = q.model_dump()
        else:
            need_fetch.append(sym)
    
    if need_fetch:
        try:
            fetched = _fetch_akshare_realtime(need_fetch)
            for sym, data in fetched.items():
                quote = MarketQuote(**data)
                _cache[sym] = quote
                _cache_timestamps[sym] = now
                result[sym] = data
        except Exception:
            # 获取失败时，部分返回已有缓存 + 占位数据
            for sym in need_fetch:
                if sym not in result:
                    if sym in _cache:
                        result[sym] = _cache[sym].model_dump()
                    else:
                        result[sym] = _make_placeholder(sym)
    
    return result


def _make_placeholder(symbol: str) -> dict:
    """生成占位行情数据（网络失败时的 fallback）。"""
    return {
        "symbol": symbol,
        "name": symbol,
        "tradable": symbol in DEFAULT_SYMBOLS,
        "price": 0.0,
        "previousClose": 0.0,
        "changePercent": 0.0,
        "volume": 0.0,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


# ── 预加载 pandas ─────────────────────────────────────────
import pandas as pd  # noqa: E402 — AkShare 依赖 pandas

# ── API 端点 ──────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse)
async def health():
    """健康检查。"""
    return HealthResponse(
        status="ok",
        version="0.1.0",
        uptime_seconds=round(time.time() - start_time, 1),
        symbols_count=len(ALL_SYMBOLS),
    )


@app.get("/api/market/quotes", response_model=QuotesResponse)
async def get_quotes(
    symbols: str = Query(
        default=",".join(DEFAULT_SYMBOLS),
        description="逗号分隔的股票代码列表，如 600519,000858",
    ),
):
    """获取实时行情报价（使用缓存减少 API 调用）。"""
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    
    if not symbol_list:
        raise HTTPException(status_code=400, detail="symbols 参数不能为空")
    
    if len(symbol_list) > 50:
        raise HTTPException(status_code=400, detail="单次最多查询 50 个标的")
    
    try:
        quotes_data = _get_cached_or_fetch(symbol_list)
        quotes = [
            MarketQuote(**quotes_data[sym])
            for sym in symbol_list
            if sym in quotes_data
        ]
        return QuotesResponse(quotes=quotes)
    except Exception as e:
        logger.exception(f"行情查询异常: {e}")
        # 返回空数组而非 500，让消费端优雅降级
        return QuotesResponse(quotes=[])


@app.get("/api/market/symbols")
async def list_symbols():
    """返回当前监控的股票和指数代码列表。"""
    return {
        "stocks": DEFAULT_SYMBOLS,
        "indices": DEFAULT_INDICES,
        "total": len(ALL_SYMBOLS),
    }


# ── 启动入口 ──────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8800,
        reload=False,
        log_level="info",
    )
