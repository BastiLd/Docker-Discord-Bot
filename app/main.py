from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.routes import router
from app.core.config import BASE_DIR, load_config
from app.services.server_registry_service import ServerRegistryService


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    config.ensure_directories()
    server_registry_service = ServerRegistryService(config, config.config_dir / "servers.json")

    app.state.config = config
    app.state.templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
    app.state.server_registry_service = server_registry_service

    await server_registry_service.start_all_schedules()
    await server_registry_service.get_runtime("default").log_service.write("system", f"{config.app_name} ready.")
    yield
    await server_registry_service.shutdown()


app = FastAPI(title="Homelab Discord Bot Manager", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")
app.include_router(router)
