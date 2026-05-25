"""Tests for parsing commit URLs/SHAs in GitDeployService."""
from __future__ import annotations

import pytest

from app.services.git_deploy_service import GitDeployService


def test_accepts_full_sha():
    sha = "0123456789abcdef0123456789abcdef01234567"
    assert GitDeployService._parse_commit_input(sha) == sha


def test_accepts_short_sha():
    assert GitDeployService._parse_commit_input("deadbeef") == "deadbeef"


def test_accepts_github_commit_url():
    url = "https://github.com/BastiLd/Docker-Discord-Bot/commit/abcdef1234567890"
    assert GitDeployService._parse_commit_input(url) == "abcdef1234567890"


def test_strips_query_and_fragment():
    url = "https://github.com/foo/bar/commit/abcdef12?diff=split#anchor"
    assert GitDeployService._parse_commit_input(url) == "abcdef12"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        "not a sha",
        "ZZZZZZZZ",
        "abc",  # too short
        "a" * 41,  # too long
        "https://example.com/foo",
        "https://github.com/foo/bar",
    ],
)
def test_rejects_invalid_input(bad):
    with pytest.raises(ValueError):
        GitDeployService._parse_commit_input(bad)
