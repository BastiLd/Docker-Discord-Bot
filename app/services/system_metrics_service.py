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

    def snapshot(self, pid: int | None = None) -> dict:
        cpu_percent = 0.0
        memory_used = None
        memory_total = None
        process_cpu_percent = 0.0
        process_memory_used = 0

        if psutil is not None:
            cpu_percent = round(psutil.cpu_percent(interval=None), 1)
            memory = psutil.virtual_memory()
            memory_used = int(memory.used)
            memory_total = int(memory.total)
            process_cpu_percent, process_memory_used = self._process_usage(pid)

        disk = shutil.disk_usage(self.workspace_dir)
        workspace_size = self._directory_size(self.workspace_dir)
        return {
            "cpu_percent": cpu_percent,
            "bot_cpu_percent": process_cpu_percent,
            "memory_used_bytes": memory_used,
            "memory_total_bytes": memory_total,
            "memory_used_human": human_size(memory_used),
            "memory_total_human": human_size(memory_total),
            "bot_memory_used_bytes": process_memory_used,
            "bot_memory_used_human": human_size(process_memory_used),
            "workspace_used_bytes": workspace_size,
            "workspace_used_human": human_size(workspace_size),
            "disk_used_bytes": int(disk.used),
            "disk_total_bytes": int(disk.total),
            "disk_used_human": human_size(int(disk.used)),
            "disk_total_human": human_size(int(disk.total)),
        }

    def _process_usage(self, pid: int | None) -> tuple[float, int]:
        if psutil is None or not pid:
            return 0.0, 0
        try:
            process = psutil.Process(pid)
            processes = [process, *process.children(recursive=True)]
            cpu_percent = sum(item.cpu_percent(interval=None) for item in processes if item.is_running())
            memory_used = sum(item.memory_info().rss for item in processes if item.is_running())
        except (psutil.Error, OSError):
            return 0.0, 0
        return round(cpu_percent, 1), int(memory_used)

    def _directory_size(self, path: Path) -> int:
        total = 0
        for item in path.rglob("*"):
            try:
                if item.is_file():
                    total += item.stat().st_size
            except OSError:
                continue
        return total
