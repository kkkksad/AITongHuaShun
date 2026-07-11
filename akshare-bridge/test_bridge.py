"""
AkShare 桥接微服务单元测试
运行: python -m pytest test_bridge.py -v
或:   python test_bridge.py
"""

import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Mock akshare before importing main
sys.modules["akshare"] = MagicMock()

from main import (
    app,
    QuotesResponse,
    MarketQuote,
    QuoteCache,
    fetch_a_share_spot_dataframe,
    normalize_a_share_symbol,
)

client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "akshare-market-bridge"
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_api_health_alias_returns_same_service(self):
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["service"] == "akshare-market-bridge"

    def test_health_remains_public_when_token_is_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/health")
        assert response.status_code == 200


class TestQuotesEndpoint:
    def test_quotes_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/quotes?symbols=600519")
        assert response.status_code == 401

    def test_missing_symbols_returns_400(self):
        response = client.get("/api/market/quotes")
        assert response.status_code == 422  # FastAPI validation

    def test_empty_symbols_returns_400(self):
        response = client.get("/api/market/quotes?symbols=")
        assert response.status_code == 400
        assert "不能为空" in response.json()["detail"]

    def test_too_many_symbols_returns_400(self):
        symbols = ",".join([f"{i:06d}" for i in range(101)])
        response = client.get(f"/api/market/quotes?symbols={symbols}")
        assert response.status_code == 400
        assert "100" in response.json()["detail"]


class TestQuoteCache:
    def test_cache_starts_empty(self):
        cache = QuoteCache(ttl_sec=3.0)
        assert cache.count == 0
        assert cache.age_sec == float("inf")

    def test_fetch_falls_back_when_eastmoney_source_fails(self):
        fallback_df = MagicMock()
        fallback_df.__len__.return_value = 1
        with patch("main.ak.stock_zh_a_spot_em", side_effect=RuntimeError("blocked")):
            with patch("main.ak.stock_zh_a_spot", return_value=fallback_df):
                assert fetch_a_share_spot_dataframe() is fallback_df

    def test_fetch_raises_last_error_when_all_sources_fail(self):
        with patch("main.ak.stock_zh_a_spot_em", side_effect=RuntimeError("blocked")):
            with patch("main.ak.stock_zh_a_spot", side_effect=RuntimeError("offline")):
                with pytest.raises(RuntimeError, match="offline"):
                    fetch_a_share_spot_dataframe()

    def test_symbol_normalization_accepts_market_prefixes(self):
        assert normalize_a_share_symbol("sh600519") == "600519"
        assert normalize_a_share_symbol("sz000001") == "000001"
        assert normalize_a_share_symbol("bj920000") == "920000"
        assert normalize_a_share_symbol("600036") == "600036"
        assert normalize_a_share_symbol("not-a-symbol") is None


class TestMarketQuoteModel:
    def test_model_serialization(self):
        quote = MarketQuote(
            symbol="600519",
            name="贵州茅台",
            tradable=True,
            price=1492.60,
            previousClose=1486.80,
            changePercent=0.39,
            volume=12345678,
            updatedAt="2026-07-11T03:00:00.000Z",
        )
        data = quote.model_dump()
        assert data["symbol"] == "600519"
        assert data["price"] == 1492.60
        assert data["tradable"] is True

    def test_quotes_response_serialization(self):
        quotes = [
            MarketQuote(
                symbol="600519", name="茅台", tradable=True,
                price=1500.0, previousClose=1490.0,
                changePercent=0.67, volume=10000000,
                updatedAt="2026-07-11T00:00:00.000Z",
            ),
            MarketQuote(
                symbol="000001", name="平安银行", tradable=True,
                price=12.5, previousClose=12.3,
                changePercent=1.63, volume=50000000,
                updatedAt="2026-07-11T00:00:00.000Z",
            ),
        ]
        response = QuotesResponse(quotes=quotes)
        data = response.model_dump()
        assert len(data["quotes"]) == 2


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
