# syntax=docker/dockerfile:1.7
FROM ghcr.io/astral-sh/uv:0.11.32 AS uv

FROM python:3.11-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    MPLCONFIGDIR=/app/data/matplotlib \
    TZ=Asia/Hong_Kong

WORKDIR /app

COPY --chown=10001:10001 --from=builder /app/.venv /app/.venv
COPY --chown=10001:10001 . .

RUN mkdir -p /app/data /app/logs /app/config /app/reports \
    && chown 10001:10001 /app/data /app/logs /app/config /app/reports

USER 10001:10001

EXPOSE 5001

VOLUME ["/app/data", "/app/logs", "/app/config", "/app/reports"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/healthz', timeout=3)"]

ENTRYPOINT ["python", "docker_entrypoint.py"]
CMD ["gunicorn", "--config", "gunicorn.conf.py", "web_server:app"]
