from __future__ import annotations

import hashlib
import json
import time
import zipfile
from pathlib import Path

from app.core.schemas import BackupRetentionSettingsModel, BackupRetentionUpdateRequest
from app.core.utils import human_size


_RETENTION_DAYS = {
    "30d": 30,
    "6m": 30 * 6,
    "10m": 30 * 10,
    "1y": 365,
}


class BackupService:
    def __init__(self, backup_dir: Path, workspace_dir: Path, config_dir: Path) -> None:
        self.backup_dir = backup_dir.resolve()
        self.workspace_dir = workspace_dir.resolve()
        self.config_dir = config_dir.resolve()
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self._retention_path = self.config_dir / "backup_retention.json"
        self._retention_path.parent.mkdir(parents=True, exist_ok=True)
        self._retention = self._load_retention()

    def list_backups(self) -> list[dict]:
        items: list[dict] = []
        for path in sorted(self.backup_dir.glob("*.zip"), key=lambda item: item.stat().st_mtime, reverse=True):
            stat = path.stat()
            items.append(
                {
                    "name": path.name,
                    "size_bytes": stat.st_size,
                    "size_human": human_size(stat.st_size),
                    "created_at": stat.st_mtime,
                    "checksum": self._checksum(path)[:12],
                }
            )
        return items

    def create_backup(self) -> dict:
        file_name = f"backup_{self._timestamp()}.zip"
        target = self.backup_dir / file_name
        counter = 1
        while target.exists():
            target = self.backup_dir / f"backup_{self._timestamp()}_{counter}.zip"
            counter += 1

        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            self._add_directory(archive, self.workspace_dir, "workspace")
            self._add_directory(archive, self.config_dir, "config")

        self.apply_retention()
        return self._serialize(target)

    def delete_backup(self, name: str) -> None:
        self.resolve(name).unlink(missing_ok=True)

    def resolve(self, name: str) -> Path:
        candidate = (self.backup_dir / Path(name).name).resolve()
        if candidate.parent != self.backup_dir or candidate.suffix.lower() != ".zip":
            raise ValueError("Invalid backup name.")
        if not candidate.exists():
            raise ValueError("Backup not found.")
        return candidate

    # ---- retention ------------------------------------------------------

    def get_retention(self) -> BackupRetentionSettingsModel:
        return self._retention

    def update_retention(self, payload: BackupRetentionUpdateRequest) -> BackupRetentionSettingsModel:
        self._retention = BackupRetentionSettingsModel(
            enabled=payload.enabled,
            mode=payload.mode,
            custom_days=payload.custom_days,
        )
        self._save_retention()
        self.apply_retention()
        return self._retention

    def retention_days(self) -> int | None:
        if not self._retention.enabled:
            return None
        if self._retention.mode == "disabled":
            return None
        if self._retention.mode == "custom":
            return max(1, int(self._retention.custom_days))
        return _RETENTION_DAYS.get(self._retention.mode, 30)

    def apply_retention(self) -> list[str]:
        days = self.retention_days()
        if days is None:
            return []
        cutoff = time.time() - days * 24 * 60 * 60
        deleted: list[str] = []
        for path in self.backup_dir.glob("*.zip"):
            try:
                stat = path.stat()
            except OSError:
                continue
            if stat.st_mtime < cutoff:
                try:
                    path.unlink()
                except OSError:
                    continue
                deleted.append(path.name)
        return deleted

    def _load_retention(self) -> BackupRetentionSettingsModel:
        if not self._retention_path.exists():
            settings = BackupRetentionSettingsModel()
            self._write_retention(settings)
            return settings
        try:
            raw = json.loads(self._retention_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff"))
        except (json.JSONDecodeError, OSError):
            raw = {}
        return BackupRetentionSettingsModel.model_validate(raw or {})

    def _save_retention(self) -> None:
        self._write_retention(self._retention)

    def _write_retention(self, settings: BackupRetentionSettingsModel) -> None:
        self._retention_path.write_text(
            json.dumps(settings.model_dump(mode="json"), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # ---- internals ------------------------------------------------------

    def _serialize(self, path: Path) -> dict:
        stat = path.stat()
        return {
            "name": path.name,
            "size_bytes": stat.st_size,
            "size_human": human_size(stat.st_size),
            "created_at": stat.st_mtime,
            "checksum": self._checksum(path)[:12],
        }

    @staticmethod
    def _timestamp() -> str:
        from datetime import datetime

        return datetime.now().strftime("%Y%m%d_%H%M%S")

    @staticmethod
    def _checksum(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _add_directory(archive: zipfile.ZipFile, source_dir: Path, prefix: str) -> None:
        if not source_dir.exists():
            return
        for file_path in source_dir.rglob("*"):
            if file_path.is_dir():
                continue
            archive.write(file_path, arcname=(Path(prefix) / file_path.relative_to(source_dir)).as_posix())
