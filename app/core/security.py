from __future__ import annotations

import secrets
from typing import TYPE_CHECKING

from app.core.config import AppConfig

if TYPE_CHECKING:
    from app.services.ui_auth_service import UiAuthService

# Sessions are required for everything except these endpoints/prefixes once auth is enabled.
PUBLIC_PATHS = {"/login", "/health"}
PUBLIC_PATH_PREFIXES = ("/static",)

SESSION_USER_KEY = "user"


def env_auth_enabled(config: AppConfig) -> bool:
    """True when login credentials are provided via environment variables."""
    return bool(config.ui_username and config.ui_password)


def auth_enabled(config: AppConfig, ui_auth: UiAuthService | None = None) -> bool:
    """UI authentication is active when env credentials OR panel credentials exist."""
    if env_auth_enabled(config):
        return True
    return bool(ui_auth and ui_auth.is_configured())


def auth_source(config: AppConfig, ui_auth: UiAuthService | None = None) -> str | None:
    """Where the active credentials come from: 'env', 'panel', or None."""
    if env_auth_enabled(config):
        return "env"
    if ui_auth and ui_auth.is_configured():
        return "panel"
    return None


def verify_credentials(
    config: AppConfig, username: str, password: str, ui_auth: UiAuthService | None = None
) -> bool:
    if env_auth_enabled(config):
        user_ok = secrets.compare_digest(username or "", config.ui_username or "")
        pass_ok = secrets.compare_digest(password or "", config.ui_password or "")
        if user_ok and pass_ok:
            return True
    if ui_auth and ui_auth.is_configured():
        return ui_auth.verify(username, password)
    return False


def is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES)


def safe_next_path(target: str | None) -> str:
    """Only allow local, non protocol-relative redirect targets."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return "/"
