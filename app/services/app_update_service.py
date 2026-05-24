from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.core.config import AppConfig


SEMVER_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


@dataclass(slots=True)
class AppUpdateService:
    config: AppConfig
    registry_tags_url: str = "https://ghcr.io/v2/bastild/docker-discord-bot/tags/list"
    registry_token_url: str = "https://ghcr.io/token?scope=repository:bastild/docker-discord-bot:pull"
    image_name: str = "ghcr.io/bastild/docker-discord-bot"
    releases_url: str = "https://api.github.com/repos/BastiLd/Docker-Discord-Bot/releases/latest"

    def snapshot(self) -> dict:
        current_tag = self.config.app_image_tag
        payload = {
            "image": self.image_name,
            "current_version": self.config.app_version,
            "current_tag": current_tag,
            "build_sha": self.config.app_build_sha,
            "latest_tag": "",
            "latest_release_name": "",
            "latest_release_url": "",
            "latest_release_notes": "",
            "latest_release_published_at": "",
            "update_available": False,
            "message": "Für bewegliche Tags wie main oder latest: Image in ZimaOS neu ziehen und App neu erstellen/starten.",
        }

        release = self._latest_release()
        if release:
            payload["latest_release_name"] = release.get("name") or release.get("tag_name") or ""
            payload["latest_release_url"] = release.get("html_url") or ""
            payload["latest_release_notes"] = release.get("body") or ""
            payload["latest_release_published_at"] = release.get("published_at") or ""

        latest_tag = ""
        if release and isinstance(release.get("tag_name"), str):
            tag = release["tag_name"]
            if SEMVER_PATTERN.match(tag):
                latest_tag = self._normalize_tag(tag)

        if not latest_tag:
            latest_tag = self._latest_image_tag()

        if latest_tag:
            payload["latest_tag"] = latest_tag
            compare_tag = self.config.app_version if current_tag in {"main", "latest"} else current_tag
            payload["update_available"] = self._is_newer(latest_tag, compare_tag)
            payload["message"] = (
                f"Neue Version {latest_tag} verfügbar. In ZimaOS Tag auf {latest_tag} setzen und Image neu ziehen."
                if payload["update_available"]
                else "Installierte Version ist aktuell."
            )
        else:
            payload["message"] = "Update-Check konnte keine GHCR-Versionstags lesen. Bitte Netzwerk und Paket-Sichtbarkeit prüfen."
        return payload

    def _latest_release(self) -> dict | None:
        try:
            return self._fetch_json(self.releases_url)
        except Exception:  # noqa: BLE001
            return None

    def _latest_image_tag(self) -> str:
        try:
            payload = self._fetch_json(self.registry_tags_url)
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                return ""
            token = self._registry_token()
            if not token:
                return ""
            try:
                payload = self._fetch_json(self.registry_tags_url, token=token)
            except Exception:  # noqa: BLE001
                return ""
        except Exception:  # noqa: BLE001
            return ""
        tags = [str(tag) for tag in payload.get("tags", []) if isinstance(tag, str)]
        versions = [self._normalize_tag(tag) for tag in tags if SEMVER_PATTERN.match(tag)]
        return sorted(versions, key=self._version_tuple, reverse=True)[0] if versions else ""

    def _registry_token(self) -> str:
        try:
            payload = self._fetch_json(self.registry_token_url)
        except Exception:  # noqa: BLE001
            return ""
        return str(payload.get("token") or payload.get("access_token") or "")

    @staticmethod
    def _fetch_json(url: str, token: str = "") -> dict:
        headers = {"Accept": "application/json", "User-Agent": "homelab-discord-bot-manager"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))

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
        return self._version_tuple(latest) > self._version_tuple(current)
