from __future__ import annotations

import asyncio
import os
import secrets
import shlex
import sys
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.core.config import BASE_DIR, AppConfig
from app.core.utils import human_duration, isoformat, parse_isoformat, utc_now
from app.services.log_service import LogService


SAFE_TERMINAL_COMMANDS = {
    "python",
    "python3",
    "py",
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
    SNAPSHOT_LIMIT = 10

    def __init__(self, config: AppConfig, log_service: LogService) -> None:
        self.config = config
        self.log_service = log_service
        self._tasks: dict[str, ManagedTask] = {}
        self._task_order: deque[str] = deque(maxlen=30)
        self._task_lock = asyncio.Lock()
        self._snapshots: deque[dict] = deque(maxlen=self.SNAPSHOT_LIMIT)

    async def list_tasks(self) -> list[dict]:
        return [self._tasks[task_id].serialize() for task_id in reversed(self._task_order)]

    async def clear_tasks(self) -> dict | None:
        """Remove finished tasks, keeping a restorable snapshot of what was cleared.

        Returns the created snapshot's metadata, or ``None`` when nothing was removed.
        """
        async with self._task_lock:
            removed: list[dict] = []
            for task_id in list(self._task_order):
                task = self._tasks.get(task_id)
                if task is None:
                    self._task_order.remove(task_id)
                    continue
                if task.status in {"pending", "running"}:
                    continue
                removed.append(task.serialize())
                self._tasks.pop(task_id, None)
                self._task_order.remove(task_id)

            if not removed:
                return None

            snapshot = {
                "id": f"{utc_now().strftime('%Y%m%d-%H%M%S-%f')}-{secrets.token_hex(3)}",
                "cleared_at": utc_now().astimezone().isoformat(timespec="seconds"),
                "count": len(removed),
                "tasks": removed,
            }
            self._snapshots.append(snapshot)
            return self._snapshot_meta(snapshot)

    def list_task_snapshots(self) -> list[dict]:
        return [self._snapshot_meta(snapshot) for snapshot in reversed(self._snapshots)]

    async def restore_tasks(self, snapshot_id: str | None = None) -> list[dict]:
        """Re-insert the tasks captured in a snapshot (newest by default)."""
        async with self._task_lock:
            snapshot = self._resolve_snapshot(snapshot_id)
            if snapshot is None:
                raise ValueError("Kein Snapshot zum Wiederherstellen vorhanden.")
            for data in snapshot["tasks"]:
                if data.get("task_id") in self._tasks:
                    continue
                task = self._task_from_serialized(data)
                self._tasks[task.task_id] = task
                self._task_order.append(task.task_id)
            return [self._tasks[task_id].serialize() for task_id in reversed(self._task_order)]

    @staticmethod
    def _snapshot_meta(snapshot: dict) -> dict:
        return {"id": snapshot["id"], "cleared_at": snapshot["cleared_at"], "count": snapshot["count"]}

    def _resolve_snapshot(self, snapshot_id: str | None) -> dict | None:
        if not self._snapshots:
            return None
        if snapshot_id is None:
            return self._snapshots[-1]
        for snapshot in self._snapshots:
            if snapshot["id"] == snapshot_id:
                return snapshot
        return None

    def _task_from_serialized(self, data: dict) -> ManagedTask:
        task = ManagedTask(
            task_id=data.get("task_id") or uuid.uuid4().hex[:10],
            kind=data.get("kind", ""),
            title=data.get("title", ""),
            command=list(data.get("command") or []),
            cwd=self.config.workspace_dir,
            env={},
        )
        task.status = data.get("status", "success")
        task.created_at = parse_isoformat(data.get("created_at")) or utc_now()
        task.started_at = parse_isoformat(data.get("started_at"))
        task.finished_at = parse_isoformat(data.get("finished_at"))
        task.exit_code = data.get("exit_code")
        output = data.get("output") or ""
        if output:
            task.output_lines.extend(output.split("\n"))
        return task

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
        return await self._start_task(
            "dependencies", "Abhaengigkeiten installieren", command, self.config.workspace_dir
        )

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
        return await self._start_task(
            "package", f"Paket installieren: {package_name}", command, self.config.workspace_dir
        )

    async def start_console_command(self, command_text: str) -> dict:
        command = self._validate_console_command(command_text)
        return await self._start_task("console", command_text, command, self.config.workspace_dir)

    async def record_bot_action(
        self,
        action: str,
        command_text: str,
        payload: dict | None = None,
        error: str | None = None,
    ) -> dict:
        title = {
            "start": "Bot starten",
            "stop": "Bot stoppen",
            "restart": "Bot neu starten",
        }.get(action, f"Bot {action}")
        command = [command_text] if command_text else [title]
        task = await self._create_task("bot_action", title, command, self.config.workspace_dir)
        task.status = "failed" if error else "success"
        task.started_at = utc_now()
        task.finished_at = utc_now()
        task.exit_code = 1 if error else 0
        if command_text:
            task.output_lines.append(f"$ {command_text}")
        if error:
            task.output_lines.append(f"Fehler: {error}")
        else:
            state = payload.get("state") if payload else None
            pid = payload.get("pid") if payload else None
            last_command = payload.get("last_command") if payload else None
            if action == "start":
                task.output_lines.append(f"Bot gestartet{f' mit PID {pid}' if pid else ''}.")
            elif action == "stop":
                task.output_lines.append("Bot gestoppt.")
            elif action == "restart":
                task.output_lines.append(f"Bot neu gestartet{f' mit PID {pid}' if pid else ''}.")
            if state:
                task.output_lines.append(f"Status: {state}")
            if last_command and last_command != command_text:
                task.output_lines.append(f"Ausgefuehrt: {last_command}")
        await self.log_service.write("system", f"Console-Task erfasst: {title}")
        return task.serialize()

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            if task.runner and not task.runner.done():
                task.runner.cancel()
        await asyncio.gather(
            *(task.runner for task in self._tasks.values() if task.runner and not task.runner.done()),
            return_exceptions=True,
        )

    async def _start_task(self, kind: str, title: str, command: list[str], cwd: Path) -> dict:
        task = await self._create_task(kind, title, command, cwd)
        task.runner = asyncio.create_task(self._run_task(task))
        return task.serialize()

    async def _create_task(self, kind: str, title: str, command: list[str], cwd: Path) -> ManagedTask:
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
        return task

    async def _run_task(self, task: ManagedTask) -> None:
        async with self._task_lock:
            task.status = "running"
            task.started_at = utc_now()
            await self.log_service.write("system", f"Task gestartet: {task.title}")

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
                await self.log_service.write("system", f"Task konnte nicht gestartet werden: {task.title} ({exc})")
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
                f"Task beendet: {task.title} (exit={task.exit_code}, Dauer={human_duration((task.finished_at - task.started_at).total_seconds())})",
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
            for argument in parts[1:]:
                if argument == "-" or argument.startswith("-c") or argument.startswith("-m"):
                    raise ValueError("'-c', '-m' und stdin (-) sind im sicheren Web-Terminal gesperrt.")
            return [sys.executable, *parts[1:]]
        if executable in {"pip", "pip3"}:
            return [sys.executable, "-m", "pip", *parts[1:]]

        return parts
