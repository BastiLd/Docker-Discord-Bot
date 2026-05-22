# ZimaOS Installation

This project publishes Docker images to:

```text
ghcr.io/bastild/docker-discord-bot
```

Use one of these tags:

- `0.1.1` for the fixed app-store style version.
- `main` for private testing where you want to pull the newest build after every push to `main`.

## Add It In The ZimaOS UI

In the custom app screen, enter:

```text
Docker-Image: ghcr.io/bastild/docker-discord-bot
Tag: 0.1.1
Titel: Homelab Discord Bot Manager
Icon URL: https://raw.githubusercontent.com/BastiLd/Docker-Discord-Bot/main/appstore/homelab-discord-bot-manager/icon.png
Web UI protocol: http://
Web UI port: 8080
Web UI path: /
Netzwerk: bridge
Neustartrichtlinie: unless-stopped
Containername: homelab-discord-bot-manager
```

If port `8080` is already used on your ZimaOS host, keep container port `8080` and change only the host port, for example to `18080`.

## Ports

Add one port mapping:

```text
Host: 8080
Container: 8080
Protocol: TCP
```

## Storage

Add these volume mappings:

```text
/DATA/AppData/homelab-discord-bot-manager/workspace -> /data/workspace
/DATA/AppData/homelab-discord-bot-manager/config    -> /data/config
/DATA/AppData/homelab-discord-bot-manager/logs      -> /data/logs
/DATA/AppData/homelab-discord-bot-manager/backups   -> /data/backups
/DATA/AppData/homelab-discord-bot-manager/venv      -> /data/venv
```

## Environment Variables

Add these environment variables:

```text
APP_PORT=8080
TZ=Europe/Vienna
MAX_UPLOAD_MB=128
BACKUP_DIR=/data/backups
PUID=1000
PGID=1000
UI_USERNAME=
UI_PASSWORD=
```

Leave `UI_USERNAME` and `UI_PASSWORD` empty only if the app is reachable from your private network/VPN. Set both if the UI is exposed anywhere else.

## Alternative: Import Compose

You can also import this file in ZimaOS/CasaOS if your UI supports Compose import:

```text
appstore/homelab-discord-bot-manager/docker-compose.yml
```

## Updating Later

There are two different update types:

- **Bot repo updates**: your own Discord bot code inside a server profile.
- **Manager app updates**: this Docker image and web panel.

### Bot Repo Updates

Open the manager, choose the correct server profile, then open `Startup`.

1. Enter a public GitHub repo URL, for example `https://github.com/your-name/your-bot`.
2. Enter the branch for this ZimaOS server, for example `server-prod`.
3. Keep `Install requirements after import/update` enabled if the repo has `requirements.txt`.
4. Keep `Restart bot after update` enabled if the bot should come back online automatically.
5. Click `Import repo` the first time. The app creates a backup, stops the bot if needed, replaces the workspace with the selected branch and installs dependencies.
6. Later click `Check update`. If a new commit exists, click `Update now`.

`Auto-update this bot` is optional and off by default. If enabled, the manager checks the selected branch periodically and updates that one server profile only.

Recommended workflow:

```text
main        -> local testing
server-prod -> branch selected in ZimaOS
```

### Manager App Updates

For manager app code changes:

1. Change the files.
2. Commit and push to `main`.
3. Wait for the GitHub Actions workflow `Docker Image` to finish.
4. In ZimaOS, recreate/update the app and pull the same tag again.

If you use tag `main`, the tag moves after every successful workflow run. If you use tag `0.1.1`, bump the version in `.github/workflows/docker-image.yml` and `appstore/homelab-discord-bot-manager/docker-compose.yml` when you want a real release.

The manager also has an update hint in `Settings`. It only shows the current and latest available image tag. It does not update its own Docker container from inside the container.

For icon-only changes:

1. Replace `appstore/homelab-discord-bot-manager/icon.png`.
2. Commit and push.
3. In ZimaOS, refresh/reopen the app settings. If the old icon is cached, add a cache suffix to the icon URL temporarily, for example:

```text
https://raw.githubusercontent.com/BastiLd/Docker-Discord-Bot/main/appstore/homelab-discord-bot-manager/icon.png?v=2
```

The icon URL does not require a new Docker image unless the icon is also copied into the app itself.

## GHCR Visibility

After the first GitHub Actions image build, GitHub may create the package as private. If ZimaOS cannot pull the image:

1. Open GitHub repo `BastiLd/Docker-Discord-Bot`.
2. Open `Packages`.
3. Open `docker-discord-bot`.
4. Go to package settings.
5. Change visibility to public.
