from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass

from app.core.config import AppConfig


SEMVER_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


@dataclass(slots=True)
class AppUpdateService:
    config: AppConfig
    repo_api_url: str = "https://api.github.com/repos/BastiLd/Docker-Discord-Bot/tags"
    image_name: str = "ghcr.io/bastild/docker-discord-bot"

    def snapshot(self) -> dict:
        current_tag = self.config.app_image_tag
        payload = {
            "image": self.image_name,
            "current_version": self.config.app_version,
            "current_tag": current_tag,
            "build_sha": self.config.app_build_sha,
            "latest_tag": "",
            "update_available": False,
            "message": "Für bewegliche Tags wie main oder latest: Image in ZimaOS neu ziehen und App neu erstellen/starten.",
        }
        latest = self._latest_semver_tag()
        if latest:
            payload["latest_tag"] = latest
            payload["update_available"] = self._is_newer(latest, current_tag)
            payload["message"] = (
                f"Neue Version {latest} verfügbar. In ZimaOS Tag auf {latest} setzen und Image neu ziehen."
                if payload["update_available"]
                else "Installierte Version ist aktuell."
            )
        return payload

    def _latest_semver_tag(self) -> str:
        try:
            request = urllib.request.Request(self.repo_api_url, headers={"User-Agent": "homelab-discord-bot-manager"})
            with urllib.request.urlopen(request, timeout=5) as response:
                items = json.loads(response.read().decode("utf-8", errors="replace"))
        except Exception:  # noqa: BLE001
            return ""
        tags = [str(item.get("name") or "") for item in items if isinstance(item, dict)]
        versions = [self._normalize_tag(tag) for tag in tags if SEMVER_PATTERN.match(tag)]
        return sorted(versions, key=self._version_tuple, reverse=True)[0] if versions else ""

    @staticmethod
    def _normalize_tag(value: str) -> str:
        return value[1:] if value.startswith("v") else value

    @staticmethod
    def _version_tuple(value: str) -> tuple[int, int, int]:
        match = SEMVER_PATTERN.match(value)
        if not match:
            return (0, 0, 0)
        return tuple(int(part) for part in match.groups())

    def _is_newer(self, latest: str, current: str) -> bool:
        if current in {"main", "latest"}:
            return False
        return self._version_tuple(latest) > self._version_tuple(current)
