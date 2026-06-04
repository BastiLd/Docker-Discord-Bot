from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from starlette.background import BackgroundTask

from app.core.i18n import LOCALE_COOKIE, locale_cookie_value, translate, translations_for
from app.core.schemas import (
    BackupRestoreRequest,
    BackupRetentionUpdateRequest,
    BotSettingsModel,
    ConsoleCommandRequest,
    CreateEntryRequest,
    CreateServerRequest,
    DatabaseCellUpdateRequest,
    DatabaseQueryRequest,
    DatabaseRowCreateRequest,
    DatabaseRowDeleteRequest,
    DeleteEntriesRequest,
    DownloadSelectionRequest,
    ExtractArchiveRequest,
    GitDeployCheckoutRequest,
    GitDeployProtectedAddRequest,
    GitDeployRollbackRequest,
    GitDeployUpdateRequest,
    InstallPackageRequest,
    PanelMetaUpdateModel,
    RenameEntryRequest,
    SaveEnvRequest,
    SaveFileRequest,
    SaveScheduleRequest,
    SnapshotRestoreRequest,
    TransferEntriesRequest,
    UiCredentialsRequest,
)
from app.core.security import (
    SESSION_USER_KEY,
    auth_enabled,
    auth_source,
    env_auth_enabled,
    safe_next_path,
    verify_credentials,
)
from app.services.app_update_service import AppUpdateService

router = APIRouter()
ACTIVE_SERVER_COOKIE = "active_server_id"


NAVIGATION: list[dict[str, Any]] = [
    {
        "section": "section.general",
        "items": [
            {"key": "dashboard", "href": "/dashboard", "icon": "dashboard"},
            {"key": "console", "href": "/console", "icon": "console"},
            {"key": "settings", "href": "/settings", "icon": "settings"},
            {"key": "activity", "href": "/activity", "icon": "activity"},
        ],
    },
    {
        "section": "section.management",
        "items": [
            {"key": "files", "href": "/files", "icon": "files"},
            {"key": "databases", "href": "/databases", "icon": "databases"},
            {"key": "backups", "href": "/backups", "icon": "backups"},
            {"key": "network", "href": "/network", "icon": "network"},
        ],
    },
    {
        "section": "section.configuration",
        "items": [
            {"key": "schedules", "href": "/schedules", "icon": "schedules"},
            {"key": "users", "href": "/users", "icon": "users"},
            {"key": "startup", "href": "/startup", "icon": "startup"},
        ],
    },
]


SUPPORT_LINKS = {
    "discord": "https://discord.com/developers/applications",
    "support": "https://github.com/BastiLd/Docker-Discord-Bot",
}


PAGE_TITLES = {
    "home": "home.heading",
    "dashboard": "nav.dashboard",
    "console": "nav.console",
    "settings": "nav.settings",
    "activity": "nav.activity",
    "files": "nav.files",
    "databases": "nav.databases",
    "backups": "nav.backups",
    "network": "nav.network",
    "schedules": "nav.schedules",
    "users": "nav.users",
    "startup": "nav.startup",
}


def _app_state(request: Request):
    return request.app.state


def _ui_auth(request: Request):
    return getattr(_app_state(request), "ui_auth_service", None)


def _registry(request: Request):
    return _app_state(request).server_registry_service


def _active_server_id(request: Request) -> str | None:
    return (
        request.query_params.get("server_id")
        or request.headers.get("x-server-id")
        or request.cookies.get(ACTIVE_SERVER_COOKIE)
    )


def _services(request: Request):
    return _registry(request).get_runtime(_active_server_id(request))


def _set_active_server_cookie(response: JSONResponse | RedirectResponse, server_id: str) -> None:
    response.set_cookie(
        ACTIVE_SERVER_COOKIE,
        server_id,
        max_age=60 * 60 * 24 * 365,
        samesite="lax",
        httponly=False,
    )


def _raise_bad_request(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def _locale(request: Request) -> str:
    return locale_cookie_value(request.cookies.get(LOCALE_COOKIE))


def _localized_navigation(locale: str) -> list[dict[str, Any]]:
    return [
        {
            "section": translate(locale, group["section"]),
            "items": [
                {
                    **item,
                    "label": translate(locale, f"nav.{item['key']}"),
                }
                for item in group["items"]
            ],
        }
        for group in NAVIGATION
    ]


async def _page_context(request: Request, *, active_page: str) -> dict[str, Any]:
    app_state = _app_state(request)
    state = _services(request)
    locale = _locale(request)
    ui = translations_for(locale)
    settings = state.settings_service.get()
    env_entries = state.env_service.list_entries()
    panel_meta = state.panel_meta_service.get()
    git_deploy = state.git_deploy_service.get()
    backup_retention = state.backup_service.get_retention().model_dump(mode="json")
    registry = _registry(request)
    servers = []
    for server in registry.list_records():
        runtime = registry.get_runtime(server.server_id)
        status = await runtime.bot_manager.status()
        servers.append(
            {
                **server.model_dump(mode="json"),
                "status": status,
                "status_label": translate(locale, f"status.{status.get('state') or 'unknown'}"),
                "status_class": f"is-{status.get('state') or 'unknown'}",
                "can_delete": len(registry.list_records()) > 1,
            }
        )
    server_address = request.headers.get("host") or f"localhost:{app_state.config.port}"
    auth_is_enabled = auth_enabled(app_state.config, _ui_auth(request))
    auth_warning = _should_show_auth_warning(request, auth_is_enabled)

    return {
        "request": request,
        "app_name": app_state.config.app_name,
        "app_asset_version": f"{app_state.config.app_version}-{app_state.config.app_build_sha[:8] or 'dev'}",
        "page_title": translate(locale, PAGE_TITLES[active_page]),
        "active_page": active_page,
        "navigation": _localized_navigation(locale),
        "settings": settings.model_dump(mode="json"),
        "panel_meta": panel_meta.model_dump(mode="json"),
        "servers": servers,
        "active_server_id": state.record.server_id,
        "can_delete_active_server": len(registry.list_records()) > 1,
        "active_server_query": f"?server_id={state.record.server_id}",
        "env_entries": [entry.model_dump(mode="json") for entry in env_entries],
        "git_deploy": git_deploy,
        "backup_retention": backup_retention,
        "workspace_path": str(state.config.workspace_dir),
        "auth_enabled": auth_is_enabled,
        "auth_warning": auth_warning,
        "server_address": server_address,
        "support_links": SUPPORT_LINKS,
        "locale": locale,
        "ui": ui,
        "runtime_version": f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "timezone": app_state.config.timezone,
    }


def _should_show_auth_warning(request: Request, auth_enabled: bool) -> bool:
    if auth_enabled:
        return False
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if host in {"localhost", "127.0.0.1", "::1", ""}:
        return False
    if host.endswith(".localhost"):
        return False
    return True


async def _render_page(request: Request, template_name: str, *, active_page: str) -> HTMLResponse:
    return _app_state(request).templates.TemplateResponse(
        request,
        template_name,
        await _page_context(request, active_page=active_page),
    )


def _render_login(
    request: Request, *, next_url: str = "/", error: bool = False, status_code: int = 200
) -> HTMLResponse:
    app_state = _app_state(request)
    locale = _locale(request)
    return app_state.templates.TemplateResponse(
        request,
        "login.html",
        {
            "request": request,
            "app_name": app_state.config.app_name,
            "page_title": translate(locale, "login.title"),
            "locale": locale,
            "ui": translations_for(locale),
            "next_url": safe_next_path(next_url),
            "login_error": error,
        },
        status_code=status_code,
    )


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, next: str = "/") -> Response:
    config = _app_state(request).config
    if not auth_enabled(config, _ui_auth(request)) or request.session.get(SESSION_USER_KEY):
        return RedirectResponse(url=safe_next_path(next), status_code=303)
    return _render_login(request, next_url=next)


@router.post("/login", response_class=HTMLResponse)
async def login_submit(
    request: Request,
    username: str = Form(default=""),
    password: str = Form(default=""),
    next: str = Form(default="/"),
) -> Response:
    config = _app_state(request).config
    ui_auth = _ui_auth(request)
    if not auth_enabled(config, ui_auth):
        return RedirectResponse(url="/", status_code=303)
    if verify_credentials(config, username, password, ui_auth):
        request.session[SESSION_USER_KEY] = username
        return RedirectResponse(url=safe_next_path(next), status_code=303)
    return _render_login(request, next_url=next, error=True, status_code=401)


@router.post("/logout")
async def logout(request: Request) -> RedirectResponse:
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)


def _credentials_status(request: Request) -> dict:
    config = _app_state(request).config
    ui_auth = _ui_auth(request)
    source = auth_source(config, ui_auth)
    if source == "env":
        username = config.ui_username
    elif source == "panel" and ui_auth:
        username = ui_auth.username
    else:
        username = None
    return {
        "configured": source is not None,
        "username": username,
        "source": source,
        "env_locked": env_auth_enabled(config),
    }


@router.get("/api/security/credentials")
async def get_security_credentials(request: Request) -> JSONResponse:
    return JSONResponse(_credentials_status(request))


@router.post("/api/security/credentials")
async def set_security_credentials(request: Request, payload: UiCredentialsRequest) -> JSONResponse:
    config = _app_state(request).config
    if env_auth_enabled(config):
        raise HTTPException(
            status_code=409,
            detail="Login ist über die Umgebungsvariablen UI_USERNAME/UI_PASSWORD festgelegt.",
        )
    ui_auth = _ui_auth(request)
    if ui_auth is None:
        raise HTTPException(status_code=500, detail="Auth-Speicher nicht verfügbar.")
    try:
        ui_auth.set_credentials(payload.username, payload.password)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    await _services(request).log_service.write("system", "Panel-Login aktualisiert.")
    return JSONResponse({"ok": True, **_credentials_status(request)})


@router.delete("/api/security/credentials")
async def delete_security_credentials(request: Request) -> JSONResponse:
    config = _app_state(request).config
    if env_auth_enabled(config):
        raise HTTPException(
            status_code=409,
            detail="Login ist über die Umgebungsvariablen UI_USERNAME/UI_PASSWORD festgelegt.",
        )
    ui_auth = _ui_auth(request)
    if ui_auth is not None:
        ui_auth.clear_credentials()
    request.session.clear()
    await _services(request).log_service.write("system", "Panel-Login deaktiviert.")
    return JSONResponse({"ok": True, **_credentials_status(request)})


@router.get("/", response_class=HTMLResponse)
async def home_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "home.html", active_page="home")


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "dashboard.html", active_page="dashboard")


@router.get("/servers/{server_id}", response_class=HTMLResponse)
async def select_server(request: Request, server_id: str) -> RedirectResponse:
    runtime = _registry(request).get_runtime(server_id)
    response = RedirectResponse(url="/dashboard", status_code=303)
    _set_active_server_cookie(response, runtime.record.server_id)
    return response


@router.get("/console", response_class=HTMLResponse)
async def console_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "console.html", active_page="console")


@router.get("/settings", response_class=HTMLResponse)
@router.get("/environment", response_class=HTMLResponse)
async def settings_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "settings.html", active_page="settings")


@router.get("/activity", response_class=HTMLResponse)
@router.get("/logs", response_class=HTMLResponse)
async def activity_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "activity.html", active_page="activity")


@router.get("/files", response_class=HTMLResponse)
async def files_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "files.html", active_page="files")


@router.get("/databases", response_class=HTMLResponse)
async def databases_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "databases.html", active_page="databases")


@router.get("/backups", response_class=HTMLResponse)
async def backups_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "backups.html", active_page="backups")


@router.get("/network", response_class=HTMLResponse)
async def network_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "network.html", active_page="network")


@router.get("/schedules", response_class=HTMLResponse)
async def schedules_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "schedules.html", active_page="schedules")


@router.get("/users", response_class=HTMLResponse)
async def users_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "users.html", active_page="users")


@router.get("/startup", response_class=HTMLResponse)
async def startup_page(request: Request) -> HTMLResponse:
    return await _render_page(request, "startup.html", active_page="startup")


@router.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


@router.get("/api/servers")
async def list_servers(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "items": [server.model_dump(mode="json") for server in _registry(request).list_records()],
            "active_server_id": _services(request).record.server_id,
        }
    )


@router.post("/api/servers")
async def create_server(request: Request, payload: CreateServerRequest) -> JSONResponse:
    runtime = await _registry(request).create_server(payload.display_name, payload.description)
    git_error = ""
    git_deploy = runtime.git_deploy_service.get()
    if payload.git_repo_url.strip():
        try:
            git_deploy = runtime.git_deploy_service.update(
                GitDeployUpdateRequest(
                    repo_url=payload.git_repo_url,
                    branch=payload.git_branch,
                    auto_update=False,
                    install_requirements=True,
                    restart_after_update=True,
                )
            )
            git_deploy = await runtime.git_deploy_service.import_repo()
        except Exception as exc:  # noqa: BLE001
            git_error = str(exc)
            await runtime.log_service.write("system", f"Git-Import beim Erstellen fehlgeschlagen: {git_error}")
    response = JSONResponse(
        {
            "ok": True,
            "server": runtime.record.model_dump(mode="json"),
            "git_deploy": git_deploy,
            "git_error": git_error,
        },
        status_code=201,
    )
    _set_active_server_cookie(response, runtime.record.server_id)
    return response


@router.delete("/api/servers/{server_id}")
async def delete_server(request: Request, server_id: str) -> JSONResponse:
    try:
        registry = _registry(request)
        await registry.delete_server(server_id)
    except ValueError as exc:
        _raise_bad_request(exc)
    next_server_id = registry.first_server_id()
    response = JSONResponse({"ok": True, "active_server_id": next_server_id})
    if _active_server_id(request) == server_id:
        _set_active_server_cookie(response, next_server_id)
    return response


@router.get("/api/status")
async def get_status(request: Request) -> JSONResponse:
    return JSONResponse(await _services(request).bot_manager.status())


@router.get("/api/history")
async def get_history(request: Request) -> JSONResponse:
    return JSONResponse({"items": await _services(request).bot_manager.history()})


@router.get("/api/metrics")
async def get_metrics(request: Request) -> JSONResponse:
    runtime = _services(request)
    status = await runtime.bot_manager.status()
    return JSONResponse(runtime.system_metrics_service.snapshot(status.get("pid")))


@router.get("/api/panel-meta")
async def get_panel_meta(request: Request) -> JSONResponse:
    payload = _services(request).panel_meta_service.get().model_dump(mode="json")
    return JSONResponse(payload)


@router.put("/api/panel-meta")
async def save_panel_meta(request: Request, payload: PanelMetaUpdateModel) -> JSONResponse:
    runtime = _services(request)
    panel_meta = runtime.panel_meta_service.update(payload)
    _registry(request).update_record_meta(runtime.record.server_id, panel_meta.display_name, panel_meta.description)
    await runtime.log_service.write("system", "Panel metadata updated.")
    return JSONResponse(panel_meta.model_dump(mode="json"))


@router.get("/api/git-deploy")
async def get_git_deploy(request: Request) -> JSONResponse:
    return JSONResponse(_services(request).git_deploy_service.get())


@router.put("/api/git-deploy")
async def save_git_deploy(request: Request, payload: GitDeployUpdateRequest) -> JSONResponse:
    try:
        result = _services(request).git_deploy_service.update(payload)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    await _services(request).log_service.write("system", "Git-Deployment gespeichert.")
    return JSONResponse(result)


@router.post("/api/git-deploy/check")
async def check_git_deploy(request: Request) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.check_update()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/import")
async def import_git_deploy(request: Request) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.import_repo()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/update")
async def update_git_deploy(request: Request) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.update_repo()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/preview")
async def preview_git_deploy(request: Request) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.preview_update()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/protected")
async def add_protected_pattern(request: Request, payload: GitDeployProtectedAddRequest) -> JSONResponse:
    try:
        result = _services(request).git_deploy_service.add_protected_pattern(payload)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.delete("/api/git-deploy/protected")
async def remove_protected_pattern(request: Request, pattern: str) -> JSONResponse:
    try:
        result = _services(request).git_deploy_service.remove_protected_pattern(pattern)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/rollback")
async def rollback_git_deploy(request: Request, payload: GitDeployRollbackRequest) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.rollback(
            payload.backup_name,
            keep_user_data=payload.keep_user_data,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/git-deploy/checkout")
async def checkout_git_commit(request: Request, payload: GitDeployCheckoutRequest) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.checkout_commit(
            payload.commit,
            keep_user_data=payload.keep_user_data,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.get("/api/git-deploy/commits")
async def list_recent_commits(request: Request, limit: int = 30) -> JSONResponse:
    try:
        items = await _services(request).git_deploy_service.list_recent_commits(limit=limit)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"items": items})


@router.get("/api/backups/retention")
async def get_backup_retention(request: Request) -> JSONResponse:
    return JSONResponse(_services(request).backup_service.get_retention().model_dump(mode="json"))


@router.put("/api/backups/retention")
async def save_backup_retention(request: Request, payload: BackupRetentionUpdateRequest) -> JSONResponse:
    settings = _services(request).backup_service.update_retention(payload)
    await _services(request).log_service.write("system", "Backup-Retention aktualisiert.")
    return JSONResponse(settings.model_dump(mode="json"))


@router.post("/api/backups/restore")
async def restore_backup(request: Request, payload: BackupRestoreRequest) -> JSONResponse:
    try:
        result = await _services(request).git_deploy_service.rollback(
            payload.name,
            keep_user_data=payload.keep_user_data,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.get("/api/app-update")
async def get_app_update(request: Request) -> JSONResponse:
    return JSONResponse(AppUpdateService(_app_state(request).config).snapshot())


@router.post("/api/bot/start")
async def start_bot(request: Request) -> JSONResponse:
    runtime = _services(request)
    command_text = runtime.settings_service.get().start_command
    try:
        payload = await runtime.bot_manager.start()
    except Exception as exc:  # noqa: BLE001
        await runtime.task_manager.record_bot_action("start", command_text, error=str(exc))
        _raise_bad_request(exc)
    await runtime.task_manager.record_bot_action("start", payload.get("last_command") or command_text, payload=payload)
    return JSONResponse(payload)


@router.post("/api/bot/stop")
async def stop_bot(request: Request) -> JSONResponse:
    runtime = _services(request)
    command_text = "stop bot"
    try:
        payload = await runtime.bot_manager.stop()
    except Exception as exc:  # noqa: BLE001
        await runtime.task_manager.record_bot_action("stop", command_text, error=str(exc))
        _raise_bad_request(exc)
    await runtime.task_manager.record_bot_action("stop", command_text, payload=payload)
    return JSONResponse(payload)


@router.post("/api/bot/restart")
async def restart_bot(request: Request) -> JSONResponse:
    runtime = _services(request)
    command_text = runtime.settings_service.get().start_command
    try:
        payload = await runtime.bot_manager.restart()
    except Exception as exc:  # noqa: BLE001
        await runtime.task_manager.record_bot_action("restart", command_text, error=str(exc))
        _raise_bad_request(exc)
    await runtime.task_manager.record_bot_action(
        "restart", payload.get("last_command") or command_text, payload=payload
    )
    return JSONResponse(payload)


@router.get("/api/files")
async def list_files(request: Request, path: str = "") -> JSONResponse:
    try:
        payload = _services(request).file_service.list_directory(path)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.get("/api/files/content")
async def get_file_content(request: Request, path: str) -> JSONResponse:
    try:
        payload = _services(request).file_service.read_text_file(path)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.get("/api/databases")
async def list_databases(request: Request) -> JSONResponse:
    return JSONResponse(_services(request).database_service.list_databases())


@router.get("/api/databases/inspect")
async def inspect_database(request: Request, path: str) -> JSONResponse:
    try:
        payload = _services(request).database_service.inspect(path)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.get("/api/databases/table")
async def read_database_table(
    request: Request,
    path: str,
    table: str,
    limit: int = 100,
    offset: int = 0,
) -> JSONResponse:
    try:
        payload = _services(request).database_service.table_rows(path, table, limit, offset)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.put("/api/databases/cell")
async def update_database_cell(request: Request, payload: DatabaseCellUpdateRequest) -> JSONResponse:
    try:
        result = _services(request).database_service.update_cell(
            payload.path, payload.table, payload.rowid, payload.column, payload.value
        )
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/databases/row")
async def create_database_row(request: Request, payload: DatabaseRowCreateRequest) -> JSONResponse:
    try:
        result = _services(request).database_service.insert_row(payload.path, payload.table, payload.values)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.delete("/api/databases/row")
async def delete_database_row(request: Request, payload: DatabaseRowDeleteRequest) -> JSONResponse:
    try:
        result = _services(request).database_service.delete_row(payload.path, payload.table, payload.rowid)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.get("/api/databases/export")
async def export_database_table(request: Request, path: str, table: str) -> JSONResponse:
    try:
        result = _services(request).database_service.export_csv(path, table)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.post("/api/databases/query")
async def query_database(request: Request, payload: DatabaseQueryRequest) -> JSONResponse:
    try:
        result = _services(request).database_service.query(payload.path, payload.sql)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(result)


@router.put("/api/files/content")
async def save_file_content(request: Request, payload: SaveFileRequest) -> JSONResponse:
    try:
        _services(request).file_service.write_text_file(payload.path, payload.content)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "path": payload.path})


@router.post("/api/files/new-file")
async def create_file(request: Request, payload: CreateEntryRequest) -> JSONResponse:
    try:
        path = _services(request).file_service.create_file(payload.parent_path, payload.name)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "path": path})


@router.post("/api/files/new-folder")
async def create_folder(request: Request, payload: CreateEntryRequest) -> JSONResponse:
    try:
        path = _services(request).file_service.create_folder(payload.parent_path, payload.name)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "path": path})


@router.post("/api/files/rename")
async def rename_entry(request: Request, payload: RenameEntryRequest) -> JSONResponse:
    try:
        path = _services(request).file_service.rename(payload.path, payload.new_name)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "path": path})


@router.post("/api/files/move")
async def move_entries(request: Request, payload: TransferEntriesRequest) -> JSONResponse:
    try:
        _services(request).file_service.move_many(payload.sources, payload.destination)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True})


@router.post("/api/files/copy")
async def copy_entries(request: Request, payload: TransferEntriesRequest) -> JSONResponse:
    try:
        _services(request).file_service.copy_many(payload.sources, payload.destination)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True})


@router.delete("/api/files")
async def delete_entries(request: Request, payload: DeleteEntriesRequest) -> JSONResponse:
    try:
        _services(request).file_service.delete_many(payload.paths)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True})


@router.post("/api/files/upload")
async def upload_files(
    request: Request,
    path: str = Form(default=""),
    extract_archives: bool = Form(default=False),
    files: list[UploadFile] = File(...),
) -> JSONResponse:
    try:
        saved = await _services(request).file_service.save_uploads(path, files, extract_archives=extract_archives)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "saved": saved})


@router.post("/api/files/extract")
async def extract_archive(request: Request, payload: ExtractArchiveRequest) -> JSONResponse:
    try:
        _services(request).file_service.extract_archive(payload.path, payload.destination)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True})


@router.get("/api/files/download")
async def download_file(request: Request, path: str) -> FileResponse:
    try:
        file_path = _services(request).file_service.resolve(path)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)

    if file_path.is_dir():
        archive_path, archive_name = _services(request).file_service.create_download_archive(
            [path], Path(path).name or "workspace"
        )
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename=archive_name,
            background=BackgroundTask(archive_path.unlink, missing_ok=True),
        )

    return FileResponse(file_path, filename=file_path.name)


@router.post("/api/files/download-selection")
async def download_selection(request: Request, payload: DownloadSelectionRequest) -> FileResponse:
    try:
        archive_path, archive_name = _services(request).file_service.create_download_archive(payload.paths, "selection")
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=archive_name,
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@router.get("/api/env")
async def get_env_entries(request: Request) -> JSONResponse:
    return JSONResponse(
        {"entries": [entry.model_dump(mode="json") for entry in _services(request).env_service.list_entries()]}
    )


@router.put("/api/env")
async def save_env_entries(request: Request, payload: SaveEnvRequest) -> JSONResponse:
    try:
        saved = _services(request).env_service.save_entries(payload.entries)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "entries": [entry.model_dump(mode="json") for entry in saved]})


@router.get("/api/settings")
async def get_settings(request: Request) -> JSONResponse:
    settings = _services(request).settings_service.get()
    return JSONResponse(settings.model_dump(mode="json"))


@router.put("/api/settings")
async def save_settings(request: Request, payload: BotSettingsModel) -> JSONResponse:
    settings = _services(request).settings_service.update(payload)
    await _services(request).log_service.write("system", "Bot settings saved.")
    return JSONResponse(settings.model_dump(mode="json"))


@router.get("/api/backups")
async def list_backups(request: Request) -> JSONResponse:
    return JSONResponse({"items": _services(request).backup_service.list_backups()})


@router.post("/api/backups")
async def create_backup(request: Request) -> JSONResponse:
    try:
        payload = _services(request).backup_service.create_backup()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    await _services(request).log_service.write("system", f"Backup created: {payload['name']}")
    return JSONResponse(payload)


@router.get("/api/backups/{backup_name}/download")
async def download_backup(request: Request, backup_name: str) -> FileResponse:
    try:
        file_path = _services(request).backup_service.resolve(backup_name)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return FileResponse(file_path, filename=file_path.name)


@router.delete("/api/backups/{backup_name}")
async def delete_backup(request: Request, backup_name: str) -> JSONResponse:
    try:
        _services(request).backup_service.delete_backup(backup_name)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    await _services(request).log_service.write("system", f"Backup deleted: {backup_name}")
    return JSONResponse({"ok": True})


@router.get("/api/schedules")
async def list_schedules(request: Request) -> JSONResponse:
    return JSONResponse({"items": _services(request).schedule_service.list_schedules()})


@router.post("/api/schedules")
async def save_schedule(request: Request, payload: SaveScheduleRequest) -> JSONResponse:
    try:
        schedule = _services(request).schedule_service.save_schedule(payload)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(schedule)


@router.post("/api/schedules/{schedule_id}/enabled")
async def toggle_schedule(request: Request, schedule_id: str, enabled: bool) -> JSONResponse:
    try:
        schedule = _services(request).schedule_service.set_enabled(schedule_id, enabled)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(schedule)


@router.delete("/api/schedules/{schedule_id}")
async def delete_schedule(request: Request, schedule_id: str) -> JSONResponse:
    try:
        _services(request).schedule_service.delete_schedule(schedule_id)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True})


@router.post("/api/logs/{channel}/clear")
async def clear_log_channel(request: Request, channel: str) -> JSONResponse:
    if channel not in {"bot", "system"}:
        raise HTTPException(status_code=404, detail="Unknown log channel.")
    log_service = _services(request).log_service
    snapshot = await log_service.clear(channel)
    await log_service.write("system", f"Log {channel} geleert.")
    return JSONResponse({"ok": True, "channel": channel, "snapshot": snapshot})


@router.get("/api/logs/{channel}/snapshots")
async def list_log_snapshots(request: Request, channel: str) -> JSONResponse:
    if channel not in {"bot", "system"}:
        raise HTTPException(status_code=404, detail="Unknown log channel.")
    items = _services(request).log_service.list_snapshots(channel)
    return JSONResponse({"items": items})


@router.post("/api/logs/{channel}/restore")
async def restore_log_channel(request: Request, channel: str, payload: SnapshotRestoreRequest) -> JSONResponse:
    if channel not in {"bot", "system"}:
        raise HTTPException(status_code=404, detail="Unknown log channel.")
    log_service = _services(request).log_service
    try:
        lines = await log_service.restore(channel, payload.snapshot_id)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    await log_service.write("system", f"Log {channel} wiederhergestellt.")
    return JSONResponse({"ok": True, "channel": channel, "lines": lines})


@router.post("/api/tasks/clear")
async def clear_finished_tasks(request: Request) -> JSONResponse:
    snapshot = await _services(request).task_manager.clear_tasks()
    return JSONResponse({"ok": True, "removed": snapshot["count"] if snapshot else 0, "snapshot": snapshot})


@router.get("/api/tasks/snapshots")
async def list_task_snapshots(request: Request) -> JSONResponse:
    return JSONResponse({"items": _services(request).task_manager.list_task_snapshots()})


@router.post("/api/tasks/restore")
async def restore_tasks(request: Request, payload: SnapshotRestoreRequest) -> JSONResponse:
    try:
        items = await _services(request).task_manager.restore_tasks(payload.snapshot_id)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse({"ok": True, "items": items})


@router.get("/api/logs/{channel}/download")
async def download_logs(request: Request, channel: str) -> FileResponse:
    if channel not in {"bot", "system"}:
        raise HTTPException(status_code=404, detail="Unknown log channel.")
    file_path = _services(request).log_service.file_for(channel)
    return FileResponse(file_path, filename=file_path.name)


@router.get("/api/tasks")
async def list_tasks(request: Request) -> JSONResponse:
    return JSONResponse({"items": await _services(request).task_manager.list_tasks()})


@router.get("/api/tasks/{task_id}")
async def get_task(request: Request, task_id: str) -> JSONResponse:
    try:
        payload = await _services(request).task_manager.get_task(task_id)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.post("/api/tasks/install-deps")
async def install_dependencies(request: Request) -> JSONResponse:
    try:
        payload = await _services(request).task_manager.start_install_requirements()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.post("/api/tasks/install-package")
async def install_package(request: Request, payload: InstallPackageRequest) -> JSONResponse:
    try:
        task = await _services(request).task_manager.start_install_package(payload.package)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(task)


@router.post("/api/tasks/console")
async def run_console_command(request: Request, payload: ConsoleCommandRequest) -> JSONResponse:
    if not auth_enabled(_app_state(request).config, _ui_auth(request)):
        raise HTTPException(
            status_code=403,
            detail="Konsole erfordert aktiviertes Panel-Login (Einstellungen → Sicherheit oder UI_USERNAME/UI_PASSWORD).",
        )
    try:
        task = await _services(request).task_manager.start_console_command(payload.command)
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(task)


@router.websocket("/ws/logs/{channel}")
async def websocket_logs(websocket: WebSocket, channel: str) -> None:
    if channel not in {"bot", "system"}:
        await websocket.close(code=1008)
        return

    ws_ui_auth = getattr(websocket.app.state, "ui_auth_service", None)
    if auth_enabled(websocket.app.state.config, ws_ui_auth) and not websocket.session.get(SESSION_USER_KEY):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    registry = websocket.app.state.server_registry_service
    runtime = registry.get_runtime(
        websocket.query_params.get("server_id") or websocket.cookies.get(ACTIVE_SERVER_COOKIE)
    )
    log_service = runtime.log_service
    queue = log_service.subscribe(channel)

    try:
        for line in log_service.tail(channel, limit=200):
            await websocket.send_text(line)
        while True:
            line = await queue.get()
            await websocket.send_text(line)
    except WebSocketDisconnect:
        pass
    finally:
        log_service.unsubscribe(channel, queue)
