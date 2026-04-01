import os
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
