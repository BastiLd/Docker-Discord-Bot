"""Smoke test: ensure the FastAPI app starts and key endpoints respond."""
from __future__ import annotations

import os
import tempfile

from fastapi.testclient import TestClient


def test_app_starts_and_lists_servers(monkeypatch):
    workspace = tempfile.mkdtemp(prefix="kbm-test-")
    monkeypatch.setenv("DATA_ROOT", workspace)
    monkeypatch.setenv("APP_VERSION", "0.0.0-test")

    from app import main as main_module

    client = TestClient(main_module.app)
    with client:
        response = client.get("/api/servers")
        assert response.status_code == 200
        body = response.json()
        assert "items" in body
        assert "active_server_id" in body

        retention = client.get("/api/backups/retention")
        assert retention.status_code == 200
        retention_body = retention.json()
        assert retention_body["mode"] == "30d"
        assert retention_body["enabled"] is True

        git_deploy = client.get("/api/git-deploy")
        assert git_deploy.status_code == 200
        git_body = git_deploy.json()
        assert "default_protected_paths" in git_body
        assert "extra_protected_paths" in git_body

    # cleanup
    import shutil

    shutil.rmtree(workspace, ignore_errors=True)
    _ = os
