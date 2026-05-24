"""Tests for backup retention policies."""
from __future__ import annotations

import os
import time
from pathlib import Path

from app.core.schemas import BackupRetentionUpdateRequest
from app.services.backup_service import BackupService


def _make_service(tmp_path: Path) -> BackupService:
    backup_dir = tmp_path / "backups"
    workspace_dir = tmp_path / "workspace"
    config_dir = tmp_path / "config"
    workspace_dir.mkdir(exist_ok=True)
    config_dir.mkdir(exist_ok=True)
    return BackupService(backup_dir, workspace_dir, config_dir)


def test_default_retention_is_30_days(tmp_path):
    service = _make_service(tmp_path)
    settings = service.get_retention()
    assert settings.enabled is True
    assert settings.mode == "30d"
    assert service.retention_days() == 30


def test_update_retention_persists(tmp_path):
    service = _make_service(tmp_path)
    service.update_retention(BackupRetentionUpdateRequest(enabled=True, mode="6m", custom_days=30))
    fresh = _make_service(tmp_path)
    assert fresh.get_retention().mode == "6m"
    assert fresh.retention_days() == 30 * 6


def test_custom_retention_uses_custom_days(tmp_path):
    service = _make_service(tmp_path)
    service.update_retention(BackupRetentionUpdateRequest(enabled=True, mode="custom", custom_days=7))
    assert service.retention_days() == 7


def test_apply_retention_deletes_old_backups(tmp_path):
    service = _make_service(tmp_path)
    old = service.backup_dir / "backup_old.zip"
    fresh = service.backup_dir / "backup_fresh.zip"
    old.write_bytes(b"x")
    fresh.write_bytes(b"x")
    older = time.time() - 60 * 24 * 60 * 60  # 60 days
    os.utime(old, (older, older))
    # Configure first; apply_retention is called by update so we recreate the file to verify the second run.
    service.update_retention(BackupRetentionUpdateRequest(enabled=True, mode="30d", custom_days=30))
    assert old.exists() is False
    # Add another stale backup and ensure apply_retention removes it as well.
    second_old = service.backup_dir / "backup_old2.zip"
    second_old.write_bytes(b"y")
    os.utime(second_old, (older, older))
    deleted = service.apply_retention()
    assert "backup_old2.zip" in deleted
    assert second_old.exists() is False
    assert fresh.exists() is True


def test_disabled_retention_keeps_old_backups(tmp_path):
    service = _make_service(tmp_path)
    old = service.backup_dir / "backup_old.zip"
    old.write_bytes(b"x")
    older = time.time() - 60 * 24 * 60 * 60
    os.utime(old, (older, older))
    service.update_retention(BackupRetentionUpdateRequest(enabled=False, mode="30d", custom_days=30))
    deleted = service.apply_retention()
    assert deleted == []
    assert old.exists()
