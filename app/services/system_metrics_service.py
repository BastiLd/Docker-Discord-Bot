from __future__ import annotations

import shutil
from pathlib import Path

from app.core.utils import human_size

try:
    import psutil
except ImportError:  # pragma: no cover - fallback when dependency is not installed.
    psutil = None


class SystemMetricsService:
    def __init__(self, workspace_dir: Path) -> None:
        self.workspace_dir = workspace_dir
        if psutil is not None:
            psutil.cpu_percent(interval=None)

    def snapshot(self) -> dict:
        cpu_percent = 0.0
        memory_used = None
        memory_total = None

        if psutil is not None:
            cpu_percent = round(psutil.cpu_percent(interval=None), 1)
            memory = psutil.virtual_memory()
            memory_used = int(memory.used)
            memory_total = int(memory.total)

        disk = shutil.disk_usage(self.workspace_dir)
        return {
            "cpu_percent": cpu_percent,
            "memory_used_bytes": memory_used,
            "memory_total_bytes": memory_total,
            "memory_used_human": human_size(memory_used),
            "memory_total_human": human_size(memory_total),
            "disk_used_bytes": int(disk.used),
            "disk_total_bytes": int(disk.total),
            "disk_used_human": human_size(int(disk.used)),
            "disk_total_human": human_size(int(disk.total)),
        }
