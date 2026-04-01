from __future__ import annotations

from pathlib import Path

from app.core.schemas import EnvEntryModel


class EnvService:
    def __init__(self, env_path: Path) -> None:
        self.env_path = env_path
        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.env_path.exists():
            self.env_path.write_text("", encoding="utf-8")

    def list_entries(self) -> list[EnvEntryModel]:
        entries: list[EnvEntryModel] = []
        for raw_line in self.env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip().lstrip("\ufeff")
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, raw_value = line.split("=", 1)
            key = key.strip().lstrip("\ufeff")
            if not key:
                continue
            entries.append(EnvEntryModel(key=key, value=self._parse_value(raw_value), masked=self._is_masked_key(key)))
        return entries

    def save_entries(self, entries: list[EnvEntryModel]) -> list[EnvEntryModel]:
        unique_entries: list[EnvEntryModel] = []
        seen: set[str] = set()
        for entry in entries:
            if entry.key in seen:
                continue
            seen.add(entry.key)
            unique_entries.append(entry)

        lines = [f"{entry.key}={self._format_value(entry.value)}" for entry in unique_entries]
        payload = "\n".join(lines).rstrip()
        self.env_path.write_text(f"{payload}\n" if payload else "", encoding="utf-8")
        return self.list_entries()

    def as_runtime_env(self) -> dict[str, str]:
        return {entry.key: entry.value for entry in self.list_entries()}

    @staticmethod
    def _is_masked_key(key: str) -> bool:
        lowered = key.lower()
        sensitive_hints = ("token", "secret", "password", "key", "webhook")
        return any(hint in lowered for hint in sensitive_hints)

    @staticmethod
    def _parse_value(raw_value: str) -> str:
        value = raw_value.strip()
        if value.startswith('"') and value.endswith('"') and len(value) >= 2:
            return bytes(value[1:-1], "utf-8").decode("unicode_escape")
        if value.startswith("'") and value.endswith("'") and len(value) >= 2:
            return value[1:-1]
        if " #" in value:
            return value.split(" #", 1)[0].rstrip()
        return value

    @staticmethod
    def _format_value(value: str) -> str:
        if value == "":
            return '""'
        needs_quotes = any(character.isspace() for character in value) or any(
            character in value for character in ('#', '"', "'", "\\")
        )
        if not needs_quotes:
            return value
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
