from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.schemas import SaveScheduleRequest, ScheduleModel
from app.core.utils import isoformat, parse_isoformat, utc_now

if TYPE_CHECKING:
    from app.services.bot_manager import BotManager
    from app.services.log_service import LogService
    from app.services.task_manager import TaskManager


class ScheduleService:
    def __init__(
        self,
        schedule_path: Path,
        bot_manager: "BotManager",
        task_manager: "TaskManager",
        log_service: "LogService",
    ) -> None:
        self.schedule_path = schedule_path
        self.bot_manager = bot_manager
        self.task_manager = task_manager
        self.log_service = log_service
        self.schedule_path.parent.mkdir(parents=True, exist_ok=True)
        self._schedules: dict[str, ScheduleModel] = self._load()
        self._runner: asyncio.Task | None = None
        self._running_ids: set[str] = set()

    async def start(self) -> None:
        if self._runner and not self._runner.done():
            return
        self._runner = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        if not self._runner:
            return
        self._runner.cancel()
        await asyncio.gather(self._runner, return_exceptions=True)

    def list_schedules(self) -> list[dict]:
        items = sorted(self._schedules.values(), key=lambda item: item.name.lower())
        return [item.model_dump(mode="json") for item in items]

    def save_schedule(self, payload: SaveScheduleRequest) -> dict:
        now = utc_now()
        existing = self._schedules.get(payload.schedule_id or "")
        schedule = ScheduleModel(
            schedule_id=payload.schedule_id or uuid.uuid4().hex[:10],
            name=payload.name.strip(),
            action=payload.action,
            interval_minutes=payload.interval_minutes,
            command=payload.command.strip(),
            enabled=payload.enabled,
            created_at=(existing.created_at if existing else isoformat(now)),
            last_run_at=(existing.last_run_at if existing else None),
            next_run_at=isoformat(now + timedelta(minutes=payload.interval_minutes)) if payload.enabled else None,
            last_status=(existing.last_status if existing else None),
            last_error=(existing.last_error if existing else ""),
        )
        self._schedules[schedule.schedule_id] = schedule
        self._save()
        return schedule.model_dump(mode="json")

    def delete_schedule(self, schedule_id: str) -> None:
        self._schedules.pop(schedule_id, None)
        self._save()

    def set_enabled(self, schedule_id: str, enabled: bool) -> dict:
        schedule = self._require(schedule_id)
        now = utc_now()
        updated = schedule.model_copy(
            update={
                "enabled": enabled,
                "next_run_at": isoformat(now + timedelta(minutes=schedule.interval_minutes)) if enabled else None,
            }
        )
        self._schedules[schedule_id] = updated
        self._save()
        return updated.model_dump(mode="json")

    async def _loop(self) -> None:
        while True:
            await self._run_due_schedules()
            await asyncio.sleep(5)

    async def _run_due_schedules(self) -> None:
        now = utc_now()
        due_ids = []
        for schedule in self._schedules.values():
            next_run = parse_isoformat(schedule.next_run_at)
            if schedule.enabled and next_run and next_run <= now and schedule.schedule_id not in self._running_ids:
                due_ids.append(schedule.schedule_id)
        for schedule_id in due_ids:
            self._running_ids.add(schedule_id)
            asyncio.create_task(self._run_schedule(schedule_id))

    async def _run_schedule(self, schedule_id: str) -> None:
        schedule = self._require(schedule_id)
        now = utc_now()
        last_status = "failed"
        last_error = ""
        try:
            await self.log_service.write("system", f"Schedule triggered: {schedule.name}")
            last_status = await self._dispatch(schedule)
        except Exception as exc:  # noqa: BLE001
            last_status = "failed"
            last_error = str(exc)
            await self.log_service.write("system", f"Schedule failed: {schedule.name} ({exc})")
        finally:
            current = self._require(schedule_id)
            self._schedules[schedule_id] = current.model_copy(
                update={
                    "last_run_at": isoformat(now),
                    "next_run_at": isoformat(now + timedelta(minutes=current.interval_minutes)) if current.enabled else None,
                    "last_status": last_status,
                    "last_error": last_error,
                }
            )
            self._running_ids.discard(schedule_id)
            self._save()

    async def _dispatch(self, schedule: ScheduleModel) -> str:
        if schedule.action == "bot_start":
            await self.bot_manager.start()
            return "success"
        if schedule.action == "bot_stop":
            await self.bot_manager.stop()
            return "success"
        if schedule.action == "bot_restart":
            await self.bot_manager.restart()
            return "success"
        if schedule.action == "install_deps":
            await self.task_manager.start_install_requirements()
            return "queued"
        await self.task_manager.start_console_command(schedule.command)
        return "queued"

    def _load(self) -> dict[str, ScheduleModel]:
        if not self.schedule_path.exists():
            self.schedule_path.write_text("[]\n", encoding="utf-8")
            return {}

        raw = self.schedule_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff")
        try:
            data = json.loads(raw) if raw.strip() else []
        except json.JSONDecodeError:
            data = []
        schedules: dict[str, ScheduleModel] = {}
        for item in data:
            try:
                schedule = ScheduleModel.model_validate(item)
            except Exception:  # noqa: BLE001
                continue
            schedules[schedule.schedule_id] = schedule
        self._schedules = schedules
        self._save()
        return schedules

    def _save(self) -> None:
        payload = [schedule.model_dump(mode="json") for schedule in self._schedules.values()]
        self.schedule_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _require(self, schedule_id: str) -> ScheduleModel:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise ValueError("Schedule not found.")
        return schedule
