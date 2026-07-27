from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from collections.abc import Iterator, MutableMapping
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, Literal, TypeVar


HistoricalSeries = TypeVar("HistoricalSeries")
CacheKey = TypeVar("CacheKey")
CacheValue = TypeVar("CacheValue")


class HistoryQueueFullError(RuntimeError):
    """Raised when bounded history work cannot be admitted."""


class HistoryFetchLimiter:
    """Bound active and queued history work before it reaches AkShare."""

    def __init__(self, *, max_active: int = 1, max_pending: int = 8):
        if max_active < 1:
            raise ValueError("max_active must be positive")
        if max_pending < max_active:
            raise ValueError("max_pending must be at least max_active")
        self._max_active = max_active
        self._max_pending = max_pending
        self._loop: asyncio.AbstractEventLoop | None = None
        self._semaphore: asyncio.Semaphore | None = None
        self._admitted = 0
        self._active = 0
        self._accepted = 0
        self._completed = 0
        self._rejected = 0

    async def run(
        self,
        fetcher: Callable[[], Awaitable[CacheValue]],
    ) -> CacheValue:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            if self._admitted > 0:
                self._rejected += 1
                raise HistoryQueueFullError("历史行情队列正在切换，请稍后重试")
            self._loop = loop
            self._semaphore = asyncio.Semaphore(self._max_active)

        if self._admitted >= self._max_pending:
            self._rejected += 1
            raise HistoryQueueFullError("历史行情队列繁忙，请稍后重试")

        assert self._semaphore is not None
        self._admitted += 1
        self._accepted += 1
        try:
            async with self._semaphore:
                self._active += 1
                try:
                    return await fetcher()
                finally:
                    self._active -= 1
                    self._completed += 1
        finally:
            self._admitted -= 1

    def stats(self) -> dict[str, int]:
        return {
            "active": self._active,
            "pending": max(0, self._admitted - self._active),
            "max_active": self._max_active,
            "max_pending": self._max_pending,
            "accepted": self._accepted,
            "completed": self._completed,
            "rejected": self._rejected,
        }


@dataclass(slots=True)
class TTLCacheEntry(Generic[CacheValue]):
    value: CacheValue
    expires_at: float


class BoundedTTLCache(MutableMapping[CacheKey, CacheValue], Generic[CacheKey, CacheValue]):
    """Small in-process TTL cache with an LRU capacity bound."""

    def __init__(
        self,
        *,
        max_entries: int,
        ttl_sec: float,
        now: Callable[[], float] | None = None,
    ):
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        if ttl_sec <= 0:
            raise ValueError("ttl_sec must be positive")
        self._max_entries = max_entries
        self._ttl_sec = ttl_sec
        self._now = now or time.monotonic
        self._entries: OrderedDict[CacheKey, TTLCacheEntry[CacheValue]] = OrderedDict()
        self._evictions = 0
        self._expired_pruned = 0

    def __getitem__(self, key: CacheKey) -> CacheValue:
        self._prune_expired()
        entry = self._entries.get(key)
        if entry is None:
            raise KeyError(key)
        self._entries.move_to_end(key)
        return entry.value

    def __setitem__(self, key: CacheKey, value: CacheValue) -> None:
        self._prune_expired()
        self._entries[key] = TTLCacheEntry(
            value=value,
            expires_at=self._now() + self._ttl_sec,
        )
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
            self._evictions += 1

    def __delitem__(self, key: CacheKey) -> None:
        del self._entries[key]

    def __iter__(self) -> Iterator[CacheKey]:
        self._prune_expired()
        return iter(tuple(self._entries))

    def __len__(self) -> int:
        self._prune_expired()
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def stats(self) -> dict[str, int]:
        self._prune_expired()
        return {
            "entries": len(self._entries),
            "max_entries": self._max_entries,
            "evictions": self._evictions,
            "expired_pruned": self._expired_pruned,
        }

    def _prune_expired(self) -> int:
        now = self._now()
        expired_keys = [
            key
            for key, entry in self._entries.items()
            if now >= entry.expires_at
        ]
        for key in expired_keys:
            self._entries.pop(key, None)
        self._expired_pruned += len(expired_keys)
        return len(expired_keys)


@dataclass(frozen=True, slots=True)
class HistoryCacheKey:
    market: Literal[
        "a-share",
        "a-share-sector",
        "a-share-index",
        "hong-kong",
        "futures",
        "global-index",
    ]
    symbol: str
    adjustment: str
    end_date: str
    days: int
    source: str = ""


@dataclass(slots=True)
class CacheEntry(Generic[HistoricalSeries]):
    value: HistoricalSeries
    fetched_at: float
    fresh_until: float
    stale_until: float


class ResearchHistoryCache(Generic[HistoricalSeries]):
    def __init__(
        self,
        now: Callable[[], float] | None = None,
        *,
        max_entries: int = 128,
    ):
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        self._now = now or time.monotonic
        self._max_entries = max_entries
        self._entries: OrderedDict[
            HistoryCacheKey,
            CacheEntry[HistoricalSeries],
        ] = OrderedDict()
        self._in_flight: dict[HistoryCacheKey, asyncio.Task[HistoricalSeries]] = {}
        self._lock = asyncio.Lock()
        self._stats = {"fresh_hits": 0, "stale_hits": 0, "blocking_misses": 0}
        self._evictions = 0
        self._expired_pruned = 0

    def stats(self) -> dict[str, int]:
        """Return a snapshot of cache lookup outcomes for observability."""
        self.prune_expired()
        return {
            **self._stats,
            "entries": len(self._entries),
            "max_entries": self._max_entries,
            "evictions": self._evictions,
            "expired_pruned": self._expired_pruned,
            "in_flight": len(self._in_flight),
        }

    def get_fresh(self, key: HistoryCacheKey) -> HistoricalSeries | None:
        entry = self._fresh_entry(key)
        return None if entry is None else entry.value

    def set(
        self,
        key: HistoryCacheKey,
        value: HistoricalSeries,
        *,
        fresh_ttl_sec: float,
        stale_ttl_sec: float,
    ) -> CacheEntry[HistoricalSeries]:
        self.prune_expired()
        fetched_at = self._now()
        entry = CacheEntry(
            value=value,
            fetched_at=fetched_at,
            fresh_until=fetched_at + fresh_ttl_sec,
            stale_until=fetched_at + stale_ttl_sec,
        )
        self._entries[key] = entry
        self._entries.move_to_end(key)
        self._enforce_capacity()
        return entry

    def clear(self) -> None:
        self._entries.clear()
        for task in self._in_flight.values():
            task.cancel()
        self._in_flight.clear()

    def prune_expired(self) -> int:
        """Remove entries whose stale fallback window has elapsed."""
        now = self._now()
        expired_keys = [
            key
            for key, entry in self._entries.items()
            if now >= entry.stale_until and key not in self._in_flight
        ]
        for key in expired_keys:
            self._entries.pop(key, None)
        self._expired_pruned += len(expired_keys)
        return len(expired_keys)

    async def get_or_fetch(
        self,
        key: HistoryCacheKey,
        fetcher: Callable[[], Awaitable[HistoricalSeries]],
        *,
        fresh_ttl_sec: float,
        stale_ttl_sec: float,
    ) -> HistoricalSeries:
        fresh_entry = self._fresh_entry(key)
        if fresh_entry is not None:
            self._stats["fresh_hits"] += 1
            return fresh_entry.value

        stale_entry = self._stale_entry(key)
        if stale_entry is not None:
            async with self._lock:
                fresh_entry = self._fresh_entry(key)
                if fresh_entry is not None:
                    return fresh_entry.value

                stale_entry = self._stale_entry(key)
                if stale_entry is not None:
                    self._stats["stale_hits"] += 1
                    self._get_or_start_in_flight(
                        key,
                        fetcher,
                        fresh_ttl_sec=fresh_ttl_sec,
                        stale_ttl_sec=stale_ttl_sec,
                    )
                    return stale_entry.value

        async with self._lock:
            fresh_entry = self._fresh_entry(key)
            if fresh_entry is not None:
                return fresh_entry.value

            stale_entry = self._stale_entry(key)
            if stale_entry is not None:
                self._get_or_start_in_flight(
                    key,
                    fetcher,
                    fresh_ttl_sec=fresh_ttl_sec,
                    stale_ttl_sec=stale_ttl_sec,
                )
                return stale_entry.value

            self._stats["blocking_misses"] += 1
            task = self._get_or_start_in_flight(
                key,
                fetcher,
                fresh_ttl_sec=fresh_ttl_sec,
                stale_ttl_sec=stale_ttl_sec,
            )

        return await task

    def _get_or_start_in_flight(
        self,
        key: HistoryCacheKey,
        fetcher: Callable[[], Awaitable[HistoricalSeries]],
        *,
        fresh_ttl_sec: float,
        stale_ttl_sec: float,
    ) -> asyncio.Task[HistoricalSeries]:
        task = self._in_flight.get(key)
        if task is not None and task.done():
            self._discard_completed_task(key, task)
            task = None

        if task is None:
            task = asyncio.create_task(self._fetch_and_store(
                key,
                fetcher,
                fresh_ttl_sec=fresh_ttl_sec,
                stale_ttl_sec=stale_ttl_sec,
            ))
            self._in_flight[key] = task
            task.add_done_callback(
                lambda completed_task: self._discard_completed_task(key, completed_task),
            )

        return task

    async def _fetch_and_store(
        self,
        key: HistoryCacheKey,
        fetcher: Callable[[], Awaitable[HistoricalSeries]],
        *,
        fresh_ttl_sec: float,
        stale_ttl_sec: float,
    ) -> HistoricalSeries:
        value = await fetcher()
        self.set(
            key,
            value,
            fresh_ttl_sec=fresh_ttl_sec,
            stale_ttl_sec=stale_ttl_sec,
        )
        return value

    def _fresh_entry(
        self,
        key: HistoryCacheKey,
    ) -> CacheEntry[HistoricalSeries] | None:
        entry = self._entries.get(key)
        if entry is None or self._now() >= entry.fresh_until:
            return None
        self._entries.move_to_end(key)
        return entry

    def _stale_entry(
        self,
        key: HistoryCacheKey,
    ) -> CacheEntry[HistoricalSeries] | None:
        entry = self._entries.get(key)
        now = self._now()
        if entry is None or now < entry.fresh_until or now >= entry.stale_until:
            return None
        self._entries.move_to_end(key)
        return entry

    def _discard_completed_task(
        self,
        key: HistoryCacheKey,
        task: asyncio.Task[HistoricalSeries],
    ) -> None:
        if not task.cancelled():
            task.exception()
        if self._in_flight.get(key) is task:
            self._in_flight.pop(key, None)
        self._enforce_capacity()

    def _enforce_capacity(self) -> None:
        while len(self._entries) > self._max_entries:
            evicted_key = next(
                (
                    candidate
                    for candidate in self._entries
                    if candidate not in self._in_flight
                ),
                None,
            )
            if evicted_key is None:
                return
            self._entries.pop(evicted_key, None)
            self._evictions += 1
