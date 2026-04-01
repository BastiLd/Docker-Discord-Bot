from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.routes import router
from app.core.config import BASE_DIR, load_config
from app.services.bootstrap import seed_workspace_if_empty
from app.services.bot_manager import BotManager
from app.services.env_service import EnvService
from app.services.file_service import FileService
from app.services.log_service import LogService
from app.services.settings_service import SettingsService
from app.services.task_manager import TaskManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    config.ensure_directories()
    seed_workspace_if_empty(config.workspace_dir)

    log_service = LogService(config.log_dir)
    settings_service = SettingsService(config.config_dir / "settings.json")
    env_service = EnvService(config.workspace_dir / ".env")
    file_service = FileService(config.workspace_dir, config.log_dir, config.max_upload_bytes)
    task_manager = TaskManager(config, log_service)
    bot_manager = BotManager(config, settings_service, env_service, log_service)

    app.state.config = config
    app.state.templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
    app.state.log_service = log_service
    app.state.settings_service = settings_service
    app.state.env_service = env_service
    app.state.file_service = file_service
    app.state.task_manager = task_manager
    app.state.bot_manager = bot_manager

    await log_service.write("system", f"{config.app_name} ready.")
    yield
    await bot_manager.shutdown()
    await task_manager.shutdown()


app = FastAPI(title="Homelab Discord Bot Manager", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")
app.include_router(router)
