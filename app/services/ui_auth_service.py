from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

# PBKDF2-HMAC-SHA256 parameters. The iteration count is a balance between
# login responsiveness on small homelab hardware and brute-force resistance.
_HASH_NAME = "sha256"
_ITERATIONS = 200_000
_SALT_BYTES = 16


class UiAuthService:
    """Manager-wide panel login credentials persisted as a hashed JSON store.

    Credentials configured here enable UI authentication immediately, without an
    environment variable or container restart. The plaintext password is never
    stored; only a salted PBKDF2 hash is written to disk.
    """

    def __init__(self, store_path: Path) -> None:
        self.store_path = store_path
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self._data = self._load()

    def is_configured(self) -> bool:
        return bool(self._data.get("username") and self._data.get("hash") and self._data.get("salt"))

    @property
    def username(self) -> str | None:
        return self._data.get("username") or None

    def verify(self, username: str, password: str) -> bool:
        if not self.is_configured():
            return False
        stored_user = self._data.get("username") or ""
        user_ok = secrets.compare_digest(username or "", stored_user)
        candidate = self._hash(password or "", bytes.fromhex(self._data["salt"]))
        pass_ok = secrets.compare_digest(candidate, self._data["hash"])
        return user_ok and pass_ok

    def set_credentials(self, username: str, password: str) -> None:
        clean_user = (username or "").strip()
        if not clean_user:
            raise ValueError("Benutzername darf nicht leer sein.")
        if not password:
            raise ValueError("Passwort darf nicht leer sein.")
        salt = secrets.token_bytes(_SALT_BYTES)
        self._data = {
            "username": clean_user,
            "salt": salt.hex(),
            "hash": self._hash(password, salt),
        }
        self._save()

    def clear_credentials(self) -> None:
        self._data = {}
        self._save()

    @staticmethod
    def _hash(password: str, salt: bytes) -> str:
        derived = hashlib.pbkdf2_hmac(_HASH_NAME, password.encode("utf-8"), salt, _ITERATIONS)
        return derived.hex()

    def _load(self) -> dict:
        if not self.store_path.exists():
            return {}
        try:
            raw = self.store_path.read_text(encoding="utf-8", errors="replace").lstrip("﻿")
            data = json.loads(raw) if raw.strip() else {}
        except (json.JSONDecodeError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save(self) -> None:
        self.store_path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
