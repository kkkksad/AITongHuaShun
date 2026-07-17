from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, Literal, TypeVar


HistoricalSeries = TypeVar("HistoricalSeries")


@dataclass(frozen=True, slots=True)
class HistoryCacheKey:
    market: Literal["a-share", "hong-kong"]
    symbol: str
    adjustment: str
    end_date: str
    days: int


@dataclass(slots=True)
class CacheEntry(Generic[HistoricalSeries]):
    value: HistoricalSeries
    fetched_at: float
    fresh_until: float
    stale_until: float


class ResearchHistoryCache(Generic[HistoricalSeries]):
    def __init__(self, now: Callable[[], float] | None = None):
        self._now = now or time.monotonic
        self._entries: dict[HistoryCacheKey, CacheEntry[HistoricalSeries]] = {}
        self._in_flight: dict[HistoryCacheKey, asyncio.Task[HistoricalSeries]] = {}
        self._lock = asyncio.Lock()

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
        fetched_at = self._now()
        entry = CacheEntry(
            value=value,
            fetched_at=fetched_at,
            fresh_until=fetched_at + fresh_ttl_sec,
            stale_until=fetched_at + stale_ttl_sec,
        )
        self._entries[key] = entry
        return entry

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
            return fresh_entry.value

        stale_entry = self._stale_entry(key)
        if stale_entry is not None:
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
        return entry

    def _stale_entry(
        self,
        key: HistoryCacheKey,
    ) -> CacheEntry[HistoricalSeries] | None:
        entry = self._entries.get(key)
        now = self._now()
        if entry is None or now < entry.fresh_until or now >= entry.stale_until:
            return None
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
