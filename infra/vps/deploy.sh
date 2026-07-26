#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

"$SCRIPT_DIR/preflight.sh"

docker compose -f "$INFRA_DIR/wireguard-hub/docker-compose.yml" \
  --project-directory "$INFRA_DIR/wireguard-hub" up -d --build
docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" up -d --build
docker compose -f "$SCRIPT_DIR/docker-compose.yml" \
  --project-directory "$SCRIPT_DIR" up -d

wait_healthy() {
  container=$1
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      echo "OK: $container ($status)"
      return
    fi
    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ]; then
      docker logs --tail 100 "$container" >&2 || true
      echo "Échec du démarrage de $container ($status)." >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  echo "Délai dépassé pour $container." >&2
  exit 1
}

wait_healthy ticketpro-wireguard-hub
wait_healthy ticketpro-license-api
wait_healthy ticketpro-reverse-proxy

echo "Déploiement TicketPro terminé."
