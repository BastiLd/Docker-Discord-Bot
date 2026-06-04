"""Tests for clearing/restoring the console task output."""
from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path

from app.core.config import load_config
from app.services.log_service import LogService
from app.services.task_manager import TaskManager


def _manager(tmp_path: Path) -> TaskManager:
    config = replace(load_config(), workspace_dir=tmp_path, venv_dir=tmp_path / "venv")
    log_service = LogService(tmp_path / "logs")
    return TaskManager(config, log_service)


async def _seed_finished_task(manager: TaskManager, title: str) -> None:
    task = await manager._create_task("console", title, ["echo", title], manager.config.workspace_dir)
    task.status = "success"
    task.exit_code = 0
    task.output_lines.append(f"$ {title}")


def test_clear_snapshots_and_restore(tmp_path: Path):
    manager = _manager(tmp_path)

    async def scenario():
        await _seed_finished_task(manager, "task-a")
        await _seed_finished_task(manager, "task-b")
        assert len(await manager.list_tasks()) == 2

        snapshot = await manager.clear_tasks()
        assert snapshot is not None
        assert snapshot["count"] == 2
        assert await manager.list_tasks() == []
        assert len(manager.list_task_snapshots()) == 1

        restored = await manager.restore_tasks()
        titles = {item["title"] for item in restored}
        assert {"task-a", "task-b"} <= titles

    asyncio.run(scenario())


def test_clear_with_nothing_finished_returns_none(tmp_path: Path):
    manager = _manager(tmp_path)

    async def scenario():
        snapshot = await manager.clear_tasks()
        assert snapshot is None
        assert manager.list_task_snapshots() == []

    asyncio.run(scenario())


def test_running_tasks_are_not_cleared(tmp_path: Path):
    manager = _manager(tmp_path)

    async def scenario():
        running = await manager._create_task("console", "live", ["echo", "live"], manager.config.workspace_dir)
        running.status = "running"
        await _seed_finished_task(manager, "done")

        snapshot = await manager.clear_tasks()
        assert snapshot["count"] == 1
        remaining = await manager.list_tasks()
        assert [task["title"] for task in remaining] == ["live"]

    asyncio.run(scenario())
