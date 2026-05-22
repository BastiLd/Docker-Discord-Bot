FROM python:3.12-slim

ARG APP_VERSION=0.1.7
ARG APP_IMAGE_TAG=0.1.7
ARG APP_BUILD_SHA=unknown

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_VERSION=${APP_VERSION} \
    APP_IMAGE_TAG=${APP_IMAGE_TAG} \
    APP_BUILD_SHA=${APP_BUILD_SHA} \
    APP_HOST=0.0.0.0 \
    APP_PORT=8080 \
    WORKSPACE_DIR=/data/workspace \
    CONFIG_DIR=/data/config \
    LOG_DIR=/data/logs \
    BACKUP_DIR=/data/backups \
    VENV_DIR=/data/venv

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY README.md ./README.md

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
