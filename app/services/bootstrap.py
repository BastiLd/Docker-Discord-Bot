from __future__ import annotations

from pathlib import Path


SAMPLE_BOT = """import os
import discord
from discord.ext import commands


TOKEN = os.getenv("DISCORD_TOKEN", "")
PREFIX = os.getenv("COMMAND_PREFIX", "!")

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents)


@bot.event
async def on_ready():
    print(f"Bot ready: {bot.user} (guilds={len(bot.guilds)})")


@bot.command()
async def ping(ctx: commands.Context):
    await ctx.send("Pong from your homelab bot manager.")


if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN fehlt. Bitte zuerst in der Web-UI oder .env setzen.")

bot.run(TOKEN)
"""

SAMPLE_REQUIREMENTS = """discord.py>=2.4,<3.0
"""

SAMPLE_ENV = """DISCORD_TOKEN=replace_me
COMMAND_PREFIX=!
"""

SAMPLE_README = """# Workspace

Dieses Verzeichnis enthält den eigentlichen Bot-Code.

Empfohlener Ablauf:
1. `bot.py`, `requirements.txt` und `.env` anpassen.
2. In der Web-UI auf `Install dependencies` klicken.
3. Startbefehl prüfen, z. B. `python bot.py`.
4. Bot starten und Logs kontrollieren.
"""


def seed_workspace_if_empty(workspace_dir: Path) -> None:
    if any(workspace_dir.iterdir()):
        return

    (workspace_dir / "bot.py").write_text(SAMPLE_BOT, encoding="utf-8")
    (workspace_dir / "requirements.txt").write_text(SAMPLE_REQUIREMENTS, encoding="utf-8")
    (workspace_dir / ".env").write_text(SAMPLE_ENV, encoding="utf-8")
    (workspace_dir / "README.local.md").write_text(SAMPLE_README, encoding="utf-8")
