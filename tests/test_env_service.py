"""Smoke tests for env service."""
from __future__ import annotations

from pathlib import Path

from app.core.schemas import EnvEntryModel
from app.services.env_service import EnvService


def test_env_service_round_trip(tmp_path: Path):
    env_path = tmp_path / ".env"
    service = EnvService(env_path)
    assert service.list_entries() == []
    service.save_entries([
        EnvEntryModel(key="DISCORD_TOKEN", value="secret", masked=True),
        EnvEntryModel(key="DEBUG", value="1", masked=False),
    ])
    again = EnvService(env_path)
    items = {entry.key: entry for entry in again.list_entries()}
    assert items["DISCORD_TOKEN"].value == "secret"
    assert items["DEBUG"].value == "1"
