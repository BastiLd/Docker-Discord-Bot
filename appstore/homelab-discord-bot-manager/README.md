# ZimaOS / CasaOS App Store Package

This folder is a Store-ready starting point for the IceWhale CasaOS/ZimaOS App Store format.

Included files:

- `docker-compose.yml` with a stable app `name`, a fixed placeholder image tag, `WEBUI_PORT`, `/DATA/AppData/$AppID/...` bind mounts and `x-casaos` metadata.
- `icon.png` as the required app icon.
- `screenshot-1.png` as the required proof screenshot once generated from a tested local run.

Before submitting upstream:

1. Publish a versioned multi-arch image and replace `ghcr.io/replace-me/homelab-discord-bot-manager:0.1.0`.
2. Replace `icon.png` if you want a production-grade brand icon and update the `x-casaos.icon` URL.
3. Regenerate `screenshot-1.png` from your own ZimaOS/CasaOS instance after installing the final image.
4. Test the app on your own ZimaOS/CasaOS instance.
5. Open a pull request against `IceWhaleTech/CasaOS-AppStore` with this app folder.

The local project `docker-compose.yml` still supports development builds. The Store compose file must use a published immutable image tag instead of `build` or `latest`.

Current upstream notes:

- The legacy `appfile.json` is no longer required for CasaOS v0.4.4 and newer.
- `latest` must not be used for the Docker image tag.
- A PR must be tested on your own CasaOS/ZimaOS installation before submission.
