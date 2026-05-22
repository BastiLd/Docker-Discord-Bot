# ZimaOS / CasaOS App Store Package

This folder is a Store-ready starting point for the IceWhale CasaOS/ZimaOS App Store format.

Included files:

- `docker-compose.yml` with a stable app `name`, the published image `ghcr.io/bastild/docker-discord-bot:0.1.3`, `WEBUI_PORT`, `/DATA/AppData/$AppID/...` bind mounts and `x-casaos` metadata.
- `icon.png` as the required app icon.
- `screenshot-1.png` as the required proof screenshot once generated from a tested local run.

Manual ZimaOS values:

- Docker-Image: `ghcr.io/bastild/docker-discord-bot`
- Tag: `0.1.3` for a fixed release, or `main` if you want to pull the newest pushed build during private testing.
- Title: `Homelab Discord Bot Manager`
- Icon URL: `https://raw.githubusercontent.com/BastiLd/Docker-Discord-Bot/main/appstore/homelab-discord-bot-manager/icon.png`
- Web UI: `http://<zimaos-ip>:8080/`
- Network: `bridge`
- Port: container `8080`, host `8080` or another free port.
- Volumes:
  - `/DATA/AppData/homelab-discord-bot-manager/workspace` -> `/data/workspace`
  - `/DATA/AppData/homelab-discord-bot-manager/config` -> `/data/config`
  - `/DATA/AppData/homelab-discord-bot-manager/logs` -> `/data/logs`
  - `/DATA/AppData/homelab-discord-bot-manager/backups` -> `/data/backups`
  - `/DATA/AppData/homelab-discord-bot-manager/venv` -> `/data/venv`
- Environment:
  - `TZ=Europe/Vienna`
  - `APP_PORT=8080`
  - `MAX_UPLOAD_MB=128`
  - `UI_USERNAME=` optional
  - `UI_PASSWORD=` optional
  - `BACKUP_DIR=/data/backups`
  - `PUID=1000`
  - `PGID=1000`

Before submitting upstream:

1. Confirm the versioned multi-arch image exists at `ghcr.io/bastild/docker-discord-bot:0.1.3`.
2. Replace `icon.png` if you want a production-grade brand icon. The `x-casaos.icon` URL already points to this repo path.
3. Regenerate `screenshot-1.png` from your own ZimaOS/CasaOS instance after installing the final image.
4. Test the app on your own ZimaOS/CasaOS instance.
5. Open a pull request against `IceWhaleTech/CasaOS-AppStore` with this app folder.

The local project `docker-compose.yml` still supports development builds. The Store compose file must use a published immutable image tag instead of `build` or `latest`.

Current upstream notes:

- The legacy `appfile.json` is no longer required for CasaOS v0.4.4 and newer.
- `latest` must not be used for the Docker image tag.
- A PR must be tested on your own CasaOS/ZimaOS installation before submission.
