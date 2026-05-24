from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class BotSettingsModel(BaseModel):
    start_command: str = Field(default="python bot.py", min_length=1, max_length=300)
    auto_restart: bool = True
    restart_delay_seconds: int = Field(default=5, ge=1, le=300)
    use_virtualenv: bool = True
    python_runtime: str = Field(default="3.14", pattern=r"^3\.(12|13|14)$")


class GitDeploySettingsModel(BaseModel):
    repo_url: str = Field(default="", max_length=300)
    branch: str = Field(default="main", min_length=1, max_length=120)
    auto_update: bool = False
    install_requirements: bool = True
    restart_after_update: bool = True
    keep_user_data: bool = True
    protected_paths: list[str] = Field(default_factory=list, max_length=200)
    last_commit: str = Field(default="", max_length=80)
    last_remote_commit: str = Field(default="", max_length=80)
    last_checked_at: str | None = None
    last_updated_at: str | None = None
    status: str = Field(default="not_configured", max_length=60)
    message: str = Field(default="", max_length=1000)


class GitDeployUpdateRequest(BaseModel):
    repo_url: str = Field(default="", max_length=300)
    branch: str = Field(default="main", min_length=1, max_length=120)
    auto_update: bool = False
    install_requirements: bool = True
    restart_after_update: bool = True
    keep_user_data: bool = True
    protected_paths: list[str] = Field(default_factory=list, max_length=200)


class CreateServerRequest(BaseModel):
    display_name: str = Field(default="Discord-Bot", min_length=1, max_length=80)
    description: str = Field(default="", max_length=280)
    git_repo_url: str = Field(default="", max_length=300)
    git_branch: str = Field(default="main", min_length=1, max_length=120)
    git_import_now: bool = True


class PanelMetaModel(BaseModel):
    display_name: str = Field(default="Discord-Bot", min_length=1, max_length=80)
    description: str = Field(default="", max_length=280)
    server_id: str = Field(default="local-bot")
    network_note: str = Field(default="", max_length=120)


class PanelMetaUpdateModel(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=280)
    network_note: str = Field(default="", max_length=120)


class SaveFileRequest(BaseModel):
    path: str
    content: str


class CreateEntryRequest(BaseModel):
    parent_path: str = ""
    name: str = Field(min_length=1, max_length=255)


class RenameEntryRequest(BaseModel):
    path: str
    new_name: str = Field(min_length=1, max_length=255)


class TransferEntriesRequest(BaseModel):
    sources: list[str] = Field(min_length=1)
    destination: str = ""


class DeleteEntriesRequest(BaseModel):
    paths: list[str] = Field(min_length=1)


class ExtractArchiveRequest(BaseModel):
    path: str
    destination: str = ""


class EnvEntryModel(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    value: str = ""
    masked: bool = False

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if not ENV_KEY_PATTERN.match(value):
            raise ValueError("Invalid variable name.")
        return value


class SaveEnvRequest(BaseModel):
    entries: list[EnvEntryModel]


class InstallPackageRequest(BaseModel):
    package: str = Field(min_length=1, max_length=200)


class ConsoleCommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=500)


class DownloadSelectionRequest(BaseModel):
    paths: list[str] = Field(min_length=1)


class DatabaseCellUpdateRequest(BaseModel):
    path: str
    table: str = Field(min_length=1, max_length=200)
    rowid: int
    column: str = Field(min_length=1, max_length=200)
    value: str | None = None


class DatabaseRowCreateRequest(BaseModel):
    path: str
    table: str = Field(min_length=1, max_length=200)
    values: dict[str, str | None] = Field(default_factory=dict)


class DatabaseRowDeleteRequest(BaseModel):
    path: str
    table: str = Field(min_length=1, max_length=200)
    rowid: int


class DatabaseQueryRequest(BaseModel):
    path: str
    sql: str = Field(min_length=1, max_length=10000)


ScheduleAction = Literal["bot_start", "bot_stop", "bot_restart", "install_deps", "console"]


class ScheduleModel(BaseModel):
    schedule_id: str
    name: str = Field(min_length=1, max_length=100)
    action: ScheduleAction
    interval_minutes: int = Field(ge=1, le=10080)
    command: str = Field(default="", max_length=500)
    enabled: bool = True
    created_at: str | None = None
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_status: str | None = None
    last_error: str = ""

    @model_validator(mode="after")
    def validate_command(self) -> "ScheduleModel":
        if self.action == "console" and not self.command.strip():
            raise ValueError("Console schedules require a command.")
        if self.action != "console":
            self.command = ""
        return self


class SaveScheduleRequest(BaseModel):
    schedule_id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    action: ScheduleAction
    interval_minutes: int = Field(ge=1, le=10080)
    command: str = Field(default="", max_length=500)
    enabled: bool = True

    @model_validator(mode="after")
    def validate_command(self) -> "SaveScheduleRequest":
        if self.action == "console" and not self.command.strip():
            raise ValueError("Console schedules require a command.")
        if self.action != "console":
            self.command = ""
        return self


class TaskResponseModel(BaseModel):
    task_id: str
    kind: str
    title: str
    status: Literal["pending", "running", "success", "failed"]
    command: list[str]
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    exit_code: int | None = None
    output: str = ""
