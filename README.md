# Homelab Discord Bot Manager

## Architekturuebersicht

- **Backend:** FastAPI mit Jinja2-Templates, REST-Endpunkten und WebSockets fuer Live-Logs.
- **Bot-Prozess:** Verwaltet ueber einen asynchronen Process Manager mit Start, Stop, Restart, Status, PID, Uptime und Auto-Restart bei Crash.
- **Dateiverwaltung:** Safe File Service mit Path-Traversal-Schutz, Bulk-Delete, Copy/Move, Upload, ZIP-Import, ZIP-Export und Download von Ordnern oder Auswahlen.
- **Python-Umgebung:** Persistente virtuelle Umgebung in `data/venv`; Installation von `requirements.txt` oder Einzelpaketen ueber die Weboberflaeche.
- **Self-Hosting Fokus:** Docker-/Compose-freundlich, alle nutzerrelevanten Daten in persistenten Volumes unter `data/`.

## Features

- Dashboard mit Status `running`, `stopped`, `crashed`
- PID, Uptime, Exit-Code und letzter Startbefehl
- Start, Stop, Restart aus dem Browser
- Live-Bot-Logs und System-/Task-Logs per WebSocket
- Dateimanager fuer das gesamte Bot-Arbeitsverzeichnis
- Texteditor fuer `bot.py`, `main.py`, `requirements.txt`, `.env`, JSON/YAML/Markdown usw.
- `.env`-Editor mit optional maskierter Anzeige sensibler Werte
- Safe-Konsole fuer begrenzte Einzelbefehle im Workspace
- ZIP-Upload und sicheres Entpacken mit Pfadpruefung
- Bulk-Download als ZIP fuer mehrere Dateien oder Ordner
- Persistente venv fuer Python-Abhaengigkeiten

## Ordnerstruktur

```text
.
├── app
│   ├── api
│   │   ├── __init__.py
│   │   └── routes.py
│   ├── core
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── schemas.py
│   │   └── utils.py
│   ├── services
│   │   ├── __init__.py
│   │   ├── bootstrap.py
│   │   ├── bot_manager.py
│   │   ├── env_service.py
│   │   ├── file_service.py
│   │   ├── log_service.py
│   │   ├── settings_service.py
│   │   └── task_manager.py
│   ├── static
│   │   ├── css
│   │   │   └── styles.css
│   │   └── js
│   │       └── app.js
│   ├── templates
│   │   └── index.html
│   ├── __init__.py
│   └── main.py
├── data
│   ├── backups
│   │   └── .gitkeep
│   ├── config
│   │   └── settings.json
│   ├── logs
│   │   └── .gitkeep
│   ├── venv
│   │   └── .gitkeep
│   └── workspace
│       ├── .env
│       ├── README.local.md
│       ├── bot.py
│       └── requirements.txt
├── scripts
│   └── manage_venv.py
├── .dockerignore
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── README.md
└── requirements.txt
```

## Bedienkonzept

### Dashboard

- Bot-Status mit klarer visueller Kennzeichnung
- Start-Command konfigurierbar, z. B. `python bot.py`, `python main.py` oder eigener Aufruf
- Optionaler Auto-Restart bei Crash
- Persistente venv kann per Checkbox fuer Bot und Paketinstallation genutzt werden

### Dateimanager

- Einzelne Dateien und Ordner anzeigen
- Dateien im Browser oeffnen und bearbeiten
- Einzelne Dateien / Ordner loeschen
- Mehrfachauswahl mit Bulk Delete und Bulk Download
- Eintraege umbenennen
- Mehrfachauswahl kopieren oder verschieben
- Dateien oder ZIP-Archive hochladen
- ZIP-Dateien sicher entpacken
- Ordner oder Auswahl als ZIP herunterladen

### Environment / Konfiguration

- `.env` im Browser pflegen
- Sensible Werte koennen maskiert dargestellt werden
- Aenderungen werden beim naechsten Bot-Start genutzt

### Konsole und Tasks

- `Install dependencies` fuehrt `pip install -r requirements.txt` in der persistenten venv aus
- `Install single package` installiert einzelne Pakete in dieselbe venv
- Safe-Konsole erlaubt nur definierte Einzelbefehle ohne Shell-Pipes/Umleitungen
- Task-Ausgaben werden separat erfasst und im UI angezeigt

## Deployment auf ZimaOS / Docker Compose

Kurzfassung fuer ZimaOS:

```bash
git clone <dein-repo> homelab-discord-bot-manager
cd homelab-discord-bot-manager
cp .env.example .env
docker compose up -d --build
```

Danach oeffnest du `http://<zimaos-ip>:8080`.

### 1. Projekt bereitstellen

Repository oder Dateisatz auf dem Host ablegen, z. B. in einem App- oder Docker-Ordner auf dem NAS.

### 2. Compose-Umgebung vorbereiten

```bash
cp .env.example .env
```

Dann in `.env` mindestens anpassen:

```env
APP_PORT=8080
TZ=Europe/Vienna
PUID=1000
PGID=1000
MAX_UPLOAD_MB=128
UI_USERNAME=
UI_PASSWORD=
BACKUP_DIR=/data/backups
```

Hinweise:

- `APP_PORT` ist der Web-Port deiner lokalen UI.
- `PUID` und `PGID` sollten zu deinem NAS-/ZimaOS-User passen, damit Volumes sauber beschreibbar sind.
- `BACKUP_DIR=/data/backups` sorgt dafuer, dass UI-Backups im Compose-Volume `./data/backups` landen.
- Wenn `UI_USERNAME` und `UI_PASSWORD` leer bleiben, ist die UI ohne Login erreichbar. Dann nur lokal oder hinter VPN/Reverse Proxy nutzen.

### 3. Container starten

```bash
docker compose up -d --build
```

Status pruefen:

```bash
docker compose ps
docker compose logs --tail=80
```

### 4. Weboberflaeche oeffnen

Im Browser:

```text
http://<dein-server>:8080
```

### 5. Bot deployen

1. Im Dateimanager eigenen Bot hochladen oder ZIP importieren.
2. `requirements.txt` pruefen oder anpassen.
3. Unter **Environment** den `DISCORD_TOKEN` setzen.
4. Unter **Runtime settings** Start-Command pruefen.
5. Auf **Install dependencies** klicken.
6. Danach **Start** klicken.
7. Logs kontrollieren.

## Vorbereitung fuer den ZimaOS / CasaOS App Store

Unter `appstore/homelab-discord-bot-manager/` liegt eine Compose-Vorlage im CasaOS/ZimaOS-AppStore-Stil mit `name`, `WEBUI_PORT`, `/DATA/AppData/$AppID/...`-Volumes, `icon.png`, Screenshot-Platz und `x-casaos`-Metadaten.

Vor einer offiziellen Einreichung musst du:

- ein versioniertes Image veroeffentlichen, z. B. `ghcr.io/<user>/homelab-discord-bot-manager:0.1.0`
- den Platzhalter `ghcr.io/replace-me/...` in der Store-Compose-Datei ersetzen
- `icon.png` pruefen und `screenshot-1.png` aus einer echten ZimaOS/CasaOS-Testinstallation aktualisieren
- die App auf deiner eigenen ZimaOS/CasaOS-Instanz testen
- danach einen Pull Request im IceWhale `CasaOS-AppStore` Repository erstellen

Wichtig: Der offizielle Store akzeptiert keine lokale `build:`-Compose-Datei. Fuer den Store muss ein fest getaggtes, veroeffentlichtes Docker-Image verwendet werden.
Die aktuelle IceWhale-Anleitung verlangt ausserdem mindestens `docker-compose.yml`, `icon.png` und `screenshot-1.png`; der PR muss vorab auf einer eigenen CasaOS/ZimaOS-Instanz getestet sein.

## Typische Nutzung

### Standard-Python-Bot

- `data/workspace/bot.py` nutzen oder ersetzen
- `requirements.txt` pflegen
- `.env` setzen
- Start-Command `python bot.py`

### Wenn dein Einstiegspunkt anders heisst

Beispiele:

```text
python main.py
python src/bot.py
python -m mybot
```

## Sicherheitshinweise

- Bot-Token niemals hardcoden, sondern nur ueber `.env` setzen
- Web-UI nicht ungeschuetzt ins Internet stellen
- Alle Dateizugriffe sind auf `data/workspace` beschraenkt
- ZIP-Entpacken prueft unsichere Pfade und verhindert Pfad-Ausbrueche
- Safe-Konsole blockiert triviale Shell-Injection-Muster und absolute Pfade

## Backup-Strategie

Fuer Backups reichen in der Regel diese Verzeichnisse:

- `data/workspace`
- `data/config`
- `data/backups`
- `data/logs`
- `data/venv` (optional, spart Neuinstallation der Bot-Pakete)

Empfehlung:

- `workspace` und `config` regelmaessig sichern
- `venv` optional mit sichern oder bei Bedarf neu erzeugen
- `logs` je nach Speicherplatz rotieren oder periodisch archivieren

## Entwicklung lokal ohne Docker

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Unter Windows PowerShell statt Aktivierung per Bash:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

## Anpassungen, die du typischerweise machst

- `data/workspace/bot.py` oder eigenes Bot-Projekt hochladen
- `data/workspace/requirements.txt` anpassen
- `data/workspace/.env` setzen
- Start-Command im Dashboard anpassen
- Optional `UI_USERNAME` und `UI_PASSWORD` in `.env` setzen
