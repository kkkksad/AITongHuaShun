import asyncio

from research_cache import HistoryCacheKey, ResearchHistoryCache


def run(coro):
    return asyncio.run(coro)


def test_fresh_cache_hit_returns_cached_value_without_fetching():
    now = 1_000.0
    cache = ResearchHistoryCache(now=lambda: now)
    key = HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )
    cached_value = {"symbol": "600519", "bars": [{"date": "2026-07-17"}]}
    fetch_count = 0

    async def fetcher():
        nonlocal fetch_count
        fetch_count += 1
        return {"symbol": "600519", "bars": [{"date": "2026-07-18"}]}

    cache.set(key, cached_value, fresh_ttl_sec=60, stale_ttl_sec=120)

    result = run(cache.get_or_fetch(
        key,
        fetcher,
        fresh_ttl_sec=60,
        stale_ttl_sec=120,
    ))

    assert result == cached_value
    assert fetch_count == 0
    assert cache.get_fresh(HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-18",
        days=120,
    )) is None
    assert cache.get_fresh(HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-17",
        days=60,
    )) is None


def test_concurrent_same_key_requests_share_one_in_flight_fetch():
    now = 1_000.0
    cache = ResearchHistoryCache(now=lambda: now)
    key = HistoryCacheKey(
        market="hong-kong",
        symbol="00700",
        adjustment="qfq",
        end_date="2026-07-17",
        days=180,
    )
    started = asyncio.Event()
    release = asyncio.Event()
    fetch_count = 0

    async def fetcher():
        nonlocal fetch_count
        fetch_count += 1
        started.set()
        await release.wait()
        return {"symbol": "00700", "bars": [{"date": "2026-07-17"}]}

    async def scenario():
        first = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=60,
            stale_ttl_sec=120,
        ))
        await started.wait()
        second = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=60,
            stale_ttl_sec=120,
        ))

        await asyncio.sleep(0)
        assert fetch_count == 1

        release.set()
        return await asyncio.gather(first, second)

    results = run(scenario())

    assert results == [
        {"symbol": "00700", "bars": [{"date": "2026-07-17"}]},
        {"symbol": "00700", "bars": [{"date": "2026-07-17"}]},
    ]
    assert fetch_count == 1
    assert cache.get_fresh(key) == {"symbol": "00700", "bars": [{"date": "2026-07-17"}]}
