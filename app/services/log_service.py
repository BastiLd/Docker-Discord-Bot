from __future__ import annotations

import asyncio
from collections import deque
from pathlib import Path

from app.core.utils import utc_now


class LogService:
    def __init__(self, log_dir: Path, max_buffer_lines: int = 800) -> None:
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._files = {
            "bot": self.log_dir / "bot.log",
            "system": self.log_dir / "system.log",
        }
        self._buffers = {name: deque(maxlen=max_buffer_lines) for name in self._files}
        self._subscribers = {name: set() for name in self._files}
        self._lock = asyncio.Lock()

        for channel, path in self._files.items():
            path.touch(exist_ok=True)
            self._preload(channel, path)

    def file_for(self, channel: str) -> Path:
        return self._files[channel]

    def tail(self, channel: str, limit: int = 200) -> list[str]:
        return list(self._buffers[channel])[-limit:]

    def subscribe(self, channel: str) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
        self._subscribers[channel].add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue[str]) -> None:
        self._subscribers[channel].discard(queue)

    async def write(self, channel: str, message: str) -> None:
        text = message.rstrip("\n")
        if not text:
            return

        timestamp = utc_now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {text}"

        async with self._lock:
            self._buffers[channel].append(line)
            with self._files[channel].open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")

            stale_queues: list[asyncio.Queue[str]] = []
            for queue in list(self._subscribers[channel]):
                try:
                    queue.put_nowait(line)
                except asyncio.QueueFull:
                    stale_queues.append(queue)
            for queue in stale_queues:
                self._subscribers[channel].discard(queue)

    def _preload(self, channel: str, path: Path, max_lines: int = 300) -> None:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-max_lines:]
        self._buffers[channel].extend(lines)
