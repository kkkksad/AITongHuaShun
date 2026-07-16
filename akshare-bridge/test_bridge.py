"""
AkShare 桥接微服务单元测试
运行: python -m pytest test_bridge.py -v
或:   python test_bridge.py
"""

import sys
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

# Mock akshare before importing main
sys.modules["akshare"] = MagicMock()

from main import (
    app,
    GlobalMarketsResponse,
    GlobalMarketQuote,
    HistoricalBar,
    HistoricalBarsResponse,
    HistoricalSeries,
    IpoSubscriptionItem,
    IpoSubscriptionsResponse,
    NewsResponse,
    NewsItem,
    QuotesResponse,
    MarketQuote,
    QuoteCache,
    IndexCache,
    SectorSnapshot,
    SectorSnapshotResponse,
    fetch_a_share_spot_dataframe,
    fetch_a_share_index_dataframe,
    fetch_financial_news_dataframe,
    fetch_global_market_dataframe,
    fetch_global_market_sina_snapshot_dataframe,
    fetch_sector_history_dataframe,
    fetch_sector_snapshot_dataframe,
    fetch_stock_history_dataframe,
    normalize_history_dataframe,
    normalize_sector_snapshot_dataframes,
    normalize_global_market_dataframe,
    normalize_news_dataframe,
    normalize_a_share_symbol,
    normalize_index_symbol,
    normalize_ipo_subscriptions_dataframe,
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


class TestResearchNewsEndpoint:
    def test_news_require_server_token_when_configured(self):
        with patch("main.AUTH_TOKEN", "test-secret"):
            response = client.get("/api/research/news?limit=3")
        assert response.status_code == 401

    def test_news_endpoint_returns_degraded_payload_when_source_fails(self):
        with patch("main.fetch_financial_news_dataframe", side_effect=RuntimeError("offline")):
            response = client.get("/api/research/news?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert data["provider"] == "akshare"
        assert data["source"] == "unavailable"
        assert data["items"] == []
        assert "真实新闻源暂不可用" in data["warning"]


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
        requested_names = []

        def fetch_history(*, symbol):
            requested_names.append(symbol)
            return pd.DataFrame([
                {"close": 100.0},
                {"close": 102.0},
            ])

        with patch("main.ak.index_global_hist_sina", side_effect=fetch_history):
            df = fetch_global_market_sina_snapshot_dataframe()

        assert requested_names == [
            "日经225指数",
            "英国富时100指数",
            "德国DAX 30种股价指数",
            "法CAC40指数",
            "欧洲Stoxx50指数",
        ]
        assert df["代码"].tolist() == ["NKY", "UKX", "DAX", "CAC", "SX5E"]
        assert df["涨跌幅"].tolist() == pytest.approx([2.0] * 5)

    def test_fetch_news_uses_public_source(self):
        news_df = MagicMock()
        news_df.__len__.return_value = 3
        with patch("main.ak.stock_news_em", return_value=news_df):
            df, provider = fetch_financial_news_dataframe()
        assert df is news_df
        assert provider == "eastmoney-financial-news"

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
    def test_normalize_news_dataframe_preserves_source_time_and_symbols(self):
        rows = [
            {
                "新闻标题": "600519 公司业绩预增",
                "文章来源": "东方财富",
                "发布时间": "2026-07-11 09:30:00",
                "新闻链接": "https://example.test/news/1",
                "新闻内容": "贵州茅台 600519 披露增长信息",
            },
        ]
        df = MagicMock()
        df.head.return_value.iterrows.return_value = enumerate(rows)

        items = normalize_news_dataframe(df, "eastmoney-financial-news", 5)

        assert len(items) == 1
        assert items[0].source == "东方财富"
        assert items[0].sentiment == "positive"
        assert items[0].symbols == ["600519"]
        assert items[0].publishedAt == "2026-07-11T09:30:00+08:00"

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
                ),
            ],
        )
        data = response.model_dump()
        assert data["items"][0]["source"] == "东方财富"
        assert data["items"][0]["symbols"] == ["600519"]

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
                ),
            ],
        )
        data = response.model_dump()
        assert data["markets"][0]["symbol"] == "IXIC"
        assert data["markets"][0]["region"] == "US"

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
