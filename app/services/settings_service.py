from __future__ import annotations

import json
from pathlib import Path

from app.core.schemas import BotSettingsModel


class SettingsService:
    def __init__(self, settings_path: Path) -> None:
        self.settings_path = settings_path
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self._settings = self._load()

    def get(self) -> BotSettingsModel:
        return self._settings.model_copy(deep=True)

    def update(self, settings: BotSettingsModel) -> BotSettingsModel:
        self._settings = settings
        self._save()
        return self.get()

    def _load(self) -> BotSettingsModel:
        if not self.settings_path.exists():
            settings = BotSettingsModel()
            self._settings = settings
            self._save()
            return settings

        raw = self.settings_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff")
        try:
            data = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            data = {}
        settings = BotSettingsModel.model_validate(data or {})
        self._settings = settings
        self._save()
        return settings

    def _save(self) -> None:
        payload = self._settings.model_dump(mode="json")
        self.settings_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
