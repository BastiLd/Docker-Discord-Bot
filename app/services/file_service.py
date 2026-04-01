from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import UploadFile

from app.core.utils import human_size


TEXT_EXTENSIONS = {
    ".py",
    ".txt",
    ".md",
    ".json",
    ".env",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".log",
    ".csv",
    ".xml",
    ".html",
    ".css",
    ".js",
}


class FileService:
    def __init__(self, workspace_dir: Path, export_dir: Path, max_upload_bytes: int) -> None:
        self.workspace_dir = workspace_dir.resolve()
        self.export_dir = (export_dir / "exports").resolve()
        self.max_upload_bytes = max_upload_bytes
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.export_dir.mkdir(parents=True, exist_ok=True)

    def list_directory(self, relative_path: str = "") -> dict:
        current_dir = self.resolve(relative_path)
        if not current_dir.is_dir():
            raise ValueError("Pfad ist kein Ordner.")

        entries = []
        for item in sorted(current_dir.iterdir(), key=lambda entry: (entry.is_file(), entry.name.lower())):
            stat = item.stat()
            relative = self.relative(item)
            entries.append(
                {
                    "name": item.name,
                    "path": relative,
                    "kind": "directory" if item.is_dir() else "file",
                    "size_bytes": stat.st_size if item.is_file() else None,
                    "size_human": human_size(stat.st_size) if item.is_file() else "--",
                    "modified_at": stat.st_mtime,
                    "extension": item.suffix.lower(),
                    "editable": item.is_file() and self.is_text_file(item),
                    "extractable": item.is_file() and item.suffix.lower() == ".zip",
                }
            )

        return {
            "current_path": self.relative(current_dir),
            "breadcrumbs": self._breadcrumbs(current_dir),
            "entries": entries,
        }

    def read_text_file(self, relative_path: str, max_size_bytes: int = 2 * 1024 * 1024) -> dict:
        path = self.resolve(relative_path)
        if not path.is_file():
            raise ValueError("Datei nicht gefunden.")
        if not self.is_text_file(path):
            raise ValueError("Datei ist nicht als Text bearbeitbar.")
        if path.stat().st_size > max_size_bytes:
            raise ValueError("Datei ist fuer den Web-Editor zu gross.")
        return {
            "path": self.relative(path),
            "name": path.name,
            "content": path.read_text(encoding="utf-8", errors="replace"),
            "editable": True,
        }

    def write_text_file(self, relative_path: str, content: str) -> None:
        path = self.resolve(relative_path)
        if path.is_dir():
            raise ValueError("Ein Ordner kann nicht im Editor gespeichert werden.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def create_file(self, parent_path: str, name: str) -> str:
        self._validate_name(name)
        target = self.resolve(parent_path) / name
        target = self.resolve(self.relative(target))
        if target.exists():
            raise ValueError("Datei existiert bereits.")
        target.write_text("", encoding="utf-8")
        return self.relative(target)

    def create_folder(self, parent_path: str, name: str) -> str:
        self._validate_name(name)
        target = self.resolve(parent_path) / name
        target = self.resolve(self.relative(target))
        if target.exists():
            raise ValueError("Ordner existiert bereits.")
        target.mkdir(parents=False, exist_ok=False)
        return self.relative(target)

    def rename(self, relative_path: str, new_name: str) -> str:
        self._validate_name(new_name)
        source = self.resolve(relative_path)
        target = source.with_name(new_name)
        target = self.resolve(self.relative(target))
        if target.exists():
            raise ValueError("Zielname existiert bereits.")
        source.rename(target)
        return self.relative(target)

    def delete_many(self, relative_paths: list[str]) -> None:
        targets = sorted((self.resolve(path) for path in relative_paths), key=lambda path: len(path.parts), reverse=True)
        for target in targets:
            if not target.exists():
                continue
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()

    def move_many(self, sources: list[str], destination: str) -> None:
        target_dir = self.resolve(destination)
        if not target_dir.is_dir():
            raise ValueError("Ziel ist kein Ordner.")
        for source_path in sources:
            source = self.resolve(source_path)
            target = target_dir / source.name
            target = self.resolve(self.relative(target))
            if target.exists():
                raise ValueError(f"Ziel existiert bereits: {target.name}")
            shutil.move(str(source), str(target))

    def copy_many(self, sources: list[str], destination: str) -> None:
        target_dir = self.resolve(destination)
        if not target_dir.is_dir():
            raise ValueError("Ziel ist kein Ordner.")
        for source_path in sources:
            source = self.resolve(source_path)
            target = target_dir / source.name
            target = self.resolve(self.relative(target))
            if target.exists():
                raise ValueError(f"Ziel existiert bereits: {target.name}")
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)

    async def save_uploads(self, relative_path: str, uploads: list[UploadFile], extract_archives: bool = False) -> list[str]:
        destination = self.resolve(relative_path)
        if not destination.is_dir():
            raise ValueError("Upload-Ziel ist kein Ordner.")

        saved_paths: list[str] = []
        for upload in uploads:
            filename = Path(upload.filename or "").name
            self._validate_name(filename)
            target = destination / filename
            target = self.resolve(self.relative(target))
            if target.exists():
                raise ValueError(f"Datei existiert bereits: {filename}")
            written = 0
            with target.open("wb") as handle:
                while chunk := await upload.read(1024 * 1024):
                    written += len(chunk)
                    if written > self.max_upload_bytes:
                        handle.close()
                        target.unlink(missing_ok=True)
                        raise ValueError(f"Upload-Limit von {self.max_upload_bytes // (1024 * 1024)} MB ueberschritten.")
                    handle.write(chunk)
            saved_paths.append(self.relative(target))

            if extract_archives and target.suffix.lower() == ".zip":
                self.extract_archive(self.relative(target), self.relative(destination))

        return saved_paths

    def extract_archive(self, relative_path: str, destination: str = "") -> None:
        archive_path = self.resolve(relative_path)
        if archive_path.suffix.lower() != ".zip":
            raise ValueError("Nur ZIP-Dateien koennen entpackt werden.")
        if not archive_path.is_file():
            raise ValueError("Archiv nicht gefunden.")

        target_dir = self.resolve(destination or self.relative(archive_path.parent))

        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                member_name = Path(member.filename)
                if member_name.is_absolute() or ".." in member_name.parts:
                    raise ValueError("ZIP enthaelt unsichere Pfade.")
                target_path = (target_dir / member_name).resolve()
                if target_path != self.workspace_dir and self.workspace_dir not in target_path.parents:
                    raise ValueError("ZIP enthaelt Pfade ausserhalb des Workspace.")
            archive.extractall(target_dir)

    def create_download_archive(self, relative_paths: list[str], label: str) -> tuple[Path, str]:
        archive_name = f"{label}.zip"
        with tempfile.NamedTemporaryFile(prefix="bundle_", suffix=".zip", dir=self.export_dir, delete=False) as handle:
            archive_path = Path(handle.name)

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for relative_path in relative_paths:
                item = self.resolve(relative_path)
                if item.is_dir():
                    for file_path in item.rglob("*"):
                        if file_path.is_dir():
                            continue
                        arcname = file_path.relative_to(self.workspace_dir)
                        bundle.write(file_path, arcname=arcname.as_posix())
                else:
                    bundle.write(item, arcname=item.relative_to(self.workspace_dir).as_posix())

        return archive_path, archive_name

    def resolve(self, relative_path: str = "") -> Path:
        normalized = (relative_path or "").replace("\\", "/").strip("/")
        candidate = (self.workspace_dir / normalized).resolve()
        if candidate != self.workspace_dir and self.workspace_dir not in candidate.parents:
            raise ValueError("Pfad ausserhalb des Workspace ist nicht erlaubt.")
        return candidate

    def relative(self, path: Path) -> str:
        if path == self.workspace_dir:
            return ""
        return path.relative_to(self.workspace_dir).as_posix()

    def is_text_file(self, path: Path) -> bool:
        if path.name == ".env":
            return True
        return path.suffix.lower() in TEXT_EXTENSIONS

    def _breadcrumbs(self, current_dir: Path) -> list[dict[str, str]]:
        if current_dir == self.workspace_dir:
            return [{"name": "workspace", "path": ""}]

        crumbs = [{"name": "workspace", "path": ""}]
        current = Path()
        for part in current_dir.relative_to(self.workspace_dir).parts:
            current /= part
            crumbs.append({"name": part, "path": current.as_posix()})
        return crumbs

    @staticmethod
    def _validate_name(name: str) -> None:
        cleaned = name.strip()
        if cleaned in {"", ".", ".."}:
            raise ValueError("Ungueltiger Name.")
        if "/" in cleaned or "\\" in cleaned:
            raise ValueError("Name darf keine Pfadtrenner enthalten.")
