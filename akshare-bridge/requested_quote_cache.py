"""Bounded per-symbol quote cache with one active batch and no pending queue."""

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass
class _Entry(Generic[T]):
    value: T | None
    retry_at: float


class RequestedQuoteCache(Generic[T]):
    def __init__(
        self,
        fetcher: Callable[[tuple[str, ...]], Awaitable[Mapping[str, T]]],
        *,
        ttl_seconds: float = 10,
        failure_cooldown: float = 20,
        wait_seconds: float = 6,
        max_entries: int = 256,
        max_batch: int = 100,
        clock: Callable[[], float] = time.monotonic,
    ):
        if not 0 < max_batch <= max_entries or min(ttl_seconds, failure_cooldown, wait_seconds) <= 0:
            raise ValueError("Invalid bounded quote cache configuration")
        self._fetcher = fetcher
        self._ttl = ttl_seconds
        self._cooldown = failure_cooldown
        self._wait = wait_seconds
        self._max_entries = max_entries
        self._max_batch = max_batch
        self._clock = clock
        self._entries: OrderedDict[str, _Entry[T]] = OrderedDict()
        self._task: asyncio.Task | None = None
        self._batch: tuple[str, ...] = ()
        self._batches = 0
        self._failed = 0
        self._missing = 0
        self._evictions = 0
        self._deferred = 0

    def _values(self, symbols: tuple[str, ...]) -> dict[str, T]:
        result: dict[str, T] = {}
        for symbol in symbols:
            entry = self._entries.get(symbol)
            if entry is not None:
                self._entries.move_to_end(symbol)
                if entry.value is not None:
                    result[symbol] = entry.value
        return result

    async def _refresh(self, symbols: tuple[str, ...]) -> None:
        self._batches += 1
        try:
            result = await self._fetcher(symbols)
            if not isinstance(result, Mapping):
                raise ValueError("Invalid quote mapping")
        except Exception:
            # Provider exception text may contain URLs or credentials.
            self._failed += 1
            result = {}
        completed_at = self._clock()
        for symbol in symbols:
            quote = result.get(symbol)
            previous = self._entries.get(symbol)
            if quote is None:
                self._missing += 1
            self._entries[symbol] = _Entry(
                value=quote if quote is not None else previous.value if previous else None,
                retry_at=completed_at + (self._ttl if quote is not None else self._cooldown),
            )
            self._entries.move_to_end(symbol)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
                self._evictions += 1

    async def get(self, symbols: tuple[str, ...]) -> dict[str, T]:
        symbols = tuple(dict.fromkeys(symbols))
        if len(symbols) > self._max_batch:
            raise ValueError("Quote batch exceeds admission limit")
        now = self._clock()
        stale = tuple(s for s in symbols if s not in self._entries or self._entries[s].retry_at <= now)
        active = self._task is not None and not self._task.done()
        if stale and not active:
            self._batch = stale
            self._task = asyncio.create_task(self._refresh(stale))
            active = True
        elif stale and active:
            self._deferred += len(set(stale).difference(self._batch))
        values = self._values(symbols)
        if not values and active and set(symbols).intersection(self._batch):
            try:
                # A cancelled/deadline-expired caller must not free the slot
                # while the underlying HTTP thread still runs.
                await asyncio.wait_for(asyncio.shield(self._task), timeout=self._wait)
            except asyncio.TimeoutError:
                pass
            values = self._values(symbols)
        return values

    async def wait_idle(self) -> None:
        if self._task is not None:
            await asyncio.shield(self._task)

    def clear(self) -> None:
        if self._task is not None and not self._task.done():
            raise RuntimeError("Cannot clear an active quote batch")
        self._entries.clear()

    def stats(self) -> dict[str, int]:
        return {
            "entries": len(self._entries), "maxEntries": self._max_entries,
            "active": int(self._task is not None and not self._task.done()),
            "maxActive": 1, "pending": 0, "maxBatch": self._max_batch,
            "batches": self._batches, "failedBatches": self._failed,
            "missingSymbols": self._missing, "evictions": self._evictions,
            "deferredSymbols": self._deferred,
        }
