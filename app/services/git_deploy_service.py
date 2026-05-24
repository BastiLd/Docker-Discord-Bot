from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from app.core.schemas import GitDeploySettingsModel, GitDeployUpdateRequest
from app.core.utils import isoformat, utc_now
from app.services.backup_service import BackupService
from app.services.bot_manager import BotManager
from app.services.log_service import LogService
from app.services.task_manager import TaskManager


GITHUB_REPO_PATTERN = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
PROTECTED_PATH_PATTERN = re.compile(r"^[A-Za-z0-9_.\-][A-Za-z0-9_.\- ]*$")
DEFAULT_PROTECTED_PATHS: tuple[str, ...] = (".env", "data", "config", "logs")


class GitDeployService:
    def __init__(
        self,
        settings_path: Path,
        workspace_dir: Path,
        backup_service: BackupService,
        bot_manager: BotManager,
        task_manager: TaskManager,
        log_service: LogService,
    ) -> None:
        self.settings_path = settings_path
        self.workspace_dir = workspace_dir.resolve()
        self.backup_service = backup_service
        self.bot_manager = bot_manager
        self.task_manager = task_manager
        self.log_service = log_service
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self._settings = self._load()
        self._lock = asyncio.Lock()

    def get(self) -> dict:
        payload = self._settings.model_dump(mode="json")
        payload["workspace_report"] = self.workspace_report()
        payload["workspace_entries"] = self.workspace_entries()
        payload["default_protected_paths"] = list(DEFAULT_PROTECTED_PATHS)
        return payload

    def update(self, payload: GitDeployUpdateRequest) -> dict:
        repo_url = self._normalize_repo_url(payload.repo_url)
        branch = self._validate_branch(payload.branch)
        protected = self._normalize_protected_paths(payload.protected_paths)
        self._settings = self._settings.model_copy(
            update={
                "repo_url": repo_url,
                "branch": branch,
                "auto_update": payload.auto_update,
                "install_requirements": payload.install_requirements,
                "restart_after_update": payload.restart_after_update,
                "keep_user_data": payload.keep_user_data,
                "protected_paths": protected,
                "status": "configured" if repo_url else "not_configured",
                "message": "",
            }
        )
        self._save()
        return self.get()

    async def check_update(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            remote_commit = await self._remote_commit(repo_url, branch)
            local_commit = await self._local_commit()
            status = "update_available" if local_commit and remote_commit != local_commit else "up_to_date"
            if not local_commit:
                status = "not_imported"
            message = self._message_for_status(status)
            self._settings = self._settings.model_copy(
                update={
                    "last_commit": local_commit,
                    "last_remote_commit": remote_commit,
                    "last_checked_at": isoformat(utc_now()),
                    "status": status,
                    "message": message,
                }
            )
            self._save()
            await self.log_service.write("system", f"Git-Update geprüft: {message}")
            return self.get()

    async def import_repo(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            was_running = (await self.bot_manager.status()).get("state") == "running"
            if was_running:
                await self.bot_manager.stop()

            backup = self.backup_service.create_backup()
            await self.log_service.write("system", f"Backup vor Git-Import erstellt: {backup['name']}")

            preserved_paths = self._effective_protected_paths()
            with tempfile.TemporaryDirectory(prefix="git-deploy-keep-") as keep_dir:
                preserved = self._stash_protected(Path(keep_dir), preserved_paths)
                self._clear_workspace()
                await self._run_git(["git", "clone", "--branch", branch, "--single-branch", repo_url, "."], cwd=self.workspace_dir)
                self._restore_protected(Path(keep_dir), preserved)
            local_commit = await self._local_commit()

            if self._settings.install_requirements:
                await self._run_dependency_task()

            if was_running and self._settings.restart_after_update:
                await self.bot_manager.start()

            report = self.workspace_report()
            base_message = "Repository importiert."
            if preserved:
                base_message += f" Behaltene Pfade: {', '.join(preserved)}."
            self._settings = self._settings.model_copy(
                update={
                    "last_commit": local_commit,
                    "last_remote_commit": local_commit,
                    "last_updated_at": isoformat(utc_now()),
                    "status": "imported",
                    "message": self._message_with_report(base_message, report),
                }
            )
            self._save()
            await self.log_service.write("system", f"Git-Repo importiert: {repo_url} ({branch})")
            return self.get()

    async def update_repo(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            if not (self.workspace_dir / ".git").exists():
                raise ValueError("Repository ist noch nicht importiert. Bitte zuerst importieren.")

            was_running = (await self.bot_manager.status()).get("state") == "running"
            if was_running:
                await self.bot_manager.stop()

            backup = self.backup_service.create_backup()
            await self.log_service.write("system", f"Backup vor Git-Update erstellt: {backup['name']}")

            preserved_paths = self._effective_protected_paths()
            with tempfile.TemporaryDirectory(prefix="git-deploy-keep-") as keep_dir:
                preserved = self._stash_protected(Path(keep_dir), preserved_paths)
                await self._run_git(["git", "remote", "set-url", "origin", repo_url], cwd=self.workspace_dir)
                await self._run_git(["git", "fetch", "--prune", "origin", branch], cwd=self.workspace_dir)
                await self._run_git(["git", "checkout", "-B", branch, f"origin/{branch}"], cwd=self.workspace_dir)
                await self._run_git(["git", "reset", "--hard", f"origin/{branch}"], cwd=self.workspace_dir)
                await self._run_git(["git", "clean", "-fd"], cwd=self.workspace_dir)
                self._restore_protected(Path(keep_dir), preserved)
            local_commit = await self._local_commit()

            if self._settings.install_requirements:
                await self._run_dependency_task()

            if was_running and self._settings.restart_after_update:
                await self.bot_manager.start()

            report = self.workspace_report()
            base_message = "Repository aktualisiert."
            if preserved:
                base_message += f" Behaltene Pfade: {', '.join(preserved)}."
            self._settings = self._settings.model_copy(
                update={
                    "last_commit": local_commit,
                    "last_remote_commit": local_commit,
                    "last_updated_at": isoformat(utc_now()),
                    "status": "updated",
                    "message": self._message_with_report(base_message, report),
                }
            )
            self._save()
            await self.log_service.write("system", f"Git-Repo aktualisiert: {repo_url} ({branch})")
            return self.get()

    async def maybe_auto_update(self) -> None:
        if not self._settings.auto_update or not self._settings.repo_url:
            return
        try:
            checked = await self.check_update()
            if checked.get("status") == "update_available":
                await self.update_repo()
        except Exception as exc:  # noqa: BLE001
            await self.log_service.write("system", f"Auto-Update fehlgeschlagen: {exc}")

    def _load(self) -> GitDeploySettingsModel:
        if not self.settings_path.exists():
            settings = GitDeploySettingsModel()
            self._write(settings)
            return settings
        try:
            data = json.loads(self.settings_path.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff"))
        except (json.JSONDecodeError, OSError):
            data = {}
        return GitDeploySettingsModel.model_validate(data or {})

    def _save(self) -> None:
        self._write(self._settings)

    def _write(self, settings: GitDeploySettingsModel) -> None:
        self.settings_path.write_text(json.dumps(settings.model_dump(mode="json"), indent=2, ensure_ascii=False), encoding="utf-8")

    def _require_config(self) -> tuple[str, str]:
        repo_url = self._normalize_repo_url(self._settings.repo_url)
        branch = self._validate_branch(self._settings.branch)
        if not repo_url:
            raise ValueError("Bitte zuerst eine öffentliche GitHub-Repo-URL speichern.")
        return repo_url, branch

    def _normalize_repo_url(self, repo_url: str) -> str:
        value = (repo_url or "").strip()
        if not value:
            return ""
        match = GITHUB_REPO_PATTERN.match(value)
        if not match:
            raise ValueError("Nur öffentliche HTTPS-GitHub-Repos sind erlaubt, z. B. https://github.com/user/repo.")
        owner, repo = match.groups()
        return f"https://github.com/{owner}/{repo}.git"

    def _validate_branch(self, branch: str) -> str:
        value = (branch or "main").strip()
        if not BRANCH_PATTERN.match(value) or value.startswith(("-", "/", ".")) or ".." in value:
            raise ValueError("Branch-Name ist ungültig.")
        return value

    def _clear_workspace(self) -> None:
        for item in self.workspace_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

    def _normalize_protected_paths(self, raw_paths: list[str] | None) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for raw in raw_paths or []:
            cleaned = self._validate_protected_path(raw)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                result.append(cleaned)
        return result

    @staticmethod
    def _validate_protected_path(value: str) -> str:
        candidate = (value or "").strip().strip("/").strip("\\")
        if not candidate:
            return ""
        if candidate in {".", ".."} or "/" in candidate or "\\" in candidate:
            raise ValueError(f"Geschützter Pfad ist ungültig: {value!r}")
        if not PROTECTED_PATH_PATTERN.match(candidate):
            raise ValueError(f"Geschützter Pfad enthält ungültige Zeichen: {value!r}")
        if candidate == ".git":
            raise ValueError("Der Ordner .git darf nicht als geschützter Pfad ausgewählt werden.")
        return candidate

    def _effective_protected_paths(self) -> list[str]:
        if not self._settings.keep_user_data:
            return []
        return list(self._settings.protected_paths or [])

    def workspace_entries(self) -> list[dict]:
        if not self.workspace_dir.exists():
            return []
        entries: list[dict] = []
        for item in sorted(self.workspace_dir.iterdir(), key=lambda entry: (entry.is_file(), entry.name.lower())):
            if item.name == ".git":
                continue
            entries.append(
                {
                    "name": item.name,
                    "kind": "directory" if item.is_dir() else "file",
                }
            )
        return entries

    def _stash_protected(self, keep_dir: Path, requested: list[str]) -> list[str]:
        preserved: list[str] = []
        for name in requested:
            source = self.workspace_dir / name
            if not source.exists():
                continue
            destination = keep_dir / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination, symlinks=True)
            else:
                shutil.copy2(source, destination)
            preserved.append(name)
        return preserved

    def _restore_protected(self, keep_dir: Path, preserved: list[str]) -> None:
        for name in preserved:
            source = keep_dir / name
            if not source.exists():
                continue
            destination = self.workspace_dir / name
            if destination.exists():
                if destination.is_dir():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination, symlinks=True)
            else:
                shutil.copy2(source, destination)

    def workspace_report(self) -> dict:
        expected_entrypoint = self._expected_entrypoint()
        missing: list[str] = []
        warnings: list[str] = []
        if expected_entrypoint and not (self.workspace_dir / expected_entrypoint).exists():
            missing.append(expected_entrypoint)
        if not (self.workspace_dir / "requirements.txt").exists():
            warnings.append("requirements.txt fehlt. Abhängigkeiten können dann nicht automatisch installiert werden.")
        if not (self.workspace_dir / ".env").exists():
            warnings.append(".env fehlt. Das ist normal, wenn Secrets nicht im Repo liegen; lade sie hoch oder speichere Variablen in Startup.")
        return {
            "entrypoint": expected_entrypoint,
            "missing": missing,
            "warnings": warnings,
            "ok": not missing,
        }

    def _expected_entrypoint(self) -> str:
        try:
            command = self.bot_manager.settings_service.get().start_command
        except Exception:  # noqa: BLE001
            command = "python bot.py"
        parts = command.split()
        for part in parts[1:] if parts and "python" in Path(parts[0]).name.lower() else parts:
            if part.endswith(".py"):
                parsed = urlparse(part)
                return Path(parsed.path or part).name
        return "bot.py"

    @staticmethod
    def _message_with_report(message: str, report: dict) -> str:
        notes: list[str] = []
        missing = report.get("missing") or []
        warnings = report.get("warnings") or []
        if missing:
            notes.append(f"Fehlende benötigte Datei(en): {', '.join(missing)}.")
        if warnings:
            notes.extend(str(item) for item in warnings)
        return " ".join([message, *notes]).strip()

    async def _local_commit(self) -> str:
        if not (self.workspace_dir / ".git").exists():
            return ""
        try:
            return (await self._run_git(["git", "rev-parse", "HEAD"], cwd=self.workspace_dir)).strip()
        except ValueError:
            return ""

    async def _remote_commit(self, repo_url: str, branch: str) -> str:
        output = await self._run_git(["git", "ls-remote", "--heads", repo_url, branch], cwd=self.workspace_dir)
        first = output.strip().splitlines()[0] if output.strip() else ""
        if not first:
            raise ValueError("Branch wurde im Repository nicht gefunden.")
        return first.split()[0]

    async def _run_dependency_task(self) -> None:
        task = await self.task_manager.start_install_requirements()
        task_id = task["task_id"]
        while True:
            current = await self.task_manager.get_task(task_id)
            if current["status"] in {"success", "failed"}:
                if current["status"] == "failed":
                    raise ValueError("Abhängigkeiten konnten nicht installiert werden.")
                return
            await asyncio.sleep(0.5)

    async def _run_git(self, command: list[str], cwd: Path) -> str:
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(cwd),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert process.stdout is not None
        try:
            output_bytes = await asyncio.wait_for(process.stdout.read(), timeout=300)
            exit_code = await asyncio.wait_for(process.wait(), timeout=10)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            raise ValueError("Git-Befehl hat zu lange gedauert.") from exc
        output = output_bytes.decode("utf-8", errors="replace")
        if exit_code != 0:
            raise ValueError(output.strip() or f"Git-Befehl fehlgeschlagen: {command[1]}")
        return output

    @staticmethod
    def _message_for_status(status: str) -> str:
        return {
            "up_to_date": "Repository ist aktuell.",
            "update_available": "Update verfügbar.",
            "not_imported": "Repository ist gespeichert, aber noch nicht importiert.",
        }.get(status, status)
