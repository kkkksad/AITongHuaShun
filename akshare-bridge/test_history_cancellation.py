"""A caller owns its wait, not the shared provider work or its admission slot."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from research_cache import HistoryCacheKey, HistoryFetchLimiter, HistoryQueueFullError, ResearchHistoryCache


def key(symbol="000001"):
    return HistoryCacheKey(market="a-share", symbol=symbol, adjustment="qfq",
                           end_date="2026-11-09", days=120)


async def lookup(cache, fetcher, symbol="000001"):
    return await cache.get_or_fetch(key(symbol), fetcher, fresh_ttl_sec=10, stale_ttl_sec=30)


def test_one_cancelled_waiter_does_not_cancel_other_waiter_or_repeat_the_source():
    async def scenario():
        cache = ResearchHistoryCache()
        started, release = asyncio.Event(), asyncio.Event()
        calls = 0

        async def fetch():
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return {"source": "actual", "date": "2026-11-09"}

        first = asyncio.create_task(lookup(cache, fetch))
        await asyncio.wait_for(started.wait(), 2)
        second = asyncio.create_task(lookup(cache, fetch))
        await asyncio.sleep(0)
        try:
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            release.set()
            assert await second == {"source": "actual", "date": "2026-11-09"}
            assert await lookup(cache, fetch) == await second
            assert calls == 1
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)
    asyncio.run(scenario())


def test_one_caller_deadline_keeps_shared_warming_alive():
    async def scenario():
        cache = ResearchHistoryCache()
        started, release = asyncio.Event(), asyncio.Event()

        async def fetch():
            started.set()
            await release.wait()
            return "ready"

        first = asyncio.create_task(lookup(cache, fetch))
        await asyncio.wait_for(started.wait(), 2)
        try:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(first, timeout=0.01)
            assert cache.stats()["in_flight"] == 1
            release.set()
            assert await lookup(cache, fetch) == "ready"
        finally:
            release.set()
            await asyncio.gather(first, return_exceptions=True)
    asyncio.run(scenario())


def test_provider_failure_still_reaches_remaining_waiter_and_next_read_can_retry():
    async def scenario():
        cache = ResearchHistoryCache()
        started, release = asyncio.Event(), asyncio.Event()
        calls = 0

        async def fetch():
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            if calls == 1:
                raise RuntimeError("source-failed")
            return "recovered"

        first = asyncio.create_task(lookup(cache, fetch))
        await asyncio.wait_for(started.wait(), 2)
        second = asyncio.create_task(lookup(cache, fetch))
        await asyncio.sleep(0)
        try:
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            release.set()
            with pytest.raises(RuntimeError, match="source-failed"):
                await second
            assert await lookup(cache, fetch) == "recovered"
            assert calls == 2
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)
    asyncio.run(scenario())


def test_caller_cancellation_keeps_real_executor_work_in_the_limiter_budget():
    async def scenario():
        cache = ResearchHistoryCache()
        limiter = HistoryFetchLimiter(max_active=1, max_pending=2)
        loop = asyncio.get_running_loop()
        started = asyncio.Event()
        release = threading.Event()
        requests = []
        with ThreadPoolExecutor(max_workers=2) as executor:
            def provider():
                loop.call_soon_threadsafe(started.set)
                if not release.wait(timeout=5):
                    raise RuntimeError("test source was not released")
                return "first-source"

            async def threaded_fetch():
                return await limiter.run(lambda: loop.run_in_executor(executor, provider))

            async def next_fetch():
                async def result():
                    return "next-source"
                return await limiter.run(result)

            first = asyncio.create_task(lookup(cache, threaded_fetch))
            requests.append(first)
            await asyncio.wait_for(started.wait(), 2)
            try:
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first
                assert limiter.stats()["active"] == 1
                other = asyncio.create_task(lookup(cache, next_fetch, "600519"))
                requests.append(other)
                for _ in range(3):
                    await asyncio.sleep(0)
                assert limiter.stats()["pending"] == 1
                with pytest.raises(HistoryQueueFullError):
                    await lookup(cache, next_fetch, "601318")
                release.set()
                assert await lookup(cache, threaded_fetch) == "first-source"
                assert await other == "next-source"
                assert limiter.stats()["active"] == 0
                assert limiter.stats()["pending"] == 0
                assert limiter.stats()["completed"] == 2
            finally:
                release.set()
                await asyncio.gather(*requests, return_exceptions=True)
    asyncio.run(scenario())


def test_all_callers_may_leave_while_shared_work_finishes_for_a_later_read():
    async def scenario():
        cache = ResearchHistoryCache()
        started, release = asyncio.Event(), asyncio.Event()
        calls = 0

        async def fetch():
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return "warm"

        first = asyncio.create_task(lookup(cache, fetch))
        await asyncio.wait_for(started.wait(), 2)
        second = asyncio.create_task(lookup(cache, fetch))
        await asyncio.sleep(0)
        try:
            first.cancel()
            second.cancel()
            await asyncio.gather(first, second, return_exceptions=True)
            assert cache.stats()["in_flight"] == 1
            release.set()
            assert await lookup(cache, fetch) == "warm"
            assert calls == 1
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)
    asyncio.run(scenario())
