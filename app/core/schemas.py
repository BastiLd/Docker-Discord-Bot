from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class BotSettingsModel(BaseModel):
    start_command: str = Field(default="python bot.py", min_length=1, max_length=300)
    auto_restart: bool = True
    restart_delay_seconds: int = Field(default=5, ge=1, le=300)
    use_virtualenv: bool = True


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
            raise ValueError("Ungültiger Variablenname.")
        return value


class SaveEnvRequest(BaseModel):
    entries: list[EnvEntryModel]


class InstallPackageRequest(BaseModel):
    package: str = Field(min_length=1, max_length=200)


class ConsoleCommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=500)


class DownloadSelectionRequest(BaseModel):
    paths: list[str] = Field(min_length=1)


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
