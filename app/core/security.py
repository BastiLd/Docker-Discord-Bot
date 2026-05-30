from __future__ import annotations

import secrets

from app.core.config import AppConfig

# Sessions are required for everything except these endpoints/prefixes once auth is enabled.
PUBLIC_PATHS = {"/login", "/health"}
PUBLIC_PATH_PREFIXES = ("/static",)

SESSION_USER_KEY = "user"


def auth_enabled(config: AppConfig) -> bool:
    """UI authentication is active only when both credentials are configured."""
    return bool(config.ui_username and config.ui_password)


def verify_credentials(config: AppConfig, username: str, password: str) -> bool:
    if not auth_enabled(config):
        return False
    user_ok = secrets.compare_digest(username or "", config.ui_username or "")
    pass_ok = secrets.compare_digest(password or "", config.ui_password or "")
    return user_ok and pass_ok


def is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES)


def safe_next_path(target: str | None) -> str:
    """Only allow local, non protocol-relative redirect targets."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return "/"
