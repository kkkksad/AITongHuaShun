"""Monotonic queue/work timing must not change history admission or fetching."""
import asyncio

import pytest

from research_cache import HistoryFetchLimiter


def test_unsampled_history_timings_are_unknown_instead_of_zero():
    limiter = HistoryFetchLimiter(max_active=1, max_pending=2)
    stats = limiter.stats()
    for name in ["last_queue_wait_ms", "max_queue_wait_ms", "last_work_ms", "max_work_ms"]:
        assert stats[name] is None
    assert stats["accepted"] == stats["completed"] == 0


def test_queue_and_work_intervals_are_separate_and_maxima_do_not_fall():
    async def scenario():
        clock = [0.0]
        limiter = HistoryFetchLimiter(max_active=1, max_pending=2, now=lambda: clock[0])
        first_started, second_started = asyncio.Event(), asyncio.Event()
        first_release, second_release = asyncio.Event(), asyncio.Event()

        async def first_fetch():
            first_started.set()
            await first_release.wait()
            return "first"

        async def second_fetch():
            second_started.set()
            await second_release.wait()
            return "second"

        first = asyncio.create_task(limiter.run(first_fetch))
        await asyncio.wait_for(first_started.wait(), 2)
        clock[0] = 0.5
        second = asyncio.create_task(limiter.run(second_fetch))
        await asyncio.sleep(0)
        try:
            assert limiter.stats()["pending"] == 1
            clock[0] = 2.0
            first_release.set()
            assert await first == "first"
            await asyncio.wait_for(second_started.wait(), 2)
            assert limiter.stats()["last_queue_wait_ms"] == 1500
            assert limiter.stats()["last_work_ms"] == 2000
            clock[0] = 3.0
            second_release.set()
            assert await second == "second"
            stats = limiter.stats()
            assert stats["last_queue_wait_ms"] == stats["max_queue_wait_ms"] == 1500
            assert stats["last_work_ms"] == 1000 and stats["max_work_ms"] == 2000
            assert stats["active"] == stats["pending"] == 0
            assert stats["accepted"] == stats["completed"] == 2
        finally:
            first_release.set()
            second_release.set()
            await asyncio.gather(first, second, return_exceptions=True)
    asyncio.run(scenario())


def test_source_failure_records_its_interval_and_preserves_error_and_recovery():
    async def scenario():
        clock = [1.0]
        limiter = HistoryFetchLimiter(max_active=1, max_pending=2, now=lambda: clock[0])

        async def failed():
            clock[0] = 1.25
            raise RuntimeError("original-source-failure")

        with pytest.raises(RuntimeError, match="original-source-failure"):
            await limiter.run(failed)
        assert limiter.stats()["last_work_ms"] == 250
        assert limiter.stats()["active"] == 0
        clock[0] = 2.0

        async def recovered():
            clock[0] = 2.1
            return "ready"

        assert await limiter.run(recovered) == "ready"
        stats = limiter.stats()
        assert stats["last_work_ms"] == pytest.approx(100) and stats["max_work_ms"] == 250
        assert stats["accepted"] == stats["completed"] == 2
    asyncio.run(scenario())


def test_cancelled_queue_waiter_does_not_become_a_work_sample_or_release_owner():
    async def scenario():
        clock = [0.0]
        limiter = HistoryFetchLimiter(max_active=1, max_pending=2, now=lambda: clock[0])
        started, release = asyncio.Event(), asyncio.Event()

        async def fetch():
            started.set()
            await release.wait()
            return "owner"

        first = asyncio.create_task(limiter.run(fetch))
        await asyncio.wait_for(started.wait(), 2)
        clock[0] = 0.5
        second = asyncio.create_task(limiter.run(fetch))
        await asyncio.sleep(0)
        try:
            second.cancel()
            with pytest.raises(asyncio.CancelledError):
                await second
            stats = limiter.stats()
            assert stats["active"] == 1 and stats["pending"] == 0 and stats["completed"] == 0
            assert stats["last_work_ms"] is None and stats["last_queue_wait_ms"] == 0
            clock[0] = 1.0
            release.set()
            assert await first == "owner"
            assert limiter.stats()["last_work_ms"] == 1000 and limiter.stats()["completed"] == 1
        finally:
            release.set()
            await asyncio.gather(first, second, return_exceptions=True)
    asyncio.run(scenario())


def test_stats_reads_do_not_sample_time_advance_counts_or_start_fetching():
    async def scenario():
        clock_value, clock_reads = [0.0], [0]

        def clock():
            clock_reads[0] += 1
            return clock_value[0]

        limiter = HistoryFetchLimiter(max_active=1, max_pending=2, now=clock)
        started, release = asyncio.Event(), asyncio.Event()

        async def fetch():
            started.set()
            await release.wait()
            return "done"

        task = asyncio.create_task(limiter.run(fetch))
        await asyncio.wait_for(started.wait(), 2)
        try:
            before, reads = limiter.stats(), clock_reads[0]
            clock_value[0] = 100.0
            for _ in range(10):
                assert limiter.stats() == before
            assert clock_reads[0] == reads
            release.set()
            assert await task == "done"
            assert limiter.stats()["last_work_ms"] == 100_000
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(scenario())
