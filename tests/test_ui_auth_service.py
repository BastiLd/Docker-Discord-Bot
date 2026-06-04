"""Tests for the panel login credential store."""
from __future__ import annotations

from pathlib import Path

from app.core.config import AppConfig
from app.core.security import auth_enabled, auth_source, verify_credentials
from app.services.ui_auth_service import UiAuthService


def _make_config(**overrides) -> AppConfig:
    base = dict(
        app_name="test",
        host="0.0.0.0",
        port=8080,
        data_root=Path("."),
        workspace_dir=Path("."),
        config_dir=Path("."),
        log_dir=Path("."),
        backup_dir=Path("."),
        venv_dir=Path("."),
        max_upload_mb=128,
        ui_username=None,
        ui_password=None,
        session_secret="secret",
        timezone="UTC",
        app_version="0.0.0",
        app_image_tag="0.0.0",
        app_build_sha="test",
    )
    base.update(overrides)
    return AppConfig(**base)


def test_set_verify_and_clear(tmp_path: Path):
    service = UiAuthService(tmp_path / "ui_auth.json")
    assert service.is_configured() is False

    service.set_credentials("admin", "hunter2")
    assert service.is_configured() is True
    assert service.username == "admin"
    assert service.verify("admin", "hunter2") is True
    assert service.verify("admin", "wrong") is False
    assert service.verify("other", "hunter2") is False

    service.clear_credentials()
    assert service.is_configured() is False
    assert service.verify("admin", "hunter2") is False


def test_password_never_stored_in_plaintext(tmp_path: Path):
    store = tmp_path / "ui_auth.json"
    service = UiAuthService(store)
    service.set_credentials("admin", "supersecret")

    raw = store.read_text(encoding="utf-8")
    assert "supersecret" not in raw
    assert "admin" in raw  # username is stored plainly, password is not


def test_auth_enabled_reacts_to_store_and_env(tmp_path: Path):
    config = _make_config()
    store = UiAuthService(tmp_path / "ui_auth.json")

    assert auth_enabled(config, store) is False
    assert auth_source(config, store) is None

    store.set_credentials("admin", "pw")
    assert auth_enabled(config, store) is True
    assert auth_source(config, store) == "panel"
    assert verify_credentials(config, "admin", "pw", store) is True

    env_config = _make_config(ui_username="envuser", ui_password="envpass")
    assert auth_enabled(env_config, None) is True
    assert auth_source(env_config, None) == "env"
    assert verify_credentials(env_config, "envuser", "envpass", None) is True
