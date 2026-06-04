from __future__ import annotations

from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse

from app.api.routes import router
from app.core.config import BASE_DIR, load_config
from app.core.security import SESSION_USER_KEY, auth_enabled, is_public_path
from app.services.server_registry_service import ServerRegistryService
from app.services.ui_auth_service import UiAuthService

config = load_config()


class AuthMiddleware(BaseHTTPMiddleware):
    """Require a valid session for all routes once UI credentials are configured."""

    async def dispatch(self, request: Request, call_next):
        ui_auth = getattr(request.app.state, "ui_auth_service", None)
        if not auth_enabled(config, ui_auth):
            return await call_next(request)

        path = request.url.path
        if is_public_path(path) or request.session.get(SESSION_USER_KEY):
            return await call_next(request)

        if path.startswith("/api/"):
            return JSONResponse({"detail": "Authentication required."}, status_code=401)

        target = path + (f"?{request.url.query}" if request.url.query else "")
        return RedirectResponse(url=f"/login?next={quote(target, safe='')}", status_code=303)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_directories()
    server_registry_service = ServerRegistryService(config, config.config_dir / "servers.json")

    app.state.config = config
    app.state.templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
    app.state.server_registry_service = server_registry_service
    app.state.ui_auth_service = UiAuthService(config.config_dir / "ui_auth.json")

    await server_registry_service.start_all_schedules()
    await server_registry_service.get_runtime("default").log_service.write("system", f"{config.app_name} ready.")
    yield
    await server_registry_service.shutdown()


app = FastAPI(title="Homelab Discord Bot Manager", lifespan=lifespan)
# Order matters: SessionMiddleware is added last so it runs first and populates request.session
# before AuthMiddleware inspects it.
app.add_middleware(AuthMiddleware)
app.add_middleware(SessionMiddleware, secret_key=config.session_secret, same_site="lax", https_only=False)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")
app.include_router(router)
