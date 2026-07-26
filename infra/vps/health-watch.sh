#!/bin/sh
set -eu

for container in ticketpro-wireguard-hub ticketpro-license-api; do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)
  case "$status" in
    healthy|running)
      ;;
    *)
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $container status=$status, redémarrage" >&2
      docker restart "$container" >/dev/null
      ;;
  esac
done
