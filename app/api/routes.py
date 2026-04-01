from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.background import BackgroundTask

from app.core.schemas import (
    BotSettingsModel,
    ConsoleCommandRequest,
    CreateEntryRequest,
    DeleteEntriesRequest,
    DownloadSelectionRequest,
    ExtractArchiveRequest,
    InstallPackageRequest,
    RenameEntryRequest,
    SaveEnvRequest,
    SaveFileRequest,
    TransferEntriesRequest,
)


router = APIRouter()


NAVIGATION: list[dict[str, Any]] = [
    {
        "section": "Allgemein",
        "items": [
            {"key": "dashboard", "label": "Dashboard", "href": "/dashboard"},
            {"key": "console", "label": "Konsole", "href": "/console"},
            {"key": "activity", "label": "Aktivität", "href": "/activity"},
        ],
    },
    {
        "section": "Verwaltung",
        "items": [
            {"key": "files", "label": "Dateien", "href": "/files"},
        ],
    },
    {
        "section": "Konfiguration",
        "items": [
            {"key": "startup", "label": "Start & Pakete", "href": "/startup"},
            {"key": "environment", "label": "Umgebungsvariablen", "href": "/environment"},
        ],
    },
]


def _services(request: Request):
    return request.app.state


def _raise_bad_request(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def _page_context(
    request: Request,
    *,
    active_page: str,
    page_title: str,
    page_kicker: str,
    page_heading: str,
    page_description: str,
) -> dict[str, Any]:
    state = _services(request)
    settings = state.settings_service.get()
    env_entries = state.env_service.list_entries()
    server_address = request.headers.get("host") or f"localhost:{state.config.port}"
    return {
        "request": request,
        "app_name": state.config.app_name,
        "page_title": page_title,
        "page_kicker": page_kicker,
        "page_heading": page_heading,
        "page_description": page_description,
        "active_page": active_page,
        "navigation": NAVIGATION,
        "settings": settings.model_dump(mode="json"),
        "env_entries": [entry.model_dump(mode="json") for entry in env_entries],
        "workspace_path": str(state.config.workspace_dir),
        "auth_enabled": bool(state.config.ui_username and state.config.ui_password),
        "server_address": server_address,
    }


@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "dashboard.html",
        _page_context(
            request,
            active_page="dashboard",
            page_title="Dashboard",
            page_kicker="Laufzeitübersicht",
            page_heading="Steuere deinen Discord-Bot wie ein lokales Control Panel.",
            page_description="Klare Statusanzeigen, schnelle Aktionen und deutlich mehr Platz für die Dinge, die du wirklich brauchst.",
        ),
    )


@router.get("/files", response_class=HTMLResponse)
async def files_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "files.html",
        _page_context(
            request,
            active_page="files",
            page_title="Dateien",
            page_kicker="Workspace",
            page_heading="Dateimanager und Editor für dein Bot-Projekt.",
            page_description="Dateien hochladen, ZIP-Archive entpacken, Ordner verwalten und Quelltext direkt im Browser bearbeiten.",
        ),
    )


@router.get("/console", response_class=HTMLResponse)
async def console_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "console.html",
        _page_context(
            request,
            active_page="console",
            page_title="Konsole",
            page_kicker="Aufgaben & Befehle",
            page_heading="Sichere Web-Konsole für gezielte Wartungsbefehle.",
            page_description="Führe erlaubte Befehle im Workspace aus, beobachte die Ausgabe und behalte deine letzten Tasks im Blick.",
        ),
    )


@router.get("/startup", response_class=HTMLResponse)
@router.get("/settings", response_class=HTMLResponse)
async def startup_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "startup.html",
        _page_context(
            request,
            active_page="startup",
            page_title="Start & Pakete",
            page_kicker="Runtime-Konfiguration",
            page_heading="Definiere Startbefehl, venv-Verhalten und Paketinstallation.",
            page_description="Passe den Bot-Start an dein Projekt an und installiere Abhängigkeiten ohne zusätzliche Shell-Fummelei.",
        ),
    )


@router.get("/environment", response_class=HTMLResponse)
async def environment_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "environment.html",
        _page_context(
            request,
            active_page="environment",
            page_title="Umgebungsvariablen",
            page_kicker="Konfiguration",
            page_heading="Verwalte deine .env sauber, sicher und übersichtlich.",
            page_description="Tokens und Konfigurationswerte bleiben lokal, maskierbar und werden beim Bot-Start direkt berücksichtigt.",
        ),
    )


@router.get("/activity", response_class=HTMLResponse)
@router.get("/logs", response_class=HTMLResponse)
async def activity_page(request: Request) -> HTMLResponse:
    state = _services(request)
    return state.templates.TemplateResponse(
        request,
        "activity.html",
        _page_context(
            request,
            active_page="activity",
            page_title="Aktivität",
            page_kicker="Logs & Verlauf",
            page_heading="Bot-Logs, Systemereignisse und letzte Prozesswechsel an einem Ort.",
            page_description="Behalte Start-, Stop- und Crash-Ereignisse im Blick und lade Logdateien direkt aus der Oberfläche herunter.",
        ),
    )


@router.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


@router.get("/api/status")
async def get_status(request: Request) -> JSONResponse:
    return JSONResponse(await _services(request).bot_manager.status())


@router.get("/api/history")
async def get_history(request: Request) -> JSONResponse:
    return JSONResponse({"items": await _services(request).bot_manager.history()})


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
    await _services(request).log_service.write("system", "Bot-Einstellungen wurden gespeichert.")
    return JSONResponse(settings.model_dump(mode="json"))


@router.get("/api/logs/{channel}/download")
async def download_logs(request: Request, channel: str) -> FileResponse:
    if channel not in {"bot", "system"}:
        raise HTTPException(status_code=404, detail="Unbekannter Log-Kanal.")
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