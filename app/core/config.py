from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]


def _path_from_env(name: str, default: Path) -> Path:
    raw_value = os.getenv(name)
    return Path(raw_value).expanduser().resolve() if raw_value else default.resolve()


@dataclass(slots=True)
class AppConfig:
    app_name: str
    host: str
    port: int
    workspace_dir: Path
    config_dir: Path
    log_dir: Path
    backup_dir: Path
    venv_dir: Path
    max_upload_mb: int
    ui_username: str | None
    ui_password: str | None
    timezone: str

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def ensure_directories(self) -> None:
        for path in (self.workspace_dir, self.config_dir, self.log_dir, self.backup_dir, self.venv_dir):
            path.mkdir(parents=True, exist_ok=True)


def load_config() -> AppConfig:
    data_root = _path_from_env("DATA_ROOT", BASE_DIR / "data")
    workspace_dir = _path_from_env("WORKSPACE_DIR", data_root / "workspace")
    config_dir = _path_from_env("CONFIG_DIR", data_root / "config")
    log_dir = _path_from_env("LOG_DIR", data_root / "logs")
    backup_dir = _path_from_env("BACKUP_DIR", data_root / "backups")
    venv_dir = _path_from_env("VENV_DIR", data_root / "venv")

    return AppConfig(
        app_name=os.getenv("APP_NAME", "Homelab Discord Bot Manager"),
        host=os.getenv("APP_HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "8080")),
        workspace_dir=workspace_dir,
        config_dir=config_dir,
        log_dir=log_dir,
        backup_dir=backup_dir,
        venv_dir=venv_dir,
        max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "128")),
        ui_username=os.getenv("UI_USERNAME") or None,
        ui_password=os.getenv("UI_PASSWORD") or None,
        timezone=os.getenv("TZ", "UTC"),
    )
