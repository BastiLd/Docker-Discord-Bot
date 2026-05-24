from __future__ import annotations

import asyncio
import fnmatch
import json
import os
import re
import shutil
import tempfile
import zipfile
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import urlparse

from app.core.schemas import (
    GitDeployHistoryEntry,
    GitDeployProtectedAddRequest,
    GitDeploySettingsModel,
    GitDeployUpdateRequest,
)
from app.core.utils import isoformat, utc_now
from app.services.backup_service import BackupService
from app.services.bot_manager import BotManager
from app.services.log_service import LogService
from app.services.task_manager import TaskManager


GITHUB_REPO_PATTERN = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
PROTECTED_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9_.\-* ?\[\]]+$")
DEFAULT_PROTECTED_PATHS: tuple[str, ...] = (".env", "data", "config", "logs")
HISTORY_LIMIT = 50


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

    # ---- public surface -------------------------------------------------

    def get(self) -> dict:
        payload = self._settings.model_dump(mode="json")
        payload["workspace_report"] = self.workspace_report()
        payload["workspace_entries"] = self.workspace_entries()
        payload["default_protected_paths"] = list(DEFAULT_PROTECTED_PATHS)
        return payload

    def update(self, payload: GitDeployUpdateRequest) -> dict:
        repo_url = self._normalize_repo_url(payload.repo_url)
        branch = self._validate_branch(payload.branch)
        protected = self._normalize_patterns(payload.protected_paths)
        extras = self._normalize_patterns(payload.extra_protected_paths)
        self._settings = self._settings.model_copy(
            update={
                "repo_url": repo_url,
                "branch": branch,
                "auto_update": payload.auto_update,
                "install_requirements": payload.install_requirements,
                "restart_after_update": payload.restart_after_update,
                "keep_user_data": payload.keep_user_data,
                "protected_paths": protected,
                "extra_protected_paths": extras,
                "status": "configured" if repo_url else "not_configured",
                "message": "",
            }
        )
        self._save()
        return self.get()

    def add_protected_pattern(self, payload: GitDeployProtectedAddRequest) -> dict:
        pattern = self._validate_pattern(payload.pattern)
        existing_protected = list(self._settings.protected_paths or [])
        existing_extras = list(self._settings.extra_protected_paths or [])
        if pattern in existing_protected or pattern in existing_extras:
            return self.get()
        existing_extras.append(pattern)
        self._settings = self._settings.model_copy(update={"extra_protected_paths": existing_extras})
        self._save()
        return self.get()

    def remove_protected_pattern(self, pattern: str) -> dict:
        cleaned = (pattern or "").strip()
        if not cleaned:
            raise ValueError("Pattern darf nicht leer sein.")
        protected = [p for p in (self._settings.protected_paths or []) if p != cleaned]
        extras = [p for p in (self._settings.extra_protected_paths or []) if p != cleaned]
        if (
            protected == self._settings.protected_paths
            and extras == self._settings.extra_protected_paths
        ):
            raise ValueError("Pattern wurde nicht gefunden.")
        self._settings = self._settings.model_copy(
            update={"protected_paths": protected, "extra_protected_paths": extras}
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

    async def preview_update(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            if not (self.workspace_dir / ".git").exists():
                raise ValueError("Repository ist noch nicht importiert. Bitte zuerst importieren.")
            await self._run_git(["git", "remote", "set-url", "origin", repo_url], cwd=self.workspace_dir)
            await self._run_git(["git", "fetch", "--prune", "origin", branch], cwd=self.workspace_dir)
            local_commit = await self._local_commit()
            remote_ref = f"origin/{branch}"
            remote_commit = (await self._run_git(["git", "rev-parse", remote_ref], cwd=self.workspace_dir)).strip()
            diff_output = (
                await self._run_git(
                    ["git", "diff", "--name-status", "HEAD", remote_ref],
                    cwd=self.workspace_dir,
                )
            ).strip()
            patterns = self._effective_patterns()
            added, modified, removed = [], [], []
            kept_protected: list[dict] = []
            for line in diff_output.splitlines():
                if not line.strip():
                    continue
                parts = line.split(maxsplit=1)
                if len(parts) != 2:
                    continue
                status_code, path = parts[0], parts[1].strip()
                rel = path.replace("\\", "/")
                bucket = (
                    added if status_code.startswith("A")
                    else removed if status_code.startswith("D")
                    else modified
                )
                protected = self._is_protected(rel, patterns)
                entry = {"path": rel, "protected": protected}
                bucket.append(entry)
                if protected:
                    kept_protected.append({"path": rel, "change": status_code})
            return {
                "local_commit": local_commit,
                "remote_commit": remote_commit,
                "added": added,
                "modified": modified,
                "removed": removed,
                "kept": kept_protected,
                "totals": {
                    "added": len(added),
                    "modified": len(modified),
                    "removed": len(removed),
                    "kept": len(kept_protected),
                },
            }

    async def import_repo(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            return await self._run_replace_workflow(
                action="import",
                repo_url=repo_url,
                branch=branch,
                requires_existing=False,
            )

    async def update_repo(self) -> dict:
        async with self._lock:
            repo_url, branch = self._require_config()
            if not (self.workspace_dir / ".git").exists():
                raise ValueError("Repository ist noch nicht importiert. Bitte zuerst importieren.")
            return await self._run_replace_workflow(
                action="update",
                repo_url=repo_url,
                branch=branch,
                requires_existing=True,
            )

    async def rollback(self, backup_name: str) -> dict:
        async with self._lock:
            backup_path = self.backup_service.resolve(backup_name)
            entry = self._find_history_entry(backup_name)
            from_commit = (entry.from_commit if entry else "") or await self._local_commit()

            was_running = (await self.bot_manager.status()).get("state") == "running"
            if was_running:
                await self.bot_manager.stop()

            safety_backup = self.backup_service.create_backup()
            await self.log_service.write(
                "system",
                f"Sicherheits-Backup vor Rollback erstellt: {safety_backup['name']}",
            )

            self._clear_workspace()
            self._restore_backup_zip(backup_path)
            local_commit = await self._local_commit()

            if was_running and self._settings.restart_after_update:
                await self.bot_manager.start()

            history_entry = GitDeployHistoryEntry(
                timestamp=isoformat(utc_now()),
                action="rollback",
                from_commit=from_commit,
                to_commit=local_commit,
                backup_name=backup_name,
                added=0,
                modified=0,
                removed=0,
                kept=0,
                message=f"Rollback auf Backup {backup_name}.",
            )
            history = [history_entry, *self._settings.history][:HISTORY_LIMIT]

            self._settings = self._settings.model_copy(
                update={
                    "last_commit": local_commit,
                    "last_remote_commit": local_commit,
                    "last_updated_at": isoformat(utc_now()),
                    "status": "rolled_back",
                    "message": history_entry.message,
                    "history": history,
                }
            )
            self._save()
            await self.log_service.write("system", f"Git-Repo per Rollback zurückgesetzt: {backup_name}")
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

    # ---- workspace inspection ------------------------------------------

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

    # ---- internal: workflow --------------------------------------------

    async def _run_replace_workflow(
        self,
        *,
        action: str,
        repo_url: str,
        branch: str,
        requires_existing: bool,
    ) -> dict:
        was_running = (await self.bot_manager.status()).get("state") == "running"
        if was_running:
            await self.bot_manager.stop()

        from_commit = await self._local_commit() if requires_existing else ""
        before_paths = self._collect_workspace_files()

        backup = self.backup_service.create_backup()
        await self.log_service.write("system", f"Backup vor Git-{action} erstellt: {backup['name']}")

        patterns = self._effective_patterns()
        with tempfile.TemporaryDirectory(prefix="git-deploy-keep-") as keep_dir:
            preserved = self._stash_protected(Path(keep_dir), patterns)
            self._clear_workspace()
            if action == "import":
                await self._run_git(
                    ["git", "clone", "--branch", branch, "--single-branch", repo_url, "."],
                    cwd=self.workspace_dir,
                )
            else:
                await self._run_git(["git", "clone", "--branch", branch, "--single-branch", repo_url, "."], cwd=self.workspace_dir)
            self._restore_protected(Path(keep_dir), preserved)

        local_commit = await self._local_commit()
        after_paths = self._collect_workspace_files()
        added = sorted(after_paths - before_paths)
        removed = sorted(before_paths - after_paths)
        modified_count = max(len(after_paths & before_paths) - sum(1 for _ in ()), 0)
        # for honest counts of modified files we rely on git diff only when both commits exist
        modified = []
        if from_commit and local_commit and from_commit != local_commit:
            try:
                diff = await self._run_git(
                    ["git", "diff", "--name-only", from_commit, local_commit],
                    cwd=self.workspace_dir,
                )
                modified = [line.strip() for line in diff.splitlines() if line.strip()]
            except ValueError:
                modified = []

        if self._settings.install_requirements:
            await self._run_dependency_task()

        if was_running and self._settings.restart_after_update:
            await self.bot_manager.start()

        report = self.workspace_report()
        if action == "import":
            base_message = "Repository importiert."
        else:
            base_message = "Repository aktualisiert."
        if preserved:
            base_message += f" Behaltene Pfade: {', '.join(preserved)}."

        history_entry = GitDeployHistoryEntry(
            timestamp=isoformat(utc_now()),
            action=action,  # type: ignore[arg-type]
            from_commit=from_commit,
            to_commit=local_commit,
            backup_name=backup["name"],
            added=len(added),
            modified=len(modified),
            removed=len(removed),
            kept=len(preserved),
            message=base_message,
        )
        history = [history_entry, *self._settings.history][:HISTORY_LIMIT]

        status = "imported" if action == "import" else "updated"
        self._settings = self._settings.model_copy(
            update={
                "last_commit": local_commit,
                "last_remote_commit": local_commit,
                "last_updated_at": isoformat(utc_now()),
                "status": status,
                "message": self._message_with_report(base_message, report),
                "history": history,
            }
        )
        self._save()
        await self.log_service.write("system", f"Git-Repo {action}: {repo_url} ({branch})")
        # silence unused warning
        _ = modified_count
        return self.get()

    # ---- internal: protected-paths -------------------------------------

    def _normalize_patterns(self, raw: Iterable[str] | None) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in raw or []:
            cleaned = self._validate_pattern(value)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                result.append(cleaned)
        return result

    @staticmethod
    def _validate_pattern(value: str) -> str:
        candidate = (value or "").strip().replace("\\", "/").strip("/")
        if not candidate:
            return ""
        if candidate in {".", ".."} or ".." in candidate.split("/"):
            raise ValueError(f"Pfad-Pattern ist ungültig: {value!r}")
        for segment in candidate.split("/"):
            if not segment:
                raise ValueError(f"Pfad-Pattern ist ungültig: {value!r}")
            if segment == "**":
                continue
            if not PROTECTED_SEGMENT_PATTERN.match(segment):
                raise ValueError(f"Pfad-Pattern enthält ungültige Zeichen: {value!r}")
        if candidate == ".git" or candidate.startswith(".git/"):
            raise ValueError("Der Ordner .git darf nicht als geschützter Pfad ausgewählt werden.")
        return candidate

    def _effective_patterns(self) -> list[str]:
        if not self._settings.keep_user_data:
            return []
        seen: set[str] = set()
        merged: list[str] = []
        for source in (self._settings.protected_paths, self._settings.extra_protected_paths):
            for value in source or []:
                if value and value not in seen:
                    seen.add(value)
                    merged.append(value)
        return merged

    def _is_protected(self, relative_path: str, patterns: Iterable[str]) -> bool:
        normalized = relative_path.replace("\\", "/").strip("/")
        if not normalized:
            return False
        candidates = {normalized}
        # Also test all parent paths so a folder pattern matches its descendants.
        parts = normalized.split("/")
        for index in range(1, len(parts)):
            candidates.add("/".join(parts[:index]))
        for pattern in patterns:
            if not pattern:
                continue
            if "*" in pattern or "?" in pattern or "[" in pattern:
                if "**" in pattern:
                    regex = self._glob_to_regex(pattern)
                    if regex.match(normalized):
                        return True
                    continue
                for candidate in candidates:
                    if fnmatch.fnmatchcase(candidate, pattern):
                        return True
                if fnmatch.fnmatchcase(normalized, pattern):
                    return True
            else:
                if normalized == pattern or normalized.startswith(pattern + "/"):
                    return True
        return False

    @staticmethod
    def _glob_to_regex(pattern: str) -> re.Pattern[str]:
        # translate ** to match any sequence (including separators), * to single segment
        result: list[str] = []
        index = 0
        while index < len(pattern):
            ch = pattern[index]
            if ch == "*":
                if pattern[index : index + 2] == "**":
                    result.append(".*")
                    index += 2
                    if index < len(pattern) and pattern[index] == "/":
                        index += 1
                    continue
                result.append("[^/]*")
            elif ch == "?":
                result.append("[^/]")
            elif ch == ".":
                result.append(r"\.")
            elif ch in "+()|^$":
                result.append("\\" + ch)
            else:
                result.append(ch)
            index += 1
        return re.compile("^" + "".join(result) + "$")

    def _stash_protected(self, keep_dir: Path, patterns: list[str]) -> list[str]:
        if not patterns:
            return []
        preserved: list[str] = []
        for relative in self._collect_workspace_paths():
            if relative.startswith(".git/") or relative == ".git":
                continue
            if not self._is_protected(relative, patterns):
                continue
            source = self.workspace_dir / relative
            if not source.exists():
                continue
            destination = keep_dir / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                if destination.exists():
                    continue
                shutil.copytree(source, destination, symlinks=True)
            else:
                shutil.copy2(source, destination)
            preserved.append(relative)
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

    def _collect_workspace_paths(self) -> list[str]:
        results: list[str] = []
        if not self.workspace_dir.exists():
            return results
        for entry in self.workspace_dir.rglob("*"):
            try:
                rel = entry.relative_to(self.workspace_dir).as_posix()
            except ValueError:
                continue
            if rel.startswith(".git/") or rel == ".git":
                continue
            results.append(rel)
        return results

    def _collect_workspace_files(self) -> set[str]:
        return {
            path
            for path in self._collect_workspace_paths()
            if (self.workspace_dir / path).is_file()
        }

    def _clear_workspace(self) -> None:
        for item in self.workspace_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

    def _restore_backup_zip(self, archive_path: Path) -> None:
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                member_name = Path(member.filename)
                if member_name.is_absolute() or ".." in member_name.parts:
                    continue
                if not member.filename.startswith("workspace/"):
                    continue
                target_rel = Path(*member_name.parts[1:]) if len(member_name.parts) > 1 else None
                if target_rel is None:
                    continue
                target_path = (self.workspace_dir / target_rel).resolve()
                if self.workspace_dir not in target_path.parents and target_path != self.workspace_dir:
                    continue
                if member.is_dir():
                    target_path.mkdir(parents=True, exist_ok=True)
                else:
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as source, target_path.open("wb") as handle:
                        shutil.copyfileobj(source, handle)

    def _find_history_entry(self, backup_name: str) -> GitDeployHistoryEntry | None:
        for entry in self._settings.history:
            if entry.backup_name == backup_name:
                return entry
        return None

    # ---- internal: persistence -----------------------------------------

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
            "rolled_back": "Workspace per Rollback wiederhergestellt.",
        }.get(status, status)
