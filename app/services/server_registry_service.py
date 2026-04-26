from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.core.config import AppConfig
from app.core.i18n import new_server_id
from app.core.schemas import PanelMetaModel
from app.services.backup_service import BackupService
from app.services.bot_manager import BotManager
from app.services.bootstrap import seed_workspace_if_empty
from app.services.env_service import EnvService
from app.services.file_service import FileService
from app.services.log_service import LogService
from app.services.panel_meta_service import PanelMetaService
from app.services.schedule_service import ScheduleService
from app.services.settings_service import SettingsService
from app.services.system_metrics_service import SystemMetricsService
from app.services.task_manager import TaskManager


@dataclass(slots=True)
class ServerRecord:
    server_id: str
    display_name: str
    description: str = ""

    def model_dump(self, **_: object) -> dict[str, str]:
        return {
            "server_id": self.server_id,
            "display_name": self.display_name,
            "description": self.description,
        }


@dataclass(slots=True)
class ServerRuntime:
    record: ServerRecord
    config: AppConfig
    log_service: LogService
    settings_service: SettingsService
    panel_meta_service: PanelMetaService
    env_service: EnvService
    file_service: FileService
    task_manager: TaskManager
    bot_manager: BotManager
    backup_service: BackupService
    system_metrics_service: SystemMetricsService
    schedule_service: ScheduleService


class ServerRegistryService:
    def __init__(self, base_config: AppConfig, registry_path: Path) -> None:
        self.base_config = base_config
        self.registry_path = registry_path
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        self.records = self._load_records()
        self.runtimes: dict[str, ServerRuntime] = {}

    def list_records(self) -> list[ServerRecord]:
        return list(self.records)

    def get_runtime(self, server_id: str | None) -> ServerRuntime:
        selected_id = server_id if self._has_record(server_id) else self.records[0].server_id
        if selected_id not in self.runtimes:
            self.runtimes[selected_id] = self._build_runtime(self._record_for(selected_id))
        return self.runtimes[selected_id]

    async def create_server(self, display_name: str, description: str = "") -> ServerRuntime:
        record = ServerRecord(
            server_id=new_server_id(),
            display_name=display_name.strip() or "Discord-Bot",
            description=description.strip(),
        )
        self.records.append(record)
        self._save_records()
        runtime = self.get_runtime(record.server_id)
        await runtime.schedule_service.start()
        await runtime.log_service.write("system", f"Server profile created: {record.display_name}")
        return runtime

    async def start_all_schedules(self) -> None:
        for record in self.records:
            runtime = self.get_runtime(record.server_id)
            await runtime.schedule_service.start()

    async def shutdown(self) -> None:
        for runtime in self.runtimes.values():
            await runtime.schedule_service.shutdown()
            await runtime.bot_manager.shutdown()
            await runtime.task_manager.shutdown()

    def _build_runtime(self, record: ServerRecord) -> ServerRuntime:
        config = self.base_config.for_server(record.server_id)
        config.ensure_directories()
        seed_workspace_if_empty(config.workspace_dir)

        log_service = LogService(config.log_dir)
        settings_service = SettingsService(config.config_dir / "settings.json")
        panel_meta_service = PanelMetaService(config.config_dir / "panel_meta.json", record.display_name)
        panel_meta = panel_meta_service.get()
        if (
            panel_meta.display_name != record.display_name
            or panel_meta.description != record.description
            or panel_meta.server_id != record.server_id
        ):
            panel_meta_service.replace(
                PanelMetaModel(
                    display_name=record.display_name,
                    description=record.description,
                    server_id=record.server_id,
                    network_note=panel_meta.network_note,
                )
            )
        env_service = EnvService(config.workspace_dir / ".env")
        file_service = FileService(config.workspace_dir, config.log_dir, config.max_upload_bytes)
        task_manager = TaskManager(config, log_service)
        bot_manager = BotManager(config, settings_service, env_service, log_service)
        backup_service = BackupService(config.backup_dir, config.workspace_dir, config.config_dir)
        system_metrics_service = SystemMetricsService(config.workspace_dir)
        schedule_service = ScheduleService(config.config_dir / "schedules.json", bot_manager, task_manager, log_service)

        return ServerRuntime(
            record=record,
            config=config,
            log_service=log_service,
            settings_service=settings_service,
            panel_meta_service=panel_meta_service,
            env_service=env_service,
            file_service=file_service,
            task_manager=task_manager,
            bot_manager=bot_manager,
            backup_service=backup_service,
            system_metrics_service=system_metrics_service,
            schedule_service=schedule_service,
        )

    def _load_records(self) -> list[ServerRecord]:
        if not self.registry_path.exists():
            records = [ServerRecord(server_id="default", display_name="Discord-Bot")]
            self._write_records(records)
            return records

        try:
            raw = json.loads(self.registry_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff"))
        except (json.JSONDecodeError, OSError):
            raw = []

        records = [
            ServerRecord(
                server_id=str(item.get("server_id") or new_server_id()),
                display_name=str(item.get("display_name") or "Discord-Bot"),
                description=str(item.get("description") or ""),
            )
            for item in raw
            if isinstance(item, dict)
        ]
        if not records:
            records = [ServerRecord(server_id="default", display_name="Discord-Bot")]
        if not any(record.server_id == "default" for record in records):
            records.insert(0, ServerRecord(server_id="default", display_name="Discord-Bot"))
        self._write_records(records)
        return records

    def _save_records(self) -> None:
        self._write_records(self.records)

    def _write_records(self, records: list[ServerRecord]) -> None:
        self.registry_path.write_text(
            json.dumps([record.model_dump() for record in records], indent=2),
            encoding="utf-8",
        )

    def _has_record(self, server_id: str | None) -> bool:
        return bool(server_id) and any(record.server_id == server_id for record in self.records)

    def _record_for(self, server_id: str) -> ServerRecord:
        for record in self.records:
            if record.server_id == server_id:
                return record
        return self.records[0]
