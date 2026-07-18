import asyncio
from contextlib import suppress

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


def test_stale_cache_hit_returns_old_value_and_refreshes_in_background():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    key = HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )
    cached_value = {"symbol": "600519", "bars": [{"date": "2026-07-16"}]}
    refreshed_value = {"symbol": "600519", "bars": [{"date": "2026-07-17"}]}
    started = asyncio.Event()
    release = asyncio.Event()
    fetch_count = 0

    async def fetcher():
        nonlocal fetch_count
        fetch_count += 1
        started.set()
        await release.wait()
        return refreshed_value

    cache.set(key, cached_value, fresh_ttl_sec=10, stale_ttl_sec=60)
    clock["now"] = 1_015.0

    async def scenario():
        stale_hit = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=60,
        ))
        await asyncio.wait_for(started.wait(), timeout=1)
        await asyncio.sleep(0)

        try:
            assert stale_hit.done()
            assert stale_hit.result() == cached_value
            assert fetch_count == 1
        finally:
            release.set()
            if not stale_hit.done():
                with suppress(Exception):
                    await stale_hit

        for _ in range(10):
            if cache.get_fresh(key) == refreshed_value:
                break
            await asyncio.sleep(0)

        assert cache.get_fresh(key) == refreshed_value

    run(scenario())


def test_stale_background_refresh_is_single_flight_for_same_key():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    key = HistoryCacheKey(
        market="hong-kong",
        symbol="00700",
        adjustment="qfq",
        end_date="2026-07-17",
        days=180,
    )
    cached_value = {"symbol": "00700", "bars": [{"date": "2026-07-16"}]}
    refreshed_value = {"symbol": "00700", "bars": [{"date": "2026-07-17"}]}
    started = asyncio.Event()
    release = asyncio.Event()
    fetch_count = 0

    async def fetcher():
        nonlocal fetch_count
        fetch_count += 1
        started.set()
        await release.wait()
        return refreshed_value

    cache.set(key, cached_value, fresh_ttl_sec=10, stale_ttl_sec=60)
    clock["now"] = 1_015.0

    async def scenario():
        first = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=60,
        ))
        await asyncio.wait_for(started.wait(), timeout=1)

        second = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=60,
        ))
        third = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=60,
        ))
        await asyncio.sleep(0)

        try:
            assert first.done()
            assert second.done()
            assert third.done()
            assert [first.result(), second.result(), third.result()] == [
                cached_value,
                cached_value,
                cached_value,
            ]
            assert fetch_count == 1
        finally:
            release.set()
            await asyncio.gather(first, second, third, return_exceptions=True)

        for _ in range(10):
            if cache.get_fresh(key) == refreshed_value:
                break
            await asyncio.sleep(0)

        assert cache.get_fresh(key) == refreshed_value

    run(scenario())


def test_stale_background_refresh_failure_keeps_old_entry():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    key = HistoryCacheKey(
        market="a-share",
        symbol="000001",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )
    cached_value = {"symbol": "000001", "bars": [{"date": "2026-07-16"}]}
    started = asyncio.Event()
    fetch_count = 0

    async def fetcher():
        nonlocal fetch_count
        fetch_count += 1
        started.set()
        raise RuntimeError("upstream unavailable")

    cache.set(key, cached_value, fresh_ttl_sec=10, stale_ttl_sec=60)
    clock["now"] = 1_015.0

    async def scenario():
        result = await cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=60,
        )
        assert result == cached_value
        await asyncio.wait_for(started.wait(), timeout=1)

        for _ in range(10):
            if fetch_count == 1 and cache._in_flight.get(key) is None:
                break
            await asyncio.sleep(0)

        assert fetch_count == 1
        assert cache._entries[key].value == cached_value
        assert cache._entries[key].fetched_at == 1_000.0

    run(scenario())


def test_expired_cache_blocks_until_new_value_is_fetched():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    key = HistoryCacheKey(
        market="a-share",
        symbol="300750",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )
    cached_value = {"symbol": "300750", "bars": [{"date": "2026-07-16"}]}
    refreshed_value = {"symbol": "300750", "bars": [{"date": "2026-07-17"}]}
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetcher():
        started.set()
        await release.wait()
        return refreshed_value

    cache.set(key, cached_value, fresh_ttl_sec=10, stale_ttl_sec=20)
    clock["now"] = 1_025.0

    async def scenario():
        expired_hit = asyncio.create_task(cache.get_or_fetch(
            key,
            fetcher,
            fresh_ttl_sec=10,
            stale_ttl_sec=20,
        ))
        await asyncio.wait_for(started.wait(), timeout=1)
        await asyncio.sleep(0)
        assert not expired_hit.done()

        release.set()
        assert await expired_hit == refreshed_value
        assert cache.get_fresh(key) == refreshed_value

    run(scenario())


def test_prune_expired_removes_only_entries_past_stale_window():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    expired_key = HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )
    stale_key = HistoryCacheKey(
        market="hong-kong",
        symbol="00700",
        adjustment="qfq",
        end_date="2026-07-17",
        days=180,
    )
    fresh_key = HistoryCacheKey(
        market="a-share",
        symbol="300750",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )

    cache.set(expired_key, "expired", fresh_ttl_sec=5, stale_ttl_sec=10)
    cache.set(stale_key, "stale", fresh_ttl_sec=5, stale_ttl_sec=30)
    clock["now"] = 1_015.0
    cache.set(fresh_key, "fresh", fresh_ttl_sec=10, stale_ttl_sec=20)

    assert cache.prune_expired() == 1
    assert expired_key not in cache._entries
    assert cache._entries[stale_key].value == "stale"


def test_cache_stats_distinguish_fresh_stale_and_blocking_miss():
    clock = {"now": 1_000.0}
    cache = ResearchHistoryCache(now=lambda: clock["now"])
    key = HistoryCacheKey(
        market="a-share",
        symbol="600519",
        adjustment="qfq",
        end_date="2026-07-17",
        days=120,
    )

    async def fetcher():
        return "new"
    assert run(cache.get_or_fetch(key, fetcher, fresh_ttl_sec=10, stale_ttl_sec=30)) == "new"
    assert run(cache.get_or_fetch(key, fetcher, fresh_ttl_sec=10, stale_ttl_sec=30)) == "new"
    clock["now"] = 1_015.0
    assert run(cache.get_or_fetch(key, fetcher, fresh_ttl_sec=10, stale_ttl_sec=30)) == "new"
    assert cache.stats() == {"fresh_hits": 1, "stale_hits": 1, "blocking_misses": 1}
