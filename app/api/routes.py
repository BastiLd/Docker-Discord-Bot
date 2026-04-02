from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.background import BackgroundTask

from app.core.i18n import LOCALE_COOKIE, locale_cookie_value, translate, translations_for
from app.core.schemas import (
    BotSettingsModel,
    ConsoleCommandRequest,
    CreateEntryRequest,
    DeleteEntriesRequest,
    DownloadSelectionRequest,
    ExtractArchiveRequest,
    InstallPackageRequest,
    PanelMetaUpdateModel,
    RenameEntryRequest,
    SaveEnvRequest,
    SaveFileRequest,
    SaveScheduleRequest,
    TransferEntriesRequest,
)


router = APIRouter()


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


def _services(request: Request):
    return request.app.state


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


def _page_context(request: Request, *, active_page: str) -> dict[str, Any]:
    state = _services(request)
    locale = _locale(request)
    ui = translations_for(locale)
    settings = state.settings_service.get()
    env_entries = state.env_service.list_entries()
    panel_meta = state.panel_meta_service.get()
    server_address = request.headers.get("host") or f"localhost:{state.config.port}"

    return {
        "request": request,
        "app_name": state.config.app_name,
        "page_title": translate(locale, PAGE_TITLES[active_page]),
        "active_page": active_page,
        "navigation": _localized_navigation(locale),
        "settings": settings.model_dump(mode="json"),
        "panel_meta": panel_meta.model_dump(mode="json"),
        "env_entries": [entry.model_dump(mode="json") for entry in env_entries],
        "workspace_path": str(state.config.workspace_dir),
        "auth_enabled": bool(state.config.ui_username and state.config.ui_password),
        "server_address": server_address,
        "support_links": SUPPORT_LINKS,
        "locale": locale,
        "ui": ui,
        "runtime_version": f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "timezone": state.config.timezone,
    }


def _render_page(request: Request, template_name: str, *, active_page: str) -> HTMLResponse:
    return _services(request).templates.TemplateResponse(
        request,
        template_name,
        _page_context(request, active_page=active_page),
    )


@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request) -> HTMLResponse:
    return _render_page(request, "dashboard.html", active_page="dashboard")


@router.get("/console", response_class=HTMLResponse)
async def console_page(request: Request) -> HTMLResponse:
    return _render_page(request, "console.html", active_page="console")


@router.get("/settings", response_class=HTMLResponse)
@router.get("/environment", response_class=HTMLResponse)
async def settings_page(request: Request) -> HTMLResponse:
    return _render_page(request, "settings.html", active_page="settings")


@router.get("/activity", response_class=HTMLResponse)
@router.get("/logs", response_class=HTMLResponse)
async def activity_page(request: Request) -> HTMLResponse:
    return _render_page(request, "activity.html", active_page="activity")


@router.get("/files", response_class=HTMLResponse)
async def files_page(request: Request) -> HTMLResponse:
    return _render_page(request, "files.html", active_page="files")


@router.get("/databases", response_class=HTMLResponse)
async def databases_page(request: Request) -> HTMLResponse:
    return _render_page(request, "databases.html", active_page="databases")


@router.get("/backups", response_class=HTMLResponse)
async def backups_page(request: Request) -> HTMLResponse:
    return _render_page(request, "backups.html", active_page="backups")


@router.get("/network", response_class=HTMLResponse)
async def network_page(request: Request) -> HTMLResponse:
    return _render_page(request, "network.html", active_page="network")


@router.get("/schedules", response_class=HTMLResponse)
async def schedules_page(request: Request) -> HTMLResponse:
    return _render_page(request, "schedules.html", active_page="schedules")


@router.get("/users", response_class=HTMLResponse)
async def users_page(request: Request) -> HTMLResponse:
    return _render_page(request, "users.html", active_page="users")


@router.get("/startup", response_class=HTMLResponse)
async def startup_page(request: Request) -> HTMLResponse:
    return _render_page(request, "startup.html", active_page="startup")


@router.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


@router.get("/api/status")
async def get_status(request: Request) -> JSONResponse:
    return JSONResponse(await _services(request).bot_manager.status())


@router.get("/api/history")
async def get_history(request: Request) -> JSONResponse:
    return JSONResponse({"items": await _services(request).bot_manager.history()})


@router.get("/api/metrics")
async def get_metrics(request: Request) -> JSONResponse:
    return JSONResponse(_services(request).system_metrics_service.snapshot())


@router.get("/api/panel-meta")
async def get_panel_meta(request: Request) -> JSONResponse:
    payload = _services(request).panel_meta_service.get().model_dump(mode="json")
    return JSONResponse(payload)


@router.put("/api/panel-meta")
async def save_panel_meta(request: Request, payload: PanelMetaUpdateModel) -> JSONResponse:
    panel_meta = _services(request).panel_meta_service.update(payload)
    await _services(request).log_service.write("system", "Panel metadata updated.")
    return JSONResponse(panel_meta.model_dump(mode="json"))


@router.post("/api/bot/start")
async def start_bot(request: Request) -> JSONResponse:
    try:
        payload = await _services(request).bot_manager.start()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.post("/api/bot/stop")
async def stop_bot(request: Request) -> JSONResponse:
    try:
        payload = await _services(request).bot_manager.stop()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
    return JSONResponse(payload)


@router.post("/api/bot/restart")
async def restart_bot(request: Request) -> JSONResponse:
    try:
        payload = await _services(request).bot_manager.restart()
    except Exception as exc:  # noqa: BLE001
        _raise_bad_request(exc)
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
        archive_path, archive_name = _services(request).file_service.create_download_archive([path], Path(path).name or "workspace")
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
    return JSONResponse({"entries": [entry.model_dump(mode="json") for entry in _services(request).env_service.list_entries()]})


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

    await websocket.accept()
    log_service = websocket.app.state.log_service
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
