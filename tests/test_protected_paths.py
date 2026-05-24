"""Unit tests for git deploy protected paths and pattern matching."""
from __future__ import annotations

import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.git_deploy_service import (
    DEFAULT_PROTECTED_PATHS,
    GitDeployService,
)


def _make_service(workspace: Path, *, keep: bool = True, protected=None, extras=None) -> GitDeployService:
    service = GitDeployService.__new__(GitDeployService)
    service.workspace_dir = workspace
    service._settings = SimpleNamespace(  # type: ignore[attr-defined]
        keep_user_data=keep,
        protected_paths=list(protected or []),
        extra_protected_paths=list(extras or []),
        history=[],
    )
    return service


def test_validate_pattern_accepts_globs():
    cleaned = GitDeployService._validate_pattern("data/**")
    assert cleaned == "data/**"
    cleaned = GitDeployService._validate_pattern("*.db")
    assert cleaned == "*.db"
    cleaned = GitDeployService._validate_pattern("config/local_*.yml")
    assert cleaned == "config/local_*.yml"
    assert GitDeployService._validate_pattern("") == ""


@pytest.mark.parametrize("bad", ["..", "../etc", "a/../b", ".git", ".git/foo"])
def test_validate_pattern_rejects_traversal(bad):
    with pytest.raises(ValueError):
        GitDeployService._validate_pattern(bad)


def test_is_protected_handles_globs(tmp_path):
    service = _make_service(tmp_path, protected=["data", "*.db"], extras=["config/local_*.yml"])
    patterns = service._effective_patterns()
    assert service._is_protected(".env", patterns) is False
    assert service._is_protected("data", patterns)
    assert service._is_protected("data/state.json", patterns)
    assert service._is_protected("metrics.db", patterns)
    assert service._is_protected("config/local_secrets.yml", patterns)
    assert service._is_protected("config/global.yml", patterns) is False


def test_double_star_glob(tmp_path):
    service = _make_service(tmp_path, protected=["data/**"])
    patterns = service._effective_patterns()
    assert service._is_protected("data/foo/bar.json", patterns)
    assert service._is_protected("data/foo", patterns)
    assert service._is_protected("other/foo", patterns) is False


def test_keep_user_data_disabled_clears_patterns(tmp_path):
    service = _make_service(tmp_path, keep=False, protected=["data"])
    assert service._effective_patterns() == []


def test_stash_and_restore_preserves_files(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".env").write_text("TOKEN=secret", encoding="utf-8")
    (workspace / "bot.py").write_text("print('hi')", encoding="utf-8")
    data_dir = workspace / "data"
    data_dir.mkdir()
    (data_dir / "state.json").write_text('{"x": 1}', encoding="utf-8")

    service = _make_service(workspace, protected=[".env", "data"])
    keep_dir = tmp_path / "keep"
    keep_dir.mkdir()
    preserved = service._stash_protected(keep_dir, service._effective_patterns())
    assert ".env" in preserved
    assert "data" in preserved or "data/state.json" in preserved

    # wipe the workspace
    for item in workspace.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()

    (workspace / "bot.py").write_text("print('updated')", encoding="utf-8")
    service._restore_protected(keep_dir, preserved)

    assert (workspace / ".env").read_text(encoding="utf-8") == "TOKEN=secret"
    assert (workspace / "data" / "state.json").read_text(encoding="utf-8") == '{"x": 1}'
    assert (workspace / "bot.py").read_text(encoding="utf-8") == "print('updated')"


def test_default_protected_paths_constant_is_stable():
    assert ".env" in DEFAULT_PROTECTED_PATHS
    assert "data" in DEFAULT_PROTECTED_PATHS
