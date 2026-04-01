from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone().isoformat(timespec="seconds")


def human_duration(seconds: float | int | None) -> str:
    if seconds is None:
        return "n/a"

    total_seconds = max(int(seconds), 0)
    days, remainder = divmod(total_seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, secs = divmod(remainder, 60)

    chunks: list[str] = []
    if days:
        chunks.append(f"{days}d")
    if hours or chunks:
        chunks.append(f"{hours}h")
    if minutes or chunks:
        chunks.append(f"{minutes}m")
    chunks.append(f"{secs}s")
    return " ".join(chunks)


def human_size(size_bytes: int | None) -> str:
    if size_bytes is None:
        return "--"
    if size_bytes < 1024:
        return f"{size_bytes} B"

    value = float(size_bytes)
    for unit in ("KB", "MB", "GB", "TB"):
        value /= 1024
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}"
    return f"{value:.1f} TB"
