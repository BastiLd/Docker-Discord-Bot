from __future__ import annotations

import asyncio
import os
import shlex
import sys
from collections import deque
from pathlib import Path

from app.core.config import AppConfig
from app.core.schemas import BotSettingsModel
from app.core.utils import human_duration, isoformat, utc_now
from app.services.env_service import EnvService
from app.services.log_service import LogService
from app.services.settings_service import SettingsService


class BotManager:
    def __init__(
        self,
        config: AppConfig,
        settings_service: SettingsService,
        env_service: EnvService,
        log_service: LogService,
    ) -> None:
        self.config = config
        self.settings_service = settings_service
        self.env_service = env_service
        self.log_service = log_service
        self.process: asyncio.subprocess.Process | None = None
        self.started_at = None
        self.last_exit_code: int | None = None
        self.last_error: str | None = None
        self.last_command: str | None = None
        self.state = "stopped"
        self._lock = asyncio.Lock()
        self._stop_requested = False
        self._output_task: asyncio.Task | None = None
        self._wait_task: asyncio.Task | None = None
        self._history: deque[dict[str, str | int | None]] = deque(maxlen=60)

    async def status(self) -> dict:
        uptime_seconds = (utc_now() - self.started_at).total_seconds() if self.started_at else None
        return {
            "state": self.state,
            "pid": self.process.pid if self.process else None,
            "uptime_seconds": uptime_seconds,
            "uptime_human": human_duration(uptime_seconds),
            "last_exit_code": self.last_exit_code,
            "last_error": self.last_error,
            "last_command": self.last_command or self.settings_service.get().start_command,
            "history": list(self._history),
        }

    async def history(self) -> list[dict]:
        return list(self._history)

    async def start(self) -> dict:
        async with self._lock:
            if self.process and self.process.returncode is None:
                raise ValueError("Bot laeuft bereits.")

            settings = self.settings_service.get()
            command = self._build_command(settings)
            self._stop_requested = False
            self.last_error = None
            self.last_command = " ".join(command)
            env = self._build_environment(settings)

            try:
                self.process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(self.config.workspace_dir),
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            except Exception as exc:  # noqa: BLE001
                self.process = None
                self.state = "crashed"
                self.last_error = str(exc)
                self.last_exit_code = -1
                await self.log_service.write("system", f"Bot start failed: {exc}")
                self._record_event("crashed", str(exc), self.last_exit_code)
                return await self.status()

            self.state = "running"
            self.started_at = utc_now()
            self.last_exit_code = None
            self._record_event("running", f"Started with: {' '.join(command)}", None)
            await self.log_service.write("system", f"Bot started with PID {self.process.pid}")
            await self.log_service.write("bot", f"Process launched: {' '.join(command)}")

            self._output_task = asyncio.create_task(self._stream_output())
            self._wait_task = asyncio.create_task(self._watch_process())
            return await self.status()

    async def stop(self) -> dict:
        async with self._lock:
            if not self.process or self.process.returncode is not None:
                self.state = "stopped"
                return await self.status()

            self._stop_requested = True
            await self.log_service.write("system", "Stopping bot process.")
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=10)
            except asyncio.TimeoutError:
                await self.log_service.write("system", "Bot did not stop gracefully, sending kill.")
                self.process.kill()
                await self.process.wait()

            return await self.status()

    async def restart(self) -> dict:
        await self.stop()
        return await self.start()

    async def shutdown(self) -> None:
        if self.process and self.process.returncode is None:
            await self.stop()
        await asyncio.gather(*(task for task in (self._output_task, self._wait_task) if task), return_exceptions=True)

    def _build_command(self, settings: BotSettingsModel) -> list[str]:
        try:
            parts = shlex.split(settings.start_command, posix=not sys.platform.startswith("win"))
        except ValueError as exc:
            raise ValueError(f"Start-Command ist ungueltig: {exc}") from exc

        if not parts:
            raise ValueError("Start-Command ist leer.")

        executable_name = Path(parts[0]).name.lower()
        if executable_name in {"python", "python3", "py"}:
            python_path = self._venv_python() if settings.use_virtualenv and self._venv_python().exists() else Path(sys.executable)
            parts[0] = str(python_path)
        return parts

    def _build_environment(self, settings: BotSettingsModel) -> dict[str, str]:
        env = os.environ.copy()
        env.update(self.env_service.as_runtime_env())
        env["PYTHONUNBUFFERED"] = "1"

        if settings.use_virtualenv:
            venv_bin = self._venv_bin_dir()
            if venv_bin.exists():
                env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        return env

    def _venv_bin_dir(self) -> Path:
        return self.config.venv_dir / ("Scripts" if sys.platform.startswith("win") else "bin")

    def _venv_python(self) -> Path:
        bin_dir = self._venv_bin_dir()
        return bin_dir / ("python.exe" if sys.platform.startswith("win") else "python")

    async def _stream_output(self) -> None:
        if not self.process or not self.process.stdout:
            return
        while line := await self.process.stdout.readline():
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                await self.log_service.write("bot", text)

    async def _watch_process(self) -> None:
        if not self.process:
            return

        exit_code = await self.process.wait()
        self.last_exit_code = exit_code
        should_restart = False
        restart_delay = self.settings_service.get().restart_delay_seconds

        if self._stop_requested:
            self.state = "stopped"
            self.last_error = None
            await self.log_service.write("system", f"Bot stopped (exit={exit_code}).")
            self._record_event("stopped", "Stopped by user.", exit_code)
        elif exit_code == 0:
            self.state = "stopped"
            self.last_error = None
            await self.log_service.write("system", "Bot exited cleanly.")
            self._record_event("stopped", "Process exited cleanly.", exit_code)
        else:
            self.state = "crashed"
            self.last_error = f"Process exited with code {exit_code}"
            await self.log_service.write("system", f"Bot crashed (exit={exit_code}).")
            self._record_event("crashed", self.last_error, exit_code)
            should_restart = self.settings_service.get().auto_restart

        self.process = None
        self.started_at = None
        self._stop_requested = False

        if should_restart:
            await self.log_service.write("system", f"Auto-restart in {restart_delay}s.")
            await asyncio.sleep(restart_delay)
            await self.start()

    def _record_event(self, state: str, message: str, exit_code: int | None) -> None:
        self._history.appendleft(
            {
                "timestamp": isoformat(utc_now()),
                "state": state,
                "message": message,
                "exit_code": exit_code,
            }
        )
