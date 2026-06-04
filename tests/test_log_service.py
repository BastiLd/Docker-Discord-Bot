"""Tests for log clearing snapshots and restore."""
from __future__ import annotations

import asyncio
from pathlib import Path

from app.services.log_service import LogService


def test_clear_creates_snapshot_and_wipes(tmp_path: Path):
    service = LogService(tmp_path)
    service.file_for("bot").write_text("line one\nline two\n", encoding="utf-8")

    snapshot = asyncio.run(service.clear("bot"))

    assert snapshot is not None
    assert snapshot["line_count"] == 2
    assert snapshot["channel"] == "bot"
    assert service.file_for("bot").read_text(encoding="utf-8") == ""
    assert len(service.list_snapshots("bot")) == 1


def test_clear_empty_channel_makes_no_snapshot(tmp_path: Path):
    service = LogService(tmp_path)

    snapshot = asyncio.run(service.clear("bot"))

    assert snapshot is None
    assert service.list_snapshots("bot") == []


def test_restore_brings_back_content(tmp_path: Path):
    service = LogService(tmp_path)
    service.file_for("bot").write_text("alpha\nbeta\n", encoding="utf-8")
    asyncio.run(service.clear("bot"))

    lines = asyncio.run(service.restore("bot"))

    assert "alpha" in lines[0]
    assert "beta" in lines[1]
    assert "alpha" in service.file_for("bot").read_text(encoding="utf-8")


def test_snapshot_cap_keeps_newest_ten(tmp_path: Path):
    service = LogService(tmp_path)
    for index in range(12):
        service.file_for("bot").write_text(f"entry {index}\n", encoding="utf-8")
        asyncio.run(service.clear("bot"))

    snapshots = service.list_snapshots("bot")
    assert len(snapshots) == LogService.SNAPSHOT_LIMIT == 10


def test_restore_specific_snapshot(tmp_path: Path):
    service = LogService(tmp_path)
    service.file_for("bot").write_text("first\n", encoding="utf-8")
    first = asyncio.run(service.clear("bot"))
    service.file_for("bot").write_text("second\n", encoding="utf-8")
    asyncio.run(service.clear("bot"))

    lines = asyncio.run(service.restore("bot", first["id"]))

    assert any("first" in line for line in lines)
