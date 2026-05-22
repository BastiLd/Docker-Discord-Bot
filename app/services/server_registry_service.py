from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.core.config import AppConfig
from app.core.i18n import new_server_id
from app.core.schemas import PanelMetaModel
from app.services.backup_service import BackupService
from app.services.bot_manager import BotManager
from app.services.bootstrap import seed_workspace_if_empty
from app.services.database_service import DatabaseService
from app.services.env_service import EnvService
from app.services.file_service import FileService
from app.services.git_deploy_service import GitDeployService
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
    git_deploy_service: GitDeployService
    database_service: DatabaseService
    system_metrics_service: SystemMetricsService
    schedule_service: ScheduleService
    git_auto_update_task: asyncio.Task | None = None


class ServerRegistryService:
    def __init__(self, base_config: AppConfig, registry_path: Path) -> None:
        self.base_config = base_config
        self.registry_path = registry_path
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        self.records = self._load_records()
        self.runtimes: dict[str, ServerRuntime] = {}

    def list_records(self) -> list[ServerRecord]:
        return list(self.records)

    def first_server_id(self) -> str:
        return self.records[0].server_id if self.records else "default"

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
        self._start_git_auto_update(runtime)
        await runtime.log_service.write("system", f"Server profile created: {record.display_name}")
        return runtime

    async def delete_server(self, server_id: str) -> None:
        if len(self.records) <= 1:
            raise ValueError("Der letzte Server kann nicht gelöscht werden.")
        record = self._record_for(server_id)
        if record.server_id != server_id:
            raise ValueError("Server not found.")

        runtime = self.runtimes.pop(server_id, None)
        if runtime:
            await runtime.schedule_service.shutdown()
            await runtime.bot_manager.shutdown()
            await runtime.task_manager.shutdown()
            if runtime.git_auto_update_task:
                runtime.git_auto_update_task.cancel()

        self.records = [item for item in self.records if item.server_id != server_id]
        self._save_records()

        if server_id == "default":
            self._delete_default_runtime_data()
        else:
            server_root = (self.base_config.config_dir / "servers" / server_id).resolve()
            servers_root = (self.base_config.config_dir / "servers").resolve()
            if server_root.is_relative_to(servers_root) and server_root.exists():
                shutil.rmtree(server_root, ignore_errors=True)

    def update_record_meta(self, server_id: str, display_name: str, description: str) -> ServerRecord:
        record = self._record_for(server_id)
        if record.server_id != server_id:
            raise ValueError("Server not found.")
        record.display_name = display_name.strip() or "Discord-Bot"
        record.description = description.strip()
        self._save_records()
        runtime = self.runtimes.get(server_id)
        if runtime:
            runtime.record.display_name = record.display_name
            runtime.record.description = record.description
        return record

    async def start_all_schedules(self) -> None:
        for record in self.records:
            runtime = self.get_runtime(record.server_id)
            await runtime.schedule_service.start()
            self._start_git_auto_update(runtime)

    async def shutdown(self) -> None:
        for runtime in self.runtimes.values():
            await runtime.schedule_service.shutdown()
            await runtime.bot_manager.shutdown()
            await runtime.task_manager.shutdown()
            if runtime.git_auto_update_task:
                runtime.git_auto_update_task.cancel()

    def _start_git_auto_update(self, runtime: ServerRuntime) -> None:
        if runtime.git_auto_update_task and not runtime.git_auto_update_task.done():
            return
        runtime.git_auto_update_task = asyncio.create_task(self._git_auto_update_loop(runtime))

    async def _git_auto_update_loop(self, runtime: ServerRuntime) -> None:
        while True:
            await asyncio.sleep(900)
            await runtime.git_deploy_service.maybe_auto_update()

    def _build_runtime(self, record: ServerRecord) -> ServerRuntime:
        config = self.base_config.for_server(record.server_id)
        config.ensure_directories()
        if record.server_id == "default":
            seed_workspace_if_empty(config.workspace_dir)

        log_service = LogService(config.log_dir)
        settings_service = SettingsService(config.config_dir / "settings.json")
        panel_meta_service = PanelMetaService(config.config_dir / "panel_meta.json", record.display_name)
        panel_meta = panel_meta_service.get()
        if panel_meta.server_id == record.server_id and (
            panel_meta.display_name != record.display_name or panel_meta.description != record.description
        ):
            record.display_name = panel_meta.display_name
            record.description = panel_meta.description
            self._save_records()
        elif panel_meta.server_id != record.server_id:
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
        git_deploy_service = GitDeployService(
            config.config_dir / "git_deploy.json",
            config.workspace_dir,
            backup_service,
            bot_manager,
            task_manager,
            log_service,
        )
        database_service = DatabaseService(config.workspace_dir)
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
            git_deploy_service=git_deploy_service,
            database_service=database_service,
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

    def _delete_default_runtime_data(self) -> None:
        for path in (self.base_config.workspace_dir, self.base_config.log_dir, self.base_config.backup_dir, self.base_config.venv_dir):
            resolved = path.resolve()
            if resolved.exists():
                shutil.rmtree(resolved, ignore_errors=True)
        self.base_config.ensure_directories()

        config_dir = self.base_config.config_dir.resolve()
        for item in config_dir.iterdir():
            if item.name in {"servers", "servers.json"}:
                continue
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
