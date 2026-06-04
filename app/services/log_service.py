from __future__ import annotations

import asyncio
import secrets
from collections import deque
from datetime import datetime
from pathlib import Path

from app.core.utils import utc_now


class LogService:
    SNAPSHOT_LIMIT = 10

    def __init__(self, log_dir: Path, max_buffer_lines: int = 800) -> None:
        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._files = {
            "bot": self.log_dir / "bot.log",
            "system": self.log_dir / "system.log",
        }
        self._cleared_dir = self.log_dir / "cleared"
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

            self._broadcast(channel, line)

    async def clear(self, channel: str) -> dict | None:
        """Wipe a log channel after saving its current content as a restorable snapshot.

        Returns the metadata of the created snapshot, or ``None`` when the channel
        was already empty (nothing worth keeping).
        """
        if channel not in self._files:
            raise ValueError(f"Unbekannter Log-Kanal: {channel}")
        async with self._lock:
            snapshot = self._save_snapshot(channel)
            self._buffers[channel].clear()
            self._files[channel].write_text("", encoding="utf-8")
            self._broadcast(channel, "[--- log cleared ---]")
            return snapshot

    def list_snapshots(self, channel: str) -> list[dict]:
        """Return snapshot metadata for a channel, newest first."""
        if channel not in self._files:
            raise ValueError(f"Unbekannter Log-Kanal: {channel}")
        snapshots: list[dict] = []
        for path in self._snapshot_paths(channel):
            snapshots.append(self._snapshot_meta(channel, path))
        return snapshots

    async def restore(self, channel: str, snapshot_id: str | None = None) -> list[str]:
        """Restore a snapshot (newest by default) back into the channel.

        Returns the restored lines so the caller can refresh the live view.
        """
        if channel not in self._files:
            raise ValueError(f"Unbekannter Log-Kanal: {channel}")
        async with self._lock:
            path = self._resolve_snapshot_path(channel, snapshot_id)
            if path is None:
                raise ValueError("Kein Snapshot zum Wiederherstellen vorhanden.")

            content = path.read_text(encoding="utf-8", errors="replace")
            lines = content.splitlines()
            self._files[channel].write_text(
                f"{content}\n" if content and not content.endswith("\n") else content,
                encoding="utf-8",
            )
            self._buffers[channel].clear()
            self._buffers[channel].extend(lines[-self._buffers[channel].maxlen:])

            self._broadcast(channel, "[--- log restored ---]")
            return list(self._buffers[channel])

    def _broadcast(self, channel: str, line: str) -> None:
        stale_queues: list[asyncio.Queue[str]] = []
        for queue in list(self._subscribers[channel]):
            try:
                queue.put_nowait(line)
            except asyncio.QueueFull:
                stale_queues.append(queue)
        for queue in stale_queues:
            self._subscribers[channel].discard(queue)

    def _channel_snapshot_dir(self, channel: str) -> Path:
        return self._cleared_dir / channel

    def _snapshot_paths(self, channel: str) -> list[Path]:
        directory = self._channel_snapshot_dir(channel)
        if not directory.exists():
            return []
        return sorted(directory.glob("*.log"), key=lambda item: item.name, reverse=True)

    def _resolve_snapshot_path(self, channel: str, snapshot_id: str | None) -> Path | None:
        paths = self._snapshot_paths(channel)
        if not paths:
            return None
        if snapshot_id is None:
            return paths[0]
        for path in paths:
            if path.stem == snapshot_id:
                return path
        return None

    def _save_snapshot(self, channel: str) -> dict | None:
        content = self._files[channel].read_text(encoding="utf-8", errors="replace")
        if not content.strip():
            return None

        directory = self._channel_snapshot_dir(channel)
        directory.mkdir(parents=True, exist_ok=True)

        # Timestamp prefix keeps snapshots sortable; the random suffix avoids
        # collisions when two clears land in the same microsecond.
        snapshot_id = f"{utc_now().strftime('%Y%m%d-%H%M%S-%f')}-{secrets.token_hex(3)}"
        path = directory / f"{snapshot_id}.log"
        path.write_text(content, encoding="utf-8")

        self._prune_snapshots(channel)
        return self._snapshot_meta(channel, path)

    def _prune_snapshots(self, channel: str) -> None:
        paths = self._snapshot_paths(channel)
        for stale in paths[self.SNAPSHOT_LIMIT:]:
            stale.unlink(missing_ok=True)

    def _snapshot_meta(self, channel: str, path: Path) -> dict:
        try:
            line_count = sum(1 for _ in path.open("r", encoding="utf-8", errors="replace"))
        except OSError:
            line_count = 0
        cleared_at = utc_now().astimezone()
        try:
            cleared_at = datetime.fromtimestamp(path.stat().st_mtime).astimezone()
        except OSError:
            pass
        return {
            "id": path.stem,
            "channel": channel,
            "cleared_at": cleared_at.isoformat(timespec="seconds"),
            "line_count": line_count,
        }

    def _preload(self, channel: str, path: Path, max_lines: int = 300) -> None:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-max_lines:]
        self._buffers[channel].extend(lines)
