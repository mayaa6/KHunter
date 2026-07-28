#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE=(docker compose)
SERVICE_NAME="khunter"
HEALTH_TIMEOUT_SECONDS="${KHUNTER_HEALTH_TIMEOUT:-90}"

usage() {
    cat <<'EOF'
Usage: ./khunter.sh <command>

Commands:
  start          Build if needed and start KHunter
  stop           Stop KHunter without deleting its data
  restart        Restart the running container, or start it if absent
  rebuild        Pull base images, rebuild, and recreate KHunter
  rebuild-clean  Rebuild without Docker's build cache, then recreate KHunter
  status         Show container status
  logs           Follow application logs
  help           Show this help
EOF
}

fail() {
    echo "Error: $*" >&2
    exit 1
}

check_docker() {
    command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
    docker compose version >/dev/null 2>&1 ||
        fail "Docker Compose is unavailable. Install Docker Desktop or the Compose plugin."
    docker info >/dev/null 2>&1 ||
        fail "Docker is not running. Start Docker Desktop or the Docker daemon."
}

ensure_env() {
    if [[ ! -f .env ]]; then
        cp .env.example .env
        echo "Created .env from .env.example"
    fi
}

container_id() {
    "${COMPOSE[@]}" ps --all -q "$SERVICE_NAME"
}

wait_until_healthy() {
    local id health_state elapsed
    elapsed=0

    while (( elapsed < HEALTH_TIMEOUT_SECONDS )); do
        id="$(container_id)"
        if [[ -n "$id" ]]; then
            health_state="$(docker inspect \
                --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
                "$id" 2>/dev/null || true)"

            case "$health_state" in
                healthy|running)
                    echo "KHunter is $health_state."
                    return 0
                    ;;
                unhealthy|exited|dead)
                    "${COMPOSE[@]}" logs --tail=80 "$SERVICE_NAME"
                    fail "KHunter entered state: $health_state"
                    ;;
            esac
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    "${COMPOSE[@]}" logs --tail=80 "$SERVICE_NAME"
    fail "KHunter did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s."
}

show_url() {
    local published
    published="$("${COMPOSE[@]}" port "$SERVICE_NAME" 5001 2>/dev/null || true)"
    if [[ -n "$published" ]]; then
        published="${published/0.0.0.0/127.0.0.1}"
        echo "Open: http://${published}"
    fi
}

start_service() {
    ensure_env
    if docker image inspect khunter:local >/dev/null 2>&1; then
        "${COMPOSE[@]}" up -d --no-build
    else
        "${COMPOSE[@]}" up -d --build
    fi
    wait_until_healthy
    show_url
}

stop_service() {
    "${COMPOSE[@]}" stop
    echo "KHunter stopped. Persistent volumes were preserved."
}

restart_service() {
    ensure_env
    if [[ -n "$(container_id)" ]]; then
        "${COMPOSE[@]}" restart "$SERVICE_NAME"
        wait_until_healthy
        show_url
    else
        start_service
    fi
}

rebuild_service() {
    local cache_flag="${1:-}"
    ensure_env
    if [[ "$cache_flag" == "--no-cache" ]]; then
        "${COMPOSE[@]}" build --pull --no-cache "$SERVICE_NAME"
    else
        "${COMPOSE[@]}" build --pull "$SERVICE_NAME"
    fi
    "${COMPOSE[@]}" up -d --force-recreate --no-build
    wait_until_healthy
    show_url
}

main() {
    local command="${1:-help}"

    case "$command" in
        help|-h|--help)
            usage
            return 0
            ;;
    esac

    check_docker

    case "$command" in
        start)
            start_service
            ;;
        stop)
            stop_service
            ;;
        restart)
            restart_service
            ;;
        rebuild)
            rebuild_service
            ;;
        rebuild-clean)
            rebuild_service --no-cache
            ;;
        status)
            "${COMPOSE[@]}" ps --all
            ;;
        logs)
            "${COMPOSE[@]}" logs -f --tail=100 "$SERVICE_NAME"
            ;;
        *)
            usage
            fail "Unknown command: $command"
            ;;
    esac
}

main "$@"
