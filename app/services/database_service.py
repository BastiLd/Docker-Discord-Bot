from __future__ import annotations

import csv
import sqlite3
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.core.utils import human_size


DATABASE_EXTENSIONS = {".db", ".db3", ".sqlite", ".sqlite3"}


class DatabaseService:
    def __init__(self, workspace_dir: Path) -> None:
        self.workspace_dir = workspace_dir.resolve()
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def list_databases(self) -> dict:
        items = []
        for path in sorted(self.workspace_dir.rglob("*"), key=lambda item: item.relative_to(self.workspace_dir).as_posix().lower()):
            if not path.is_file() or path.suffix.lower() not in DATABASE_EXTENSIONS:
                continue
            stat = path.stat()
            items.append(
                {
                    "name": path.name,
                    "path": self._relative(path),
                    "size_bytes": stat.st_size,
                    "size_human": human_size(stat.st_size),
                    "modified_at": stat.st_mtime,
                }
            )
        return {"items": items}

    def inspect(self, relative_path: str) -> dict:
        db_path = self._resolve_database(relative_path)
        with self._connect(db_path, readonly=True) as connection:
            rows = connection.execute(
                """
                SELECT name, type
                FROM sqlite_master
                WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                ORDER BY type, name
                """
            ).fetchall()
            tables = []
            for row in rows:
                name = str(row["name"])
                columns = self._columns(connection, name)
                count = self._count_rows(connection, name)
                tables.append(
                    {
                        "name": name,
                        "type": str(row["type"]),
                        "columns": columns,
                        "row_count": count,
                        "editable": row["type"] == "table" and bool(columns),
                    }
                )
        return {"path": self._relative(db_path), "name": db_path.name, "tables": tables}

    def table_rows(self, relative_path: str, table: str, limit: int = 100, offset: int = 0) -> dict:
        db_path = self._resolve_database(relative_path)
        limit = max(1, min(int(limit or 100), 500))
        offset = max(0, int(offset or 0))
        with self._connect(db_path, readonly=True) as connection:
            self._require_table(connection, table)
            columns = self._columns(connection, table)
            total = self._count_rows(connection, table)
            quoted_table = self._quote_identifier(table)
            rows = connection.execute(
                f"SELECT rowid AS __rowid__, * FROM {quoted_table} LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return {
            "path": self._relative(db_path),
            "table": table,
            "columns": columns,
            "rows": [self._row_to_dict(row) for row in rows],
            "limit": limit,
            "offset": offset,
            "total": total,
        }

    def update_cell(self, relative_path: str, table: str, rowid: int, column: str, value: str | None) -> dict:
        db_path = self._resolve_database(relative_path)
        with self._connect(db_path) as connection:
            table_type = self._require_table(connection, table)
            self._require_editable_table(table_type)
            column_names = {item["name"] for item in self._columns(connection, table)}
            if column not in column_names:
                raise ValueError("Spalte wurde nicht gefunden.")
            quoted_table = self._quote_identifier(table)
            quoted_column = self._quote_identifier(column)
            cursor = connection.execute(
                f"UPDATE {quoted_table} SET {quoted_column} = ? WHERE rowid = ?",
                (value, int(rowid)),
            )
            if cursor.rowcount == 0:
                raise ValueError("Zeile wurde nicht gefunden.")
            connection.commit()
        return self.table_rows(relative_path, table)

    def insert_row(self, relative_path: str, table: str, values: dict[str, str | None]) -> dict:
        db_path = self._resolve_database(relative_path)
        with self._connect(db_path) as connection:
            table_type = self._require_table(connection, table)
            self._require_editable_table(table_type)
            columns = self._columns(connection, table)
            editable_columns = [column for column in columns if not column["primary_key"]]
            column_names = {column["name"] for column in editable_columns}
            clean_values = {
                key: (None if value == "" else value)
                for key, value in (values or {}).items()
                if key in column_names
            }
            if not clean_values:
                clean_values = {column["name"]: None for column in editable_columns if not column["notnull"]}
            if not clean_values:
                raise ValueError("Keine einfügbaren Spalten gefunden.")

            quoted_table = self._quote_identifier(table)
            quoted_columns = ", ".join(self._quote_identifier(column) for column in clean_values)
            placeholders = ", ".join("?" for _ in clean_values)
            connection.execute(
                f"INSERT INTO {quoted_table} ({quoted_columns}) VALUES ({placeholders})",
                list(clean_values.values()),
            )
            connection.commit()
        return self.table_rows(relative_path, table)

    def delete_row(self, relative_path: str, table: str, rowid: int) -> dict:
        db_path = self._resolve_database(relative_path)
        with self._connect(db_path) as connection:
            table_type = self._require_table(connection, table)
            self._require_editable_table(table_type)
            quoted_table = self._quote_identifier(table)
            cursor = connection.execute(f"DELETE FROM {quoted_table} WHERE rowid = ?", (int(rowid),))
            if cursor.rowcount == 0:
                raise ValueError("Zeile wurde nicht gefunden.")
            connection.commit()
        return self.table_rows(relative_path, table)

    def export_csv(self, relative_path: str, table: str) -> dict:
        db_path = self._resolve_database(relative_path)
        with self._connect(db_path, readonly=True) as connection:
            self._require_table(connection, table)
            columns = self._columns(connection, table)
            quoted_table = self._quote_identifier(table)
            rows = connection.execute(f"SELECT * FROM {quoted_table}").fetchall()

        output = StringIO()
        writer = csv.writer(output)
        headers = [column["name"] for column in columns]
        writer.writerow(headers)
        for row in rows:
            writer.writerow([row[column] for column in headers])
        return {
            "filename": f"{Path(relative_path).stem}-{table}.csv",
            "content": output.getvalue(),
            "row_count": len(rows),
        }

    def query(self, relative_path: str, sql: str) -> dict:
        db_path = self._resolve_database(relative_path)
        statement = sql.strip()
        if not statement:
            raise ValueError("SQL darf nicht leer sein.")
        if not self._is_readonly_statement(statement):
            raise ValueError("Nur SELECT-, WITH- und PRAGMA-Abfragen sind im SQL-Feld erlaubt. Bearbeiten geht über Zellen.")
        with self._connect(db_path, readonly=True) as connection:
            cursor = connection.execute(statement)
            rows = cursor.fetchmany(500)
            columns = [description[0] for description in (cursor.description or [])]
        return {
            "columns": columns,
            "rows": [self._row_to_dict(row) for row in rows],
            "truncated": len(rows) >= 500,
        }

    def _resolve_database(self, relative_path: str) -> Path:
        normalized = (relative_path or "").replace("\\", "/").strip("/")
        candidate = (self.workspace_dir / normalized).resolve()
        if candidate != self.workspace_dir and self.workspace_dir not in candidate.parents:
            raise ValueError("Pfad außerhalb des Workspace ist nicht erlaubt.")
        if not candidate.is_file():
            raise ValueError("Datenbankdatei wurde nicht gefunden.")
        if candidate.suffix.lower() not in DATABASE_EXTENSIONS:
            raise ValueError("Nur .db-, .db3-, .sqlite- und .sqlite3-Dateien werden unterstützt.")
        return candidate

    def _relative(self, path: Path) -> str:
        return path.relative_to(self.workspace_dir).as_posix()

    @staticmethod
    def _connect(path: Path, readonly: bool = False) -> sqlite3.Connection:
        if readonly:
            uri_path = quote(path.as_posix(), safe="/:")
            connection = sqlite3.connect(f"file:{uri_path}?mode=ro", uri=True)
        else:
            connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _quote_identifier(value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def _require_table(self, connection: sqlite3.Connection, table: str) -> str:
        row = connection.execute(
            "SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
            (table,),
        ).fetchone()
        if not row:
            raise ValueError("Tabelle wurde nicht gefunden.")
        return str(row["type"])

    @staticmethod
    def _require_editable_table(table_type: str) -> None:
        if table_type != "table":
            raise ValueError("Views können nicht direkt bearbeitet werden.")

    def _columns(self, connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
        quoted_table = self._quote_identifier(table)
        rows = connection.execute(f"PRAGMA table_info({quoted_table})").fetchall()
        return [
            {
                "name": str(row["name"]),
                "type": str(row["type"] or ""),
                "notnull": bool(row["notnull"]),
                "default": row["dflt_value"],
                "primary_key": bool(row["pk"]),
            }
            for row in rows
        ]

    def _count_rows(self, connection: sqlite3.Connection, table: str) -> int:
        quoted_table = self._quote_identifier(table)
        return int(connection.execute(f"SELECT COUNT(*) AS count FROM {quoted_table}").fetchone()["count"])

    @staticmethod
    def _is_readonly_statement(statement: str) -> bool:
        lowered = statement.lstrip().lower()
        return lowered.startswith(("select ", "select\n", "with ", "with\n", "pragma "))

    @classmethod
    def _row_to_dict(cls, row: sqlite3.Row) -> dict[str, Any]:
        return {key: cls._json_value(row[key]) for key in row.keys()}

    @staticmethod
    def _json_value(value: Any) -> Any:
        if isinstance(value, bytes):
            return value.hex()
        return value
