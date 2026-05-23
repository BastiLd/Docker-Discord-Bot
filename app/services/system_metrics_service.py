from __future__ import annotations

import shutil
import time
from pathlib import Path

from app.core.utils import human_size

try:
    import psutil
except ImportError:  # pragma: no cover - fallback when dependency is not installed.
    psutil = None


class SystemMetricsService:
    def __init__(self, workspace_dir: Path) -> None:
        self.workspace_dir = workspace_dir
        self._process_cpu_samples: dict[int, tuple[float, float]] = {}
        if psutil is not None:
            psutil.cpu_percent(interval=None)

    def snapshot(self, pid: int | None = None) -> dict:
        cpu_percent = 0.0
        memory_used = None
        memory_total = None
        process_cpu_percent = 0.0
        process_memory_used = 0

        if psutil is not None:
            cpu_percent = round(psutil.cpu_percent(interval=None), 2)
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
            cpu_percent = self._process_cpu_delta(processes)
            memory_used = sum(item.memory_info().rss for item in processes if item.is_running())
        except (psutil.Error, OSError):
            return 0.0, 0
        return round(cpu_percent, 2), int(memory_used)

    def _process_cpu_delta(self, processes: list) -> float:
        if psutil is None:
            return 0.0

        now = time.monotonic()
        active_pids = set()
        total_percent = 0.0
        cpu_count = psutil.cpu_count() or 1
        for process in processes:
            if not process.is_running():
                continue
            try:
                times = process.cpu_times()
            except (psutil.Error, OSError):
                continue
            active_pids.add(process.pid)
            total_cpu_time = float(times.user + times.system)
            previous = self._process_cpu_samples.get(process.pid)
            self._process_cpu_samples[process.pid] = (total_cpu_time, now)
            if not previous:
                continue
            previous_cpu_time, previous_time = previous
            elapsed = now - previous_time
            if elapsed <= 0:
                continue
            total_percent += max(0.0, (total_cpu_time - previous_cpu_time) / elapsed * 100.0 / cpu_count)

        for pid in list(self._process_cpu_samples):
            if pid not in active_pids:
                self._process_cpu_samples.pop(pid, None)
        return total_percent

    def _directory_size(self, path: Path) -> int:
        total = 0
        for item in path.rglob("*"):
            try:
                if item.is_file():
                    total += item.stat().st_size
            except OSError:
                continue
        return total
