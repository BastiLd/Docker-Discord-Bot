from __future__ import annotations

import json
from pathlib import Path

from app.core.i18n import new_server_id
from app.core.schemas import PanelMetaModel, PanelMetaUpdateModel


class PanelMetaService:
    def __init__(self, meta_path: Path, default_display_name: str) -> None:
        self.meta_path = meta_path
        self.default_display_name = default_display_name
        self.meta_path.parent.mkdir(parents=True, exist_ok=True)
        self._meta = self._load()

    def get(self) -> PanelMetaModel:
        return self._meta.model_copy(deep=True)

    def update(self, payload: PanelMetaUpdateModel) -> PanelMetaModel:
        self._meta = PanelMetaModel(
            display_name=payload.display_name.strip(),
            description=payload.description.strip(),
            server_id=self._meta.server_id,
            network_note=payload.network_note.strip(),
        )
        self._save()
        return self.get()

    def _load(self) -> PanelMetaModel:
        default_meta = PanelMetaModel(display_name=self.default_display_name, server_id=new_server_id())
        if not self.meta_path.exists():
            self._meta = default_meta
            self._save()
            return self._meta

        raw = self.meta_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff")
        try:
            data = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            data = {}

        merged = {**default_meta.model_dump(mode="json"), **(data or {})}
        self._meta = PanelMetaModel.model_validate(merged)
        self._save()
        return self._meta

    def _save(self) -> None:
        self.meta_path.write_text(
            json.dumps(self._meta.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
