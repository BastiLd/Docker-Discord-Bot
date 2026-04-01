from __future__ import annotations

import asyncio
import os
import shlex
import sys
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.core.config import BASE_DIR, AppConfig
from app.core.utils import human_duration, isoformat, utc_now
from app.services.log_service import LogService


SAFE_TERMINAL_COMMANDS = {
    "python",
    "python3",
    "pip",
    "pip3",
    "pwd",
    "ls",
    "find",
    "cat",
    "head",
    "tail",
    "grep",
    "echo",
    "env",
    "which",
    "du",
    "wc",
    "tree",
}

FORBIDDEN_SHELL_TOKENS = {"|", "&", ";", ">", "<", "$(", "`", "&&", "||"}


@dataclass(slots=True)
class ManagedTask:
    task_id: str
    kind: str
    title: str
    command: list[str]
    cwd: Path
    env: dict[str, str]
    status: str = "pending"
    created_at: datetime = field(default_factory=utc_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    output_lines: deque[str] = field(default_factory=lambda: deque(maxlen=1200))
    runner: asyncio.Task | None = None

    def serialize(self) -> dict:
        duration = None
        if self.started_at:
            end_time = self.finished_at or utc_now()
            duration = human_duration((end_time - self.started_at).total_seconds())
        return {
            "task_id": self.task_id,
            "kind": self.kind,
            "title": self.title,
            "status": self.status,
            "command": self.command,
            "created_at": isoformat(self.created_at),
            "started_at": isoformat(self.started_at),
            "finished_at": isoformat(self.finished_at),
            "exit_code": self.exit_code,
            "duration": duration or "n/a",
            "output": "\n".join(self.output_lines),
        }


class TaskManager:
    def __init__(self, config: AppConfig, log_service: LogService) -> None:
        self.config = config
        self.log_service = log_service
        self._tasks: dict[str, ManagedTask] = {}
        self._task_order: deque[str] = deque(maxlen=30)
        self._task_lock = asyncio.Lock()

    async def list_tasks(self) -> list[dict]:
        return [self._tasks[task_id].serialize() for task_id in reversed(self._task_order)]

    async def get_task(self, task_id: str) -> dict:
        task = self._tasks.get(task_id)
        if task is None:
            raise ValueError("Task nicht gefunden.")
        return task.serialize()

    async def start_install_requirements(self) -> dict:
        command = [
            sys.executable,
            str(BASE_DIR / "scripts" / "manage_venv.py"),
            "--workspace",
            str(self.config.workspace_dir),
            "--venv",
            str(self.config.venv_dir),
            "install-deps",
        ]
        return await self._start_task("dependencies", "Install dependencies", command, self.config.workspace_dir)

    async def start_install_package(self, package_name: str) -> dict:
        command = [
            sys.executable,
            str(BASE_DIR / "scripts" / "manage_venv.py"),
            "--workspace",
            str(self.config.workspace_dir),
            "--venv",
            str(self.config.venv_dir),
            "install-package",
            package_name,
        ]
        return await self._start_task("package", f"Install package: {package_name}", command, self.config.workspace_dir)

    async def start_console_command(self, command_text: str) -> dict:
        command = self._validate_console_command(command_text)
        return await self._start_task("console", command_text, command, self.config.workspace_dir)

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            if task.runner and not task.runner.done():
                task.runner.cancel()
        await asyncio.gather(
            *(task.runner for task in self._tasks.values() if task.runner and not task.runner.done()),
            return_exceptions=True,
        )

    async def _start_task(self, kind: str, title: str, command: list[str], cwd: Path) -> dict:
        task_id = uuid.uuid4().hex[:10]
        task = ManagedTask(
            task_id=task_id,
            kind=kind,
            title=title,
            command=command,
            cwd=cwd,
            env=self._build_environment(),
        )
        self._tasks[task_id] = task
        self._task_order.append(task_id)
        task.runner = asyncio.create_task(self._run_task(task))
        return task.serialize()

    async def _run_task(self, task: ManagedTask) -> None:
        async with self._task_lock:
            task.status = "running"
            task.started_at = utc_now()
            await self.log_service.write("system", f"Task started: {task.title}")

            try:
                process = await asyncio.create_subprocess_exec(
                    *task.command,
                    cwd=str(task.cwd),
                    env=task.env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            except Exception as exc:  # noqa: BLE001
                task.status = "failed"
                task.exit_code = -1
                task.finished_at = utc_now()
                task.output_lines.append(str(exc))
                await self.log_service.write("system", f"Task failed to start: {task.title} ({exc})")
                return

            assert process.stdout is not None
            while line := await process.stdout.readline():
                text = line.decode("utf-8", errors="replace").rstrip()
                if not text:
                    continue
                task.output_lines.append(text)
                await self.log_service.write("system", f"[task:{task.task_id}] {text}")

            task.exit_code = await process.wait()
            task.finished_at = utc_now()
            task.status = "success" if task.exit_code == 0 else "failed"
            await self.log_service.write(
                "system",
                f"Task finished: {task.title} (exit={task.exit_code}, duration={human_duration((task.finished_at - task.started_at).total_seconds())})",
            )

    def _build_environment(self) -> dict[str, str]:
        env = os.environ.copy()
        venv_bin = self.config.venv_dir / ("Scripts" if sys.platform.startswith("win") else "bin")
        if venv_bin.exists():
            env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        env["PYTHONUNBUFFERED"] = "1"
        return env

    def _validate_console_command(self, command_text: str) -> list[str]:
        if any(token in command_text for token in FORBIDDEN_SHELL_TOKENS):
            raise ValueError("Shell-Verkettungen und Umleitungen sind im Web-Terminal gesperrt.")

        try:
            parts = shlex.split(command_text, posix=not sys.platform.startswith("win"))
        except ValueError as exc:
            raise ValueError(f"Befehl konnte nicht geparst werden: {exc}") from exc

        if not parts:
            raise ValueError("Leerer Befehl.")

        executable = Path(parts[0]).name
        if executable not in SAFE_TERMINAL_COMMANDS:
            raise ValueError("Befehl ist im sicheren Web-Terminal nicht erlaubt.")

        for argument in parts[1:]:
            if argument.startswith("/") or argument.startswith(".."):
                raise ValueError("Absolute Pfade und '..' sind im Web-Terminal nicht erlaubt.")

        if executable in {"python", "python3", "py"}:
            return [sys.executable, *parts[1:]]
        if executable in {"pip", "pip3"}:
            return [sys.executable, "-m", "pip", *parts[1:]]

        return parts
