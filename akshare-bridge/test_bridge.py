"""
AkShare 桥接微服务单元测试
运行: python -m pytest test_bridge.py -v
或:   python test_bridge.py
"""

import asyncio
import sys
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

# Mock akshare before importing main
sys.modules["akshare"] = MagicMock()

from main import (
    app,
    FUTURES_WATCHLIST,
    history_cache,
    research_cache,
    GlobalMarketsResponse,
    GlobalMarketQuote,
    FuturesQuote,
    FuturesQuotesResponse,
    HistoricalBar,
    HistoricalBarsResponse,
    HistoricalSeries,
    HongKongQuote,
    HongKongQuotesResponse,
    IpoSubscriptionItem,
    IpoSubscriptionsResponse,
    NewsResponse,
    NewsSourceCoverage,
    NewsItem,
    QuotesResponse,
    MarketQuote,
    QuoteCache,
    IndexCache,
    SectorSnapshot,
    SectorSnapshotResponse,
    StockSearchItem,
    StockSearchResponse,
    fetch_a_share_spot_dataframe,
    fetch_a_share_index_dataframe,
    extract_symbols,
    fetch_financial_news_batches,
    fetch_crypto_spot_dataframe,
    fetch_global_market_dataframe,
    fetch_global_market_sina_snapshot_dataframe,
    fetch_futures_history_dataframe,
    fetch_futures_spot_dataframe,
    fetch_sina_futures_realtime_dataframe,
    fetch_hk_history_dataframe,
    fetch_hk_spot_dataframe,
    fetch_sector_history_dataframe,
    fetch_sector_snapshot_dataframe,
    fetch_stock_history_dataframe,
    normalize_history_dataframe,
    normalize_hk_quote_dataframe,
    normalize_sector_snapshot_dataframes,
    normalize_global_market_dataframe,
    normalize_futures_quote_dataframe,
    normalize_news_batches,
    normalize_a_share_symbol,
    normalize_index_symbol,
    normalize_ipo_subscriptions_dataframe,
    rank_stock_matches,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_history_cache_between_tests():
    history_cache.clear()
    research_cache.clear()
    yield
    history_cache.clear()
    research_cache.clear()


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "akshare-market-bridge"
        assert data["researchCache"]["entries"] <= data["researchCache"]["maxEntries"]
        assert data["historyCache"]["entries"] <= data["historyCache"]["maxEntries"]
        assert data["historyCache"]["inFlight"] >= 0
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


class TestStockSearchEndpoint:
    @staticmethod
    def quote(symbol: str, name: str) -> MarketQuote:
        return MarketQuote(
            symbol=symbol,
            name=name,
            price=100.0,
            previousClose=99.0,
            changePercent=1.01,
            volume=1000,
            updatedAt="2026-07-16T12:00:00.000Z",
        )

    def test_exact_code_ranks_before_fuzzy_name_matches(self):
        items = rank_stock_matches([
            self.quote("600519", "贵州茅台"),
            self.quote("600809", "山西汾酒"),
            self.quote("600516", "方大炭素"),
        ], "600519", 8)

        assert [item.symbol for item in items] == ["600519"]
        assert items[0].name == "贵州茅台"

    def test_exact_chinese_name_ranks_before_contained_names(self):
        items = rank_stock_matches([
            self.quote("600519", "贵州茅台"),
            self.quote("600111", "北方稀土"),
            self.quote("600222", "贵州茅台测试"),
        ], "贵州茅台", 8)

        assert [item.symbol for item in items] == ["600519", "600222"]

    def test_fuzzy_name_returns_bounded_ambiguous_choices(self):
        items = rank_stock_matches([
            self.quote("600519", "贵州茅台"),
            self.quote("600199", "金种子酒"),
            self.quote("000858", "五粮液"),
        ], "酒", 1)

        assert len(items) == 1
        assert items[0].name == "金种子酒"

    def test_search_models_keep_only_read_only_quote_metadata(self):
        response = StockSearchResponse(
            provider="akshare",
            source="a-share-spot-cache",
            fetchedAt="2026-07-16T12:00:00Z",
            items=[StockSearchItem(
                symbol="600519",
                name="贵州茅台",
                price=1400.0,
                changePercent=-1.2,
                updatedAt="2026-07-16T07:00:00.000Z",
            )],
        )

        assert response.model_dump()["items"][0] == {
            "symbol": "600519",
            "name": "贵州茅台",
            "price": 1400.0,
            "changePercent": -1.2,
            "updatedAt": "2026-07-16T07:00:00.000Z",
        }

    def test_stock_search_requires_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/stock-search?query=贵州茅台")
        assert response.status_code == 401

    def test_stock_search_endpoint_uses_bounded_cache_search(self):
        match = StockSearchItem(
            symbol="600519",
            name="贵州茅台",
            price=1400.0,
            changePercent=-1.2,
            updatedAt="2026-07-16T07:00:00.000Z",
        )
        with patch("main.cache.search", new=AsyncMock(return_value=[match])) as search:
            response = client.get("/api/market/stock-search?query=贵州茅台&limit=99")

        assert response.status_code == 422
        search.assert_not_awaited()

        with patch("main.cache.search", new=AsyncMock(return_value=[match])) as search:
            response = client.get("/api/market/stock-search?query=贵州茅台&limit=8")

        assert response.status_code == 200
        assert response.json()["items"][0]["symbol"] == "600519"
        search.assert_awaited_once_with("贵州茅台", 8)


class TestIndicesEndpoint:
    def test_indices_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/indices?symbols=SH000001")
        assert response.status_code == 401

    def test_empty_indices_returns_400(self):
        response = client.get("/api/market/indices?symbols=")
        assert response.status_code == 400
        assert "不能为空" in response.json()["detail"]

    def test_too_many_indices_returns_400(self):
        symbols = ",".join([f"SH{i:06d}" for i in range(51)])
        response = client.get(f"/api/market/indices?symbols={symbols}")
        assert response.status_code == 400
        assert "50" in response.json()["detail"]

    def test_index_history_accepts_controlled_a_share_indices(self):
        frame = pd.DataFrame([{
            "date": "2026-07-17",
            "open": 4000,
            "high": 4050,
            "low": 3980,
            "close": 4030,
            "volume": 100000,
        }])
        with patch(
            "main.fetch_a_share_index_history_dataframe",
            return_value=(frame, "eastmoney-a-share-index-history"),
            create=True,
        ) as fetch:
            response = client.get(
                "/api/market/index-history"
                "?symbols=SH000001,SZ399001,SZ399006,SH000300&days=180",
            )

        assert response.status_code == 200
        assert len(response.json()["series"]) == 4
        assert fetch.call_count == 4

    def test_index_history_rejects_unknown_indices(self):
        response = client.get(
            "/api/market/index-history?symbols=SH000001,SH999999&days=180",
        )

        assert response.status_code == 400
        assert "受控 A 股指数" in response.json()["detail"]


class TestHongKongMarketEndpoints:
    def test_hk_quotes_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/hk/quotes?limit=3")
        assert response.status_code == 401

    def test_normalizes_hk_spot_columns_and_preserves_amount(self):
        frame = pd.DataFrame([{
            "代码": "00700",
            "名称": "腾讯控股",
            "最新价": 521.0,
            "昨收": 516.5,
            "涨跌幅": 0.87,
            "今开": 518.0,
            "最高": 523.5,
            "最低": 514.0,
            "成交量": 21_000_000,
            "成交额": 10_900_000_000,
        }])

        items = normalize_hk_quote_dataframe(frame, "eastmoney-hk-spot", 10)

        assert items == [HongKongQuote(
            symbol="00700",
            name="腾讯控股",
            price=521.0,
            previousClose=516.5,
            changePercent=0.87,
            open=518.0,
            high=523.5,
            low=514.0,
            volume=21_000_000,
            amount=10_900_000_000,
            updatedAt=items[0].updatedAt,
            source="eastmoney-hk-spot",
        )]

    def test_normalizes_sina_hk_spot_fallback_columns(self):
        frame = pd.DataFrame([{
            "symbol": "00700",
            "name": "腾讯控股",
            "lasttrade": 521.0,
            "prevclose": 516.5,
            "changepercent": 0.87,
            "open": 518.0,
            "high": 523.5,
            "low": 514.0,
            "volume": 21_000_000,
            "amount": 10_900_000_000,
        }])

        items = normalize_hk_quote_dataframe(frame, "sina-hk-spot", 10)

        assert len(items) == 1
        assert items[0].symbol == "00700"
        assert items[0].price == 521.0
        assert items[0].previousClose == 516.5
        assert items[0].amount == 10_900_000_000

    def test_hk_quotes_cache_the_real_read_only_response(self):
        frame = pd.DataFrame([{
            "代码": "00700",
            "名称": "腾讯控股",
            "最新价": 521.0,
            "昨收": 516.5,
            "涨跌幅": 0.87,
            "成交量": 21_000_000,
            "成交额": 10_900_000_000,
        }])
        with patch.dict("main.research_cache", {}, clear=True):
            with patch(
                "main.fetch_hk_spot_dataframe",
                return_value=(frame, "eastmoney-hk-spot"),
            ) as fetch:
                first = client.get("/api/market/hk/quotes?limit=10")
                second = client.get("/api/market/hk/quotes?limit=10")

        assert first.status_code == 200
        assert first.json()["items"][0]["symbol"] == "00700"
        assert second.json() == first.json()
        fetch.assert_called_once()

    def test_hk_quotes_return_degraded_payload_when_source_fails(self):
        with patch.dict("main.research_cache", {}, clear=True):
            with patch("main.fetch_hk_spot_dataframe", side_effect=RuntimeError("offline")):
                response = client.get("/api/market/hk/quotes?limit=3")

        assert response.status_code == 200
        assert response.json()["source"] == "unavailable"
        assert response.json()["items"] == []
        assert "港股行情源暂不可用" in response.json()["warning"]

    def test_hk_history_rejects_non_five_digit_symbols(self):
        response = client.get("/api/market/hk/history?symbols=700&days=180")
        assert response.status_code == 400
        assert "5 位港股代码" in response.json()["detail"]

    def test_hk_history_uses_forward_adjusted_daily_bars(self):
        history = MagicMock()
        with patch("main.ak.stock_hk_hist", return_value=history) as fetch:
            result, provider = fetch_hk_history_dataframe(
                "00700",
                "20250101",
                "20260716",
            )

        assert result is history
        assert provider == "eastmoney-hk-history"
        assert fetch.call_args.kwargs == {
            "symbol": "00700",
            "period": "daily",
            "start_date": "20250101",
            "end_date": "20260716",
            "adjust": "qfq",
        }

    def test_hk_spot_prefers_sina(self):
        snapshot = MagicMock()
        with patch("main.ak.stock_hk_spot", return_value=snapshot) as sina:
            with patch("main.ak.stock_hk_spot_em") as eastmoney:
                frame, provider = fetch_hk_spot_dataframe()

        assert frame is snapshot
        assert provider == "sina-hk-spot"
        sina.assert_called_once_with()
        eastmoney.assert_not_called()

    def test_hk_spot_falls_back_to_eastmoney(self):
        fallback = MagicMock()
        with patch("main.ak.stock_hk_spot", side_effect=RuntimeError("sina offline")):
            with patch("main.ak.stock_hk_spot_em", return_value=fallback) as eastmoney:
                frame, provider = fetch_hk_spot_dataframe()

        assert frame is fallback
        assert provider == "eastmoney-hk-spot"
        eastmoney.assert_called_once_with()

    def test_hk_history_falls_back_to_sina_daily(self):
        fallback = MagicMock()
        with patch("main.ak.stock_hk_hist", side_effect=RuntimeError("eastmoney offline")):
            with patch("main.ak.stock_hk_daily", return_value=fallback) as sina:
                frame, provider = fetch_hk_history_dataframe(
                    "00700",
                    "20250101",
                    "20260716",
                )

        assert frame is fallback
        assert provider == "sina-hk-history"
        assert sina.call_args.kwargs == {"symbol": "00700", "adjust": "qfq"}


class TestResearchNewsEndpoint:
    def test_news_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/research/news?limit=3")
        assert response.status_code == 401

    def test_news_endpoint_returns_degraded_payload_when_source_fails(self):
        with patch("main.fetch_financial_news_batches", side_effect=RuntimeError("offline")):
            response = client.get("/api/research/news?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert data["provider"] == "akshare"
        assert data["source"] == "unavailable"
        assert data["items"] == []
        assert "真实新闻源暂不可用" in data["warning"]

    def test_news_endpoint_rejects_invalid_or_excessive_symbols(self):
        invalid = client.get("/api/research/news?symbols=600519,UNKNOWN")
        excessive = client.get(
            "/api/research/news?symbols="
            "600519,000001,000858,300750,601318,600036,002594,688981,601899"
        )

        assert invalid.status_code == 400
        assert excessive.status_code == 400

    def test_news_endpoint_aggregates_deduplicates_and_caches_non_empty_results(self):
        company = pd.DataFrame([{
            "新闻标题": "贵州茅台上调产品价格",
            "新闻内容": "贵州茅台（600519）发布价格调整公告。",
            "发布时间": "2026-07-18 09:30:00",
            "文章来源": "证券时报",
            "新闻链接": "https://example.com/maotai",
        }])
        duplicate = company.copy()
        market = pd.DataFrame([{
            "tag": "市场",
            "summary": "全球能源市场出现新的供需变化",
            "url": "https://database.caixin.com/2026-07-18/100001.html",
        }])
        macro = pd.DataFrame([{
            "date": "20260718",
            "title": "宏观政策继续支持科技创新",
            "content": "政策提出支持人工智能与先进制造。",
        }])
        batches = [
            {"provider": "eastmoney-stock-news", "category": "company", "symbol": "600519", "dataframe": company},
            {"provider": "eastmoney-stock-news", "category": "company", "symbol": "000001", "dataframe": duplicate},
            {"provider": "caixin-market-news", "category": "market", "symbol": None, "dataframe": market},
            {"provider": "cctv-macro-news", "category": "macro", "symbol": None, "dataframe": macro},
        ]

        with patch(
            "main.fetch_financial_news_batches",
            return_value=(batches, ["一个次要来源暂不可用"]),
        ) as fetcher:
            first = client.get(
                "/api/research/news?limit=80&symbols=600519,000001"
            )
            second = client.get(
                "/api/research/news?limit=80&symbols=600519,000001"
            )

        assert first.status_code == 200
        assert second.status_code == 200
        data = first.json()
        assert data["source"] == "multi-source-financial-news"
        assert data["requestedSymbols"] == ["600519", "000001"]
        assert data["rawCount"] == 4
        assert data["deduplicatedCount"] == 1
        assert len(data["items"]) == 3
        assert {item["category"] for item in data["items"]} == {
            "macro", "market", "company",
        }
        assert sum(source["itemCount"] for source in data["sources"]) == 3
        assert "部分新闻源暂不可用" in data["warning"]
        fetcher.assert_called_once_with(["600519", "000001"])


class TestIpoSubscriptionsEndpoint:
    def test_ipo_subscriptions_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/research/ipo-subscriptions?limit=3")
        assert response.status_code == 401

    def test_ipo_subscriptions_return_degraded_payload_when_source_fails(self):
        with patch(
            "main.fetch_ipo_subscriptions_dataframe",
            side_effect=RuntimeError("offline"),
        ):
            response = client.get("/api/research/ipo-subscriptions?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert data["provider"] == "akshare"
        assert data["source"] == "unavailable"
        assert data["items"] == []
        assert "新股申购源暂不可用" in data["warning"]

    def test_normalizes_real_eastmoney_ipo_columns_without_zero_fallbacks(self):
        frame = pd.DataFrame([{
            "股票代码": "688825",
            "股票简称": "长鑫科技",
            "申购代码": "787825",
            "交易所": "上海证券交易所",
            "板块": "科创板",
            "发行总数": 668808.8608,
            "网上发行": 3851103500,
            "顶格申购需配市值": 3349.0,
            "申购上限": 3349000,
            "发行价格": 8.66,
            "最新价": None,
            "申购日期": pd.Timestamp("2026-07-16"),
            "中签号公布日": pd.Timestamp("2026-07-20"),
            "中签缴款日期": pd.Timestamp("2026-07-20"),
            "上市日期": None,
            "发行市盈率": 308.92,
            "行业市盈率": 76.32,
            "中签率": 0.47141739,
            "涨幅": None,
        }])

        items = normalize_ipo_subscriptions_dataframe(frame, 10)

        assert len(items) == 1
        item = items[0]
        assert item.symbol == "688825"
        assert item.name == "长鑫科技"
        assert item.subscriptionCode == "787825"
        assert item.exchange == "上海证券交易所"
        assert item.board == "科创板"
        assert item.issueTotalWanShares == 668808.8608
        assert item.onlineIssueShares == 3851103500
        assert item.marketValueRequirementWan == 3349.0
        assert item.maxSubscriptionShares == 3349000
        assert item.issuePrice == 8.66
        assert item.latestPrice is None
        assert item.subscriptionDate == "2026-07-16"
        assert item.ballotDate == "2026-07-20"
        assert item.paymentDate == "2026-07-20"
        assert item.listingDate is None
        assert item.issuePe == 308.92
        assert item.industryPe == 76.32
        assert item.winningRate == 0.47141739
        assert item.firstDayChangePercent is None

    def test_ipo_models_preserve_nullable_pricing(self):
        response = IpoSubscriptionsResponse(
            provider="akshare",
            source="eastmoney-ipo-subscription",
            fetchedAt="2026-07-16T12:00:00Z",
            items=[IpoSubscriptionItem(
                symbol="603468",
                name="津富士达",
                subscriptionCode="732468",
                exchange="上海证券交易所",
                board="非科创板",
                subscriptionDate="2026-07-24",
            )],
        )

        data = response.model_dump()
        assert data["items"][0]["issuePrice"] is None
        assert data["items"][0]["issuePe"] is None


class TestGlobalMarketsEndpoint:
    def test_global_markets_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/global?limit=3")
        assert response.status_code == 401

    def test_global_markets_endpoint_returns_degraded_payload_when_source_fails(self):
        with patch("main.fetch_global_market_dataframe", side_effect=RuntimeError("offline")):
            response = client.get("/api/market/global?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert data["provider"] == "akshare"
        assert data["markets"] == []
        assert "全球市场源暂不可用" in data["warning"]

    def test_global_history_accepts_complete_watchlist(self):
        frame = pd.DataFrame([{
            "date": "2026-07-17",
            "open": 100,
            "high": 103,
            "low": 99,
            "close": 102,
            "volume": 100000,
        }])
        symbols = "DJI,SPX,IXIC,HSI,N225,KOSPI,SX5E"
        with patch(
            "main.fetch_global_history_dataframe",
            return_value=(frame, "eastmoney-global-history"),
            create=True,
        ) as fetch:
            response = client.get(
                f"/api/market/global/history?symbols={symbols}&days=500",
            )

        assert response.status_code == 200
        assert len(response.json()["series"]) == 7
        assert fetch.call_count == 7

    def test_global_history_rejects_unknown_indices(self):
        response = client.get(
            "/api/market/global/history?symbols=SPX,UNKNOWN&days=180",
        )

        assert response.status_code == 400
        assert "受控全球指数" in response.json()["detail"]


class TestCryptoMarketEndpoint:
    def test_crypto_public_source_prefers_structured_jin10_json(self):
        response = MagicMock()
        response.json.return_value = {
            "data": [[
                "crypto",
                "BTCUSD",
                68000,
                1000,
                1.5,
                69000,
                66000,
                120000,
                datetime.now().astimezone().isoformat(),
            ]],
        }
        with patch("main.requests.get", return_value=response):
            frame, source = fetch_crypto_spot_dataframe()

        assert source == "jin10-public-crypto"
        assert frame["交易品种"].tolist() == ["BTCUSD"]

    def test_crypto_public_source_does_not_use_akshare_native_js(self):
        response = MagicMock()
        response.json.return_value = [
            {
                "symbol": "BTCUSDT",
                "lastPrice": "68000",
                "priceChangePercent": "1.5",
                "highPrice": "69000",
                "lowPrice": "66000",
                "quoteVolume": "120000000",
                "closeTime": 1784359200000,
            },
            {
                "symbol": "ETHUSDT",
                "lastPrice": "3600",
                "priceChangePercent": "-0.8",
                "highPrice": "3700",
                "lowPrice": "3500",
                "quoteVolume": "240000000",
                "closeTime": 1784359200000,
            },
        ]
        with patch("main.requests.get", return_value=response):
            with patch("main.ak.crypto_js_spot") as native_crypto:
                frame, source = fetch_crypto_spot_dataframe()

        assert source == "binance-public-24h"
        assert frame["symbol"].tolist() == ["BTCUSDT", "ETHUSDT"]
        native_crypto.assert_not_called()

    def test_crypto_quotes_only_return_controlled_btc_and_eth(self):
        frame = pd.DataFrame([
            {
                "市场": "crypto",
                "交易品种": "BTCUSD",
                "最近报价": 68000,
                "涨跌幅": 1.5,
                "24小时最高": 69000,
                "24小时最低": 66000,
                "24小时成交量": 120000,
                "更新时间": "2026-07-18 23:20:00",
            },
            {
                "市场": "crypto",
                "交易品种": "ETHUSD",
                "最近报价": 3600,
                "涨跌幅": -0.8,
                "24小时最高": 3700,
                "24小时最低": 3500,
                "24小时成交量": 240000,
                "更新时间": "2026-07-18 23:20:00",
            },
            {
                "市场": "crypto",
                "交易品种": "DOGEUSD",
                "最近报价": 0.2,
                "涨跌幅": 8,
                "24小时最高": 0.21,
                "24小时最低": 0.18,
                "24小时成交量": 999999,
                "更新时间": "2026-07-18 23:20:00",
            },
        ])
        with patch(
            "main.fetch_crypto_spot_dataframe",
            return_value=(frame, "jin10-crypto-spot"),
            create=True,
        ):
            response = client.get("/api/market/crypto/quotes")

        assert response.status_code == 200
        assert [item["symbol"] for item in response.json()["items"]] == [
            "BTCUSD",
            "ETHUSD",
        ]

    def test_crypto_quotes_do_not_fabricate_prices_on_failure(self):
        with patch(
            "main.fetch_crypto_spot_dataframe",
            side_effect=RuntimeError("offline"),
            create=True,
        ):
            response = client.get("/api/market/crypto/quotes")

        assert response.status_code == 200
        assert response.json()["source"] == "unavailable"
        assert response.json()["items"] == []
        assert "数字资产行情源暂不可用" in response.json()["warning"]


class TestDomesticFuturesEndpoints:
    def test_futures_quotes_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/futures/quotes?limit=4")
        assert response.status_code == 401

    def test_normalizes_controlled_main_contract_quotes(self):
        frame = pd.DataFrame([{
            "symbol": "沪深300指数",
            "time": "15:00:00",
            "open": 3980,
            "high": 4025,
            "low": 3960,
            "current_price": 4000,
            "bid_price": 3999.8,
            "ask_price": 4000.2,
            "hold": 125000,
            "volume": 88000,
            "avg_price": 3992,
            "last_close": 3985,
            "last_settle_price": 3990,
        }])

        items = normalize_futures_quote_dataframe(
            frame,
            ["IF0"],
            "sina-domestic-futures-spot",
            4,
        )

        assert len(items) == 1
        assert items[0].symbol == "IF0"
        assert items[0].name == "沪深300股指"
        assert items[0].category == "股指"
        assert items[0].price == 4000
        assert items[0].previousSettlement == 3990
        assert items[0].changePercent == pytest.approx(0.2506266)
        assert items[0].openInterest == 125000
        assert items[0].volume == 88000

    def test_futures_spot_fetch_uses_sina_controlled_contract_list(self):
        frame = MagicMock()
        with patch("main.ak.futures_zh_spot", return_value=frame) as fetch:
            result, provider = fetch_futures_spot_dataframe(["IF0", "CU0"])

        assert result is frame
        assert provider == "sina-domestic-futures-spot"
        assert fetch.call_args.kwargs == {
            "symbol": "IF0,CU0",
            "market": "CF",
            "adjust": "0",
        }

    def test_futures_spot_falls_back_when_akshare_bulk_parser_breaks(self):
        frame = MagicMock()
        with patch(
            "main.ak.futures_zh_spot",
            side_effect=ValueError("Length mismatch"),
        ):
            with patch(
                "main.fetch_sina_futures_realtime_dataframe",
                return_value=frame,
            ) as fallback:
                result, provider = fetch_futures_spot_dataframe(["IF0", "CU0"])

        assert result is frame
        assert provider == "sina-domestic-futures-realtime-compat"
        fallback.assert_called_once_with(["IF0", "CU0"])

    def test_sina_futures_compat_parser_keeps_only_requested_continuous_rows(self):
        responses = {
            "qz_qh": [{
                "symbol": "IF0",
                "name": "沪深300指数期货连续",
                "trade": "4645.6",
                "presettlement": "4713.0",
                "open": "4677.0",
                "high": "4712.6",
                "low": "4618.0",
                "bidprice1": "4644.8",
                "askprice1": "4645.6",
                "volume": "86023",
                "position": "160153",
                "ticktime": "15:00:00",
            }],
            "tong_qh": [{
                "symbol": "CU0",
                "name": "沪铜连续",
                "trade": "88200",
                "presettlement": "87500",
                "volume": "125000",
                "position": "220000",
                "ticktime": "15:00:00",
            }],
        }

        def fake_get(_url, params, **_kwargs):
            response = MagicMock()
            response.json.return_value = responses[params["node"]]
            return response

        with patch("main.requests.get", side_effect=fake_get) as request:
            frame = fetch_sina_futures_realtime_dataframe(["IF0", "CU0"])

        assert frame["contract"].tolist() == ["IF0", "CU0"]
        assert frame["current_price"].tolist() == ["4645.6", "88200"]
        assert frame["last_settle_price"].tolist() == ["4713.0", "87500"]
        assert {call.kwargs["params"]["node"] for call in request.call_args_list} == {
            "qz_qh",
            "tong_qh",
        }

    def test_futures_quotes_cache_only_non_empty_real_response(self):
        frame = pd.DataFrame([{
            "symbol": "沪深300指数",
            "time": "15:00:00",
            "current_price": 4000,
            "last_settle_price": 3990,
            "volume": 88000,
            "hold": 125000,
        }])
        with patch.dict("main.research_cache", {}, clear=True):
            with patch(
                "main.fetch_futures_spot_dataframe",
                return_value=(frame, "sina-domestic-futures-spot"),
            ) as fetch:
                first = client.get("/api/market/futures/quotes?limit=1")
                second = client.get("/api/market/futures/quotes?limit=1")

        assert first.status_code == 200
        assert first.json()["items"][0]["symbol"] == "IF0"
        assert second.json() == first.json()
        fetch.assert_called_once_with(["IF0"])

    def test_futures_quotes_return_empty_degraded_payload_on_failure(self):
        with patch.dict("main.research_cache", {}, clear=True):
            with patch(
                "main.fetch_futures_spot_dataframe",
                side_effect=RuntimeError("offline"),
            ):
                response = client.get("/api/market/futures/quotes?limit=4")

        assert response.status_code == 200
        assert response.json()["source"] == "unavailable"
        assert response.json()["items"] == []
        assert "期货行情源暂不可用" in response.json()["warning"]

    def test_futures_history_rejects_unknown_contracts(self):
        response = client.get(
            "/api/market/futures/history?symbols=IF0,UNKNOWN&days=180",
        )
        assert response.status_code == 400
        assert "受控主连观察池" in response.json()["detail"]

    def test_futures_history_accepts_complete_watchlist(self):
        frame = pd.DataFrame([{
            "日期": "2026-07-15",
            "开盘价": 3980,
            "最高价": 4025,
            "最低价": 3960,
            "收盘价": 4000,
            "成交量": 88000,
            "持仓量": 125000,
            "动态结算价": 3995,
        }])
        symbols = ",".join(FUTURES_WATCHLIST)
        with patch(
            "main.fetch_futures_history_dataframe",
            return_value=(frame, "sina-domestic-main-continuous"),
        ) as fetch:
            response = client.get(
                f"/api/market/futures/history?symbols={symbols}&days=180",
            )

        assert response.status_code == 200
        assert len(response.json()["series"]) == len(FUTURES_WATCHLIST)
        assert fetch.call_count == len(FUTURES_WATCHLIST)

    def test_futures_history_uses_continuous_main_daily_bars(self):
        frame = pd.DataFrame([{
            "日期": "2026-07-15",
            "开盘价": 3980,
            "最高价": 4025,
            "最低价": 3960,
            "收盘价": 4000,
            "成交量": 88000,
            "持仓量": 125000,
            "动态结算价": 3995,
        }])
        with patch.dict("main.research_cache", {}, clear=True):
            with patch(
                "main.fetch_futures_history_dataframe",
                return_value=(frame, "sina-domestic-main-continuous"),
            ) as fetch:
                response = client.get(
                    "/api/market/futures/history?symbols=IF0&days=180",
                )

        assert response.status_code == 200
        series = response.json()["series"][0]
        assert series["symbol"] == "IF0"
        assert series["adjustment"] == "continuous-main"
        assert series["bars"][0]["close"] == 4000
        assert fetch.call_count == 1

    def test_futures_history_fetches_sina_main_contract(self):
        frame = MagicMock()
        with patch("main.ak.futures_main_sina", return_value=frame) as fetch:
            result, provider = fetch_futures_history_dataframe(
                "CU0",
                "20250101",
                "20260716",
            )

        assert result is frame
        assert provider == "sina-domestic-main-continuous"
        assert fetch.call_args.kwargs == {
            "symbol": "CU0",
            "start_date": "20250101",
            "end_date": "20260716",
        }


class TestSectorAndHistoryEndpoints:
    def test_sectors_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/market/sectors?limit=3")
        assert response.status_code == 401

    def test_sector_history_rejects_too_many_sectors(self):
        sectors = ",".join([f"行业{i}" for i in range(21)])
        response = client.get(
            "/api/market/sector-history",
            params={"sectors": sectors, "days": 180},
        )
        assert response.status_code == 400
        assert "20" in response.json()["detail"]

    def test_stock_history_rejects_too_many_symbols(self):
        symbols = ",".join([f"{i:06d}" for i in range(13)])
        response = client.get(
            "/api/market/stock-history",
            params={"symbols": symbols, "days": 180},
        )
        assert response.status_code == 400
        assert "12" in response.json()["detail"]

    def test_history_days_are_bounded(self):
        response = client.get(
            "/api/market/stock-history?symbols=600519&days=30",
        )
        assert response.status_code == 422

    def test_sectors_return_degraded_payload_when_primary_source_fails(self):
        with patch(
            "main.fetch_sector_snapshot_dataframe",
            side_effect=RuntimeError("offline"),
        ):
            response = client.get("/api/market/sectors?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert data["provider"] == "akshare"
        assert data["sectors"] == []
        assert "行业板块源暂不可用" in data["warning"]

    def test_stock_history_preserves_partial_results_and_warning(self):
        rows = [
            {
                "日期": "2026-07-10",
                "开盘": 10,
                "最高": 11,
                "最低": 9.8,
                "收盘": 10.8,
                "成交量": 1000,
                "成交额": 10800,
                "涨跌幅": 2.1,
                "换手率": 1.2,
            },
        ]
        df = MagicMock()
        df.iterrows.return_value = enumerate(rows)

        def fetch(symbol, _start, _end):
            if symbol == "000001":
                raise RuntimeError("symbol unavailable")
            return df

        with patch("main.fetch_stock_history_dataframe", side_effect=fetch):
            response = client.get(
                "/api/market/stock-history?symbols=600519,000001&days=180",
            )

        assert response.status_code == 200
        data = response.json()
        assert [item["symbol"] for item in data["series"]] == ["600519"]
        assert "000001" in data["warning"]

    def test_stock_history_reuses_a_symbol_across_different_batches(self):
        frame = pd.DataFrame([{
            "date": "2026-07-10",
            "open": 10,
            "high": 11,
            "low": 9.8,
            "close": 10.8,
            "volume": 1000,
        }])

        with patch("main.fetch_stock_history_dataframe", return_value=frame) as fetch:
            first = client.get("/api/market/stock-history?symbols=600519&days=180")
            second = client.get(
                "/api/market/stock-history?symbols=600519,000001&days=180",
            )

        assert first.status_code == 200
        assert second.status_code == 200
        assert [item["symbol"] for item in second.json()["series"]] == [
            "600519",
            "000001",
        ]
        assert [call.args[0] for call in fetch.call_args_list] == [
            "600519",
            "000001",
        ]

    def test_empty_stock_history_response_is_not_cached(self):
        recovered_df = pd.DataFrame([
            {
                "date": "2026-07-10",
                "open": 10,
                "high": 11,
                "low": 9.8,
                "close": 10.8,
                "volume": 1000,
            },
        ])

        with patch.dict("main.research_cache", {}, clear=True):
            with patch(
                "main.fetch_stock_history_dataframe",
                side_effect=[pd.DataFrame(), recovered_df],
            ) as fetch:
                first = client.get(
                    "/api/market/stock-history?symbols=999999&days=180",
                )
                second = client.get(
                    "/api/market/stock-history?symbols=999999&days=180",
                )

        assert first.status_code == 200
        assert first.json()["series"] == []
        assert second.status_code == 200
        assert [item["symbol"] for item in second.json()["series"]] == ["999999"]
        assert fetch.call_count == 2


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

    def test_success_ttl_starts_when_refresh_finishes(self):
        clock = {"now": 100.0}
        frame = pd.DataFrame(columns=["代码", "名称"])
        cache = QuoteCache(ttl_sec=3.0)

        def slow_fetch():
            clock["now"] = 122.0
            return frame

        with patch("main.time.time", side_effect=lambda: clock["now"]):
            with patch("main.fetch_a_share_spot_dataframe", side_effect=slow_fetch):
                asyncio.run(cache.refresh())
                assert cache.age_sec == 0
                assert cache._needs_refresh() is False

    def test_failed_refresh_cools_down_before_retrying_stale_cache(self):
        clock = {"now": 100.0}
        cache = QuoteCache(ttl_sec=3.0)
        cache._data["600519"] = MarketQuote(
            symbol="600519",
            name="贵州茅台",
            tradable=True,
            price=1500,
            previousClose=1490,
            changePercent=0.67,
            volume=1_000,
            updatedAt="2026-07-19T02:00:00.000Z",
        )
        cache._last_update = 90.0

        with patch("main.time.time", side_effect=lambda: clock["now"]):
            with patch(
                "main.fetch_a_share_spot_dataframe",
                side_effect=RuntimeError("offline"),
            ) as fetch:
                asyncio.run(cache.refresh())
                clock["now"] = 101.0
                quotes = asyncio.run(cache.get_quotes(["600519"]))

        assert fetch.call_count == 1
        assert [quote.symbol for quote in quotes] == ["600519"]
        assert cache.last_error == "offline"

    def test_symbol_normalization_accepts_market_prefixes(self):
        assert normalize_a_share_symbol("sh600519") == "600519"
        assert normalize_a_share_symbol("sz000001") == "000001"
        assert normalize_a_share_symbol("bj920000") == "920000"
        assert normalize_a_share_symbol("600036") == "600036"
        assert normalize_a_share_symbol("not-a-symbol") is None

    def test_index_cache_starts_empty(self):
        cache = IndexCache(ttl_sec=3.0)
        assert cache.count == 0
        assert cache.age_sec == float("inf")

    def test_index_success_ttl_starts_when_refresh_finishes(self):
        clock = {"now": 200.0}
        frame = pd.DataFrame(columns=["代码", "名称"])
        cache = IndexCache(ttl_sec=3.0)

        def slow_fetch():
            clock["now"] = 207.0
            return frame

        with patch("main.time.time", side_effect=lambda: clock["now"]):
            with patch("main.fetch_a_share_index_dataframe", side_effect=slow_fetch):
                asyncio.run(cache.refresh())
                assert cache.age_sec == 0
                assert cache._needs_refresh() is False

    def test_fetch_index_uses_eastmoney_source(self):
        index_df = MagicMock()
        index_df.__len__.return_value = 4
        with patch("main.ak.stock_zh_index_spot_em", return_value=index_df):
            assert fetch_a_share_index_dataframe() is index_df

    def test_index_symbol_normalization_namespaces_indices(self):
        assert normalize_index_symbol("000001") == "SH000001"
        assert normalize_index_symbol("399001") == "SZ399001"
        assert normalize_index_symbol("399006") == "SZ399006"
        assert normalize_index_symbol("000300") == "SH000300"
        assert normalize_index_symbol("SH000001") == "SH000001"
        assert normalize_index_symbol("000001.SH") == "SH000001"
        assert normalize_index_symbol("399001.SZ") == "SZ399001"

    def test_fetch_global_market_uses_public_source(self):
        global_df = MagicMock()
        global_df.__len__.return_value = 3
        with patch("main.ak.index_global_spot_em", return_value=global_df):
            df, provider = fetch_global_market_dataframe()
        assert df is global_df
        assert provider == "global-index-em"

    def test_fetch_global_market_supports_legacy_akshare_name(self):
        global_df = MagicMock()
        with patch("main.ak.index_global_spot_em", side_effect=RuntimeError("new source failed")):
            with patch(
                "main.ak.stock_zh_index_global_spot_em",
                return_value=global_df,
                create=True,
            ):
                df, provider = fetch_global_market_dataframe()
        assert df is global_df
        assert provider == "global-index-em-legacy"

    def test_fetch_global_market_falls_back_to_sina_history(self):
        global_df = MagicMock()
        with patch(
            "main.ak.index_global_spot_em",
            side_effect=RuntimeError("new source failed"),
        ):
            with patch(
                "main.ak.stock_zh_index_global_spot_em",
                side_effect=RuntimeError("legacy source failed"),
                create=True,
            ):
                with patch(
                    "main.fetch_global_market_sina_snapshot_dataframe",
                    return_value=global_df,
                ):
                    df, provider = fetch_global_market_dataframe()

        assert df is global_df
        assert provider == "sina-global-history-latest"

    def test_sina_global_snapshot_uses_supported_index_names(self):
        requested_global_names = []
        requested_us_symbols = []

        def fetch_history(*, symbol):
            requested_global_names.append(symbol)
            return pd.DataFrame([
                {"date": "2026-07-16", "close": 100.0},
                {"date": "2026-07-17", "close": 102.0},
            ])

        def fetch_us(*, symbol):
            requested_us_symbols.append(symbol)
            return pd.DataFrame([
                {"date": "2026-07-16", "close": 100.0},
                {"date": "2026-07-17", "close": 102.0},
            ])

        with patch("main.ak.index_global_hist_sina", side_effect=fetch_history):
            with patch("main.ak.index_us_stock_sina", side_effect=fetch_us):
                df = fetch_global_market_sina_snapshot_dataframe()

        assert set(requested_us_symbols) == {".DJI", ".INX", ".IXIC"}
        assert set(requested_global_names) == {
            "恒生指数",
            "日经225指数",
            "首尔综合指数",
            "英国富时100指数",
            "德国DAX 30种股价指数",
            "法CAC40指数",
            "欧洲Stoxx50指数",
        }
        assert df["代码"].tolist() == [
            "DJI", "SPX", "IXIC", "HSI", "N225",
            "KOSPI", "FTSE", "GDAXI", "FCHI", "SX5E",
        ]
        assert df["市场日期"].tolist() == ["2026-07-17"] * 10
        assert df["涨跌幅"].tolist() == pytest.approx([2.0] * 10)

    def test_fetch_news_combines_market_macro_and_bounded_stock_sources(self):
        caixin = pd.DataFrame([{"summary": "市场新闻", "url": "https://example.com/a"}])
        cctv = pd.DataFrame([{"date": "20260719", "title": "宏观新闻", "content": "正文"}])
        stock = pd.DataFrame([{"新闻标题": "公司新闻"}])
        with patch("main.current_china_date", return_value=datetime(2026, 7, 19).date()):
            with patch("main.ak.stock_news_main_cx", return_value=caixin):
                with patch("main.ak.news_cctv", return_value=cctv) as cctv_fetch:
                    with patch("main.ak.stock_news_em", return_value=stock) as stock_fetch:
                        batches, warnings = fetch_financial_news_batches(
                            ["600519", "000001"],
                        )

        assert warnings == []
        assert {batch["provider"] for batch in batches} == {
            "caixin-market-news",
            "cctv-macro-news",
            "eastmoney-stock-news",
        }
        assert sorted(
            batch["symbol"] for batch in batches if batch["symbol"] is not None
        ) == ["000001", "600519"]
        assert cctv_fetch.call_count == 2
        assert cctv_fetch.call_args_list[0].kwargs == {"date": "20260719"}
        assert cctv_fetch.call_args_list[1].kwargs == {"date": "20260718"}
        assert stock_fetch.call_count == 2

    def test_normalize_news_batches_uses_stable_ids_and_balances_categories(self):
        batches = [
            {
                "provider": "eastmoney-stock-news",
                "category": "company",
                "symbol": "600519",
                "dataframe": pd.DataFrame([{
                    "新闻标题": "贵州茅台上调价格",
                    "新闻内容": "公司公告显示产品价格调整。",
                    "发布时间": "2026-07-18 09:30:00",
                    "文章来源": "证券时报",
                    "新闻链接": "https://example.com/1",
                }]),
            },
            {
                "provider": "caixin-market-news",
                "category": "market",
                "symbol": None,
                "dataframe": pd.DataFrame([{
                    "tag": "市场",
                    "summary": "全球能源市场出现新的供需变化",
                    "url": "https://database.caixin.com/2026-07-18/100001.html",
                }]),
            },
            {
                "provider": "cctv-macro-news",
                "category": "macro",
                "symbol": None,
                "dataframe": pd.DataFrame([{
                    "date": "20260718",
                    "title": "宏观政策继续支持科技创新",
                    "content": "政策提出支持人工智能与先进制造。",
                }]),
            },
        ]

        first = normalize_news_batches(batches, 80)
        second = normalize_news_batches(batches, 80)

        first_items, raw_count, deduplicated_count, sources = first
        second_items = second[0]
        assert raw_count == 3
        assert deduplicated_count == 0
        assert [item.category for item in first_items] == [
            "company", "market", "macro",
        ]
        assert [item.id for item in first_items] == [item.id for item in second_items]
        assert first_items[0].symbols == ["600519"]
        assert sum(source.itemCount for source in sources) == 3

    def test_cctv_items_sharing_a_daily_page_are_deduplicated_by_title(self):
        batches = [{
            "provider": "cctv-macro-news",
            "category": "macro",
            "symbol": None,
            "dataframe": pd.DataFrame([
                {"date": "20260718", "title": "宏观新闻一", "content": "内容一"},
                {"date": "20260718", "title": "宏观新闻二", "content": "内容二"},
            ]),
        }]

        items, raw_count, deduplicated_count, _ = normalize_news_batches(
            batches,
            80,
        )

        assert raw_count == 2
        assert deduplicated_count == 0
        assert [item.title for item in items] == ["宏观新闻一", "宏观新闻二"]
        assert items[0].url == items[1].url

    def test_sector_snapshot_falls_back_to_ths(self):
        fallback_df = MagicMock()
        with patch(
            "main.ak.stock_board_industry_name_em",
            side_effect=RuntimeError("eastmoney offline"),
        ):
            with patch(
                "main.ak.stock_board_industry_summary_ths",
                return_value=fallback_df,
            ):
                df, provider = fetch_sector_snapshot_dataframe()

        assert df is fallback_df
        assert provider == "ths-industry-summary"

    def test_sector_history_falls_back_to_ths(self):
        fallback_df = MagicMock()
        with patch(
            "main.ak.stock_board_industry_hist_em",
            side_effect=RuntimeError("eastmoney offline"),
        ):
            with patch(
                "main.ak.stock_board_industry_index_ths",
                return_value=fallback_df,
            ):
                df, provider = fetch_sector_history_dataframe(
                    "半导体",
                    "20250101",
                    "20260714",
                )

        assert df is fallback_df
        assert provider == "ths-industry-history"

    def test_stock_history_falls_back_to_tencent_with_market_prefix(self):
        fallback_df = MagicMock()
        with patch(
            "main.ak.stock_zh_a_hist",
            side_effect=RuntimeError("eastmoney offline"),
        ):
            with patch("main.ak.stock_zh_a_hist_tx", return_value=fallback_df) as tx:
                df, provider = fetch_stock_history_dataframe(
                    "600519",
                    "20250101",
                    "20260714",
                )

        assert df is fallback_df
        assert provider == "tencent-stock-history"
        assert tx.call_args.kwargs["symbol"] == "sh600519"


class TestResearchDataNormalization:
    def test_extract_symbols_rejects_plain_six_digit_numbers(self):
        assert extract_symbols("月份 202607，贵州茅台 600519，北交所 920001") == [
            "600519",
            "920001",
        ]

    def test_normalize_news_batches_preserves_source_time_and_symbols(self):
        rows = [
            {
                "新闻标题": "600519 公司业绩预增",
                "文章来源": "东方财富",
                "发布时间": "2026-07-11 09:30:00",
                "新闻链接": "https://example.test/news/1",
                "新闻内容": "贵州茅台 600519 披露增长信息",
            },
        ]
        items, _, _, _ = normalize_news_batches([{
            "provider": "eastmoney-stock-news",
            "category": "company",
            "symbol": "600519",
            "dataframe": pd.DataFrame(rows),
        }], 5)

        assert len(items) == 1
        assert items[0].source == "东方财富"
        assert items[0].sentiment == "positive"
        assert items[0].symbols == ["600519"]
        assert items[0].publishedAt == "2026-07-11T09:30:00+08:00"
        assert items[0].category == "company"

    def test_normalize_global_market_dataframe_maps_core_indices(self):
        rows = [
            {"名称": "纳斯达克", "代码": "IXIC", "最新价": "18000", "涨跌幅": "1.2"},
            {"名称": "恒生指数", "代码": "HSI", "最新价": "19000", "涨跌幅": "-0.5"},
            {"名称": "法国CAC40", "代码": "CAC", "最新价": "8200", "涨跌幅": "0.3"},
            {"名称": "欧洲Stoxx50", "代码": "SX5E", "最新价": "6200", "涨跌幅": "0.2"},
        ]
        df = MagicMock()
        df.iterrows.return_value = enumerate(rows)

        markets = normalize_global_market_dataframe(df, "global-index-em", 10)

        assert len(markets) == 4
        assert markets[0].symbol == "IXIC"
        assert markets[0].region == "US"
        assert markets[0].timezone == "America/New_York"
        assert markets[0].quoteKind == "snapshot"
        assert markets[1].symbol == "HSI"
        assert markets[1].region == "HK"
        assert markets[2].symbol == "FCHI"
        assert markets[2].region == "EU"
        assert markets[3].symbol == "SX5E"
        assert markets[3].region == "EU"

    def test_normalize_sector_snapshot_merges_real_fund_flow(self):
        sector_rows = [
            {
                "板块代码": "BK1036",
                "板块名称": "半导体",
                "最新价": "1288.4",
                "涨跌幅": "2.31",
                "成交额": "45600000000",
                "换手率": "3.2",
                "上涨家数": "88",
                "下跌家数": "21",
                "领涨股票": "测试股份",
                "领涨股票-涨跌幅": "8.6",
            },
        ]
        flow_rows = [
            {
                "名称": "半导体",
                "今日主力净流入-净额": "2840000000",
            },
        ]
        sector_df = MagicMock()
        sector_df.iterrows.return_value = enumerate(sector_rows)
        flow_df = MagicMock()
        flow_df.iterrows.return_value = enumerate(flow_rows)

        sectors = normalize_sector_snapshot_dataframes(sector_df, flow_df, 10)

        assert len(sectors) == 1
        assert sectors[0].symbol == "BK1036"
        assert sectors[0].name == "半导体"
        assert sectors[0].changePercent == 2.31
        assert sectors[0].mainNetInflow == 2840000000
        assert sectors[0].advancers == 88

    def test_normalize_ths_sector_snapshot_converts_yi_units(self):
        rows = [{
            "板块": "半导体",
            "涨跌幅": "1.8",
            "总成交额": "456.2",
            "净流入": "28.4",
            "上涨家数": "80",
            "下跌家数": "20",
            "均价": "1288.4",
            "领涨股": "测试股份",
            "领涨股-涨跌幅": "6.2",
        }]
        sector_df = MagicMock()
        sector_df.iterrows.return_value = enumerate(rows)

        sectors = normalize_sector_snapshot_dataframes(sector_df, None, 10)

        assert sectors[0].amount == 45620000000
        assert sectors[0].mainNetInflow == 2840000000

    def test_normalize_history_dataframe_sorts_and_limits_rows(self):
        rows = [
            {
                "日期": "2026-07-11",
                "开盘": "10.5",
                "最高": "11",
                "最低": "10.2",
                "收盘": "10.8",
                "成交量": "1200",
                "成交额": "12960",
                "涨跌幅": "2.86",
                "换手率": "1.5",
            },
            {
                "日期": "2026-07-10",
                "开盘": "10",
                "最高": "10.6",
                "最低": "9.9",
                "收盘": "10.5",
                "成交量": "1000",
                "成交额": "10500",
                "涨跌幅": "1.94",
                "换手率": "1.2",
            },
        ]
        df = MagicMock()
        df.iterrows.return_value = enumerate(rows)

        series = normalize_history_dataframe(
            df,
            symbol="600519",
            name="600519",
            source="stock-zh-a-hist",
            adjustment="qfq",
            limit=1,
        )

        assert series.symbol == "600519"
        assert series.adjustment == "qfq"
        assert len(series.bars) == 1
        assert series.bars[0].date == "2026-07-11"
        assert series.bars[0].close == 10.8


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

    def test_news_response_serialization(self):
        response = NewsResponse(
            provider="akshare",
            source="eastmoney-financial-news",
            fetchedAt="2026-07-11T00:00:00Z",
            items=[
                NewsItem(
                    id="n1",
                    source="东方财富",
                    title="测试新闻",
                    publishedAt="2026-07-11T09:30:00+08:00",
                    fetchedAt="2026-07-11T01:30:00Z",
                    symbols=["600519"],
                    sentiment="neutral",
                    category="company",
                ),
            ],
            sources=[
                NewsSourceCoverage(
                    source="东方财富",
                    category="company",
                    itemCount=1,
                ),
            ],
            requestedSymbols=["600519"],
            rawCount=1,
            deduplicatedCount=0,
        )
        data = response.model_dump()
        assert data["items"][0]["source"] == "东方财富"
        assert data["items"][0]["symbols"] == ["600519"]
        assert data["sources"][0]["itemCount"] == 1

    def test_global_markets_response_serialization(self):
        response = GlobalMarketsResponse(
            provider="akshare",
            fetchedAt="2026-07-11T00:00:00Z",
            markets=[
                GlobalMarketQuote(
                    symbol="IXIC",
                    name="纳斯达克指数",
                    region="US",
                    price=18000,
                    changePercent=1.2,
                    updatedAt="2026-07-11T00:00:00Z",
                    source="global-index-em",
                    sessionDate="2026-07-10",
                    timezone="America/New_York",
                    quoteKind="daily-close",
                ),
            ],
        )
        data = response.model_dump()
        assert data["markets"][0]["symbol"] == "IXIC"
        assert data["markets"][0]["region"] == "US"
        assert data["markets"][0]["sessionDate"] == "2026-07-10"
        assert data["markets"][0]["timezone"] == "America/New_York"

    def test_sector_and_history_models_serialize_source_metadata(self):
        sector_response = SectorSnapshotResponse(
            provider="akshare",
            source="eastmoney-industry-board+eastmoney-sector-fund-flow",
            fetchedAt="2026-07-11T00:00:00Z",
            sectors=[
                SectorSnapshot(
                    symbol="BK1036",
                    name="半导体",
                    price=1288.4,
                    changePercent=2.31,
                    updatedAt="2026-07-11T00:00:00Z",
                    mainNetInflow=2840000000,
                ),
            ],
        )
        history_response = HistoricalBarsResponse(
            provider="akshare",
            source="stock-zh-a-hist",
            fetchedAt="2026-07-11T00:00:00Z",
            series=[
                HistoricalSeries(
                    symbol="600519",
                    name="600519",
                    source="stock-zh-a-hist",
                    adjustment="qfq",
                    bars=[
                        HistoricalBar(
                            date="2026-07-10",
                            open=10,
                            high=11,
                            low=9.8,
                            close=10.8,
                            volume=1000,
                        ),
                    ],
                ),
            ],
        )

        assert sector_response.model_dump()["sectors"][0]["mainNetInflow"] == 2840000000
        assert history_response.model_dump()["series"][0]["adjustment"] == "qfq"


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
