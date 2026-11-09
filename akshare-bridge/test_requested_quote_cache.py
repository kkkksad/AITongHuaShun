import asyncio
from unittest.mock import AsyncMock

import pytest

from requested_quote_cache import RequestedQuoteCache


def test_cold_read_keeps_actual_quote_and_ttl_starts_at_completion():
    async def scenario():
        clock = [0.0]
        async def fetch(symbols):
            clock[0] = 20.0
            return {s: {"price": 100, "updatedAt": "old-source-time"} for s in symbols}
        fetcher = AsyncMock(side_effect=fetch)
        cache = RequestedQuoteCache(fetcher, clock=lambda: clock[0])
        assert (await cache.get(("a", "a")))["a"]["updatedAt"] == "old-source-time"
        clock[0] = 29.0
        assert (await cache.get(("a",)))["a"]["price"] == 100
        assert fetcher.call_count == 1
        assert fetcher.call_args.args[0] == ("a",)
    asyncio.run(scenario())


def test_stale_read_returns_immediately_and_refresh_does_not_mutate_old_quote():
    async def scenario():
        clock = [0.0]
        gate = asyncio.Event()
        calls = []
        async def fetch(symbols):
            calls.append(symbols)
            if len(calls) > 1:
                await gate.wait()
            return {s: {"price": len(calls), "updatedAt": "source-time"} for s in symbols}
        cache = RequestedQuoteCache(fetch, clock=lambda: clock[0])
        first = await cache.get(("a",))
        clock[0] = 11.0
        stale = await asyncio.wait_for(cache.get(("a",)), timeout=0.1)
        await asyncio.sleep(0)
        assert stale == first
        assert len(calls) == 2
        gate.set()
        await cache.wait_idle()
        assert (await cache.get(("a",)))["a"]["price"] == 2
        assert first["a"]["price"] == 1
    asyncio.run(scenario())


def test_failure_retains_source_time_and_cools_only_the_requested_symbols():
    async def scenario():
        clock = [0.0]
        calls = []
        async def fetch(symbols):
            calls.append(symbols)
            if len(calls) == 2:
                raise RuntimeError("private provider credential must not enter stats")
            return {s: "original-source-time" for s in symbols}
        cache = RequestedQuoteCache(fetch, clock=lambda: clock[0])
        await cache.get(("a",))
        clock[0] = 11.0
        assert await cache.get(("a",)) == {"a": "original-source-time"}
        await cache.wait_idle()
        assert await cache.get(("a",)) == {"a": "original-source-time"}
        assert len(calls) == 2
        assert await cache.get(("b",)) == {"b": "original-source-time"}
        assert len(calls) == 3
        assert cache.stats()["failedBatches"] == 1
        assert "private" not in str(cache.stats())
    asyncio.run(scenario())


def test_partial_result_cools_missing_symbol_without_inventing_a_quote():
    async def scenario():
        fetcher = AsyncMock(return_value={"a": "source-a", "unrequested": "ignore"})
        cache = RequestedQuoteCache(fetcher)
        assert await cache.get(("a", "b")) == {"a": "source-a"}
        assert await cache.get(("b",)) == {}
        assert fetcher.call_count == 1
        assert cache.stats()["entries"] == 2
        assert cache.stats()["missingSymbols"] == 1
    asyncio.run(scenario())


def test_overlapping_cold_requests_share_work_and_disjoint_requests_do_not_queue():
    async def scenario():
        gate = asyncio.Event()
        fetcher = AsyncMock(side_effect=lambda symbols: None)
        async def fetch(symbols):
            await gate.wait()
            return {s: s for s in symbols}
        fetcher.side_effect = fetch
        cache = RequestedQuoteCache(fetcher)
        first = asyncio.create_task(cache.get(("a", "b")))
        await asyncio.sleep(0)
        second = asyncio.create_task(cache.get(("b",)))
        await asyncio.sleep(0)
        assert await cache.get(("c",)) == {}
        assert cache.stats()["active"] == 1
        assert fetcher.call_count == 1
        gate.set()
        assert await first == {"a": "a", "b": "b"}
        assert await second == {"b": "b"}
        assert await cache.get(("c",)) == {"c": "c"}
        assert fetcher.call_count == 2
    asyncio.run(scenario())


def test_cancelled_caller_does_not_release_the_slot_or_cancel_the_shared_fetch():
    async def scenario():
        gate = asyncio.Event()
        async def fetch(symbols):
            await gate.wait()
            return {s: "source" for s in symbols}
        fetcher = AsyncMock(side_effect=fetch)
        cache = RequestedQuoteCache(fetcher)
        first = asyncio.create_task(cache.get(("a",)))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert cache.stats()["active"] == 1
        second = asyncio.create_task(cache.get(("a",)))
        await asyncio.sleep(0)
        gate.set()
        assert await second == {"a": "source"}
        assert fetcher.call_count == 1
    asyncio.run(scenario())


def test_response_deadline_keeps_background_slot_and_avoids_retry_burst():
    async def scenario():
        gate = asyncio.Event()
        async def fetch(symbols):
            await gate.wait()
            return {s: "source" for s in symbols}
        fetcher = AsyncMock(side_effect=fetch)
        cache = RequestedQuoteCache(fetcher, wait_seconds=0.001)
        assert await cache.get(("a",)) == {}
        assert await cache.get(("a",)) == {}
        assert cache.stats()["active"] == 1
        assert fetcher.call_count == 1
        gate.set()
        await cache.wait_idle()
        assert await cache.get(("a",)) == {"a": "source"}
    asyncio.run(scenario())


def test_lru_and_negative_entries_share_a_fixed_capacity():
    async def scenario():
        async def fetch(symbols):
            return {s: s for s in symbols if s != "b"}
        fetcher = AsyncMock(side_effect=fetch)
        cache = RequestedQuoteCache(fetcher, max_entries=2, max_batch=2)
        assert await cache.get(("a", "b")) == {"a": "a"}
        assert await cache.get(("a",)) == {"a": "a"}
        assert await cache.get(("c",)) == {"c": "c"}
        assert cache.stats()["entries"] == 2
        assert cache.stats()["evictions"] == 1
        await cache.get(("b",))
        assert fetcher.call_count == 3
        assert cache.stats()["entries"] == 2
    asyncio.run(scenario())


def test_oversize_batch_rejected_before_any_fetch():
    async def scenario():
        fetcher = AsyncMock()
        cache = RequestedQuoteCache(fetcher, max_entries=2, max_batch=2)
        with pytest.raises(ValueError):
            await cache.get(("a", "b", "c"))
        fetcher.assert_not_called()
    asyncio.run(scenario())
