#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ERRORS=0

fail() {
  echo "ERREUR: $1" >&2
  ERRORS=$((ERRORS + 1))
}

ok() {
  echo "OK: $1"
}

for command in docker openssl sha256sum tar wg sysctl; do
  if command -v "$command" >/dev/null 2>&1; then
    ok "$command disponible"
  else
    fail "$command absent"
  fi
done

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose disponible"
else
  fail "Docker Compose absent"
fi

for env_file in "$INFRA_DIR/license-api/.env" "$INFRA_DIR/wireguard-hub/.env" "$SCRIPT_DIR/.env"; do
  if [ ! -f "$env_file" ]; then
    fail "$env_file absent"
  elif grep -Eq 'replace-with|remplacer-par|example' "$env_file"; then
    fail "$env_file contient encore une valeur d'exemple"
  else
    ok "$env_file configuré"
  fi
done

ROUTER_VAULT_KEY=$(sed -n 's/^ROUTER_VAULT_KEY=//p' "$INFRA_DIR/license-api/.env" 2>/dev/null | tail -n 1)
ROUTER_VAULT_KEY_BYTES=$(printf '%s' "$ROUTER_VAULT_KEY" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
if [ "$ROUTER_VAULT_KEY_BYTES" = "32" ]; then
  ok "coffre RouterOS configuré"
else
  fail "ROUTER_VAULT_KEY doit contenir 32 octets encodés en base64"
fi

TICKET_ARCHIVE_KEY=$(sed -n 's/^TICKET_ARCHIVE_KEY=//p' "$INFRA_DIR/license-api/.env" 2>/dev/null | tail -n 1)
TICKET_ARCHIVE_KEY_BYTES=$(printf '%s' "$TICKET_ARCHIVE_KEY" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
if [ "$TICKET_ARCHIVE_KEY_BYTES" = "32" ]; then
  ok "archives de réimpression chiffrées configurées"
else
  fail "TICKET_ARCHIVE_KEY doit contenir 32 octets encodés en base64"
fi

WG_CONFIG="$INFRA_DIR/wireguard-hub/wireguard/wg0.conf"
if [ ! -f "$WG_CONFIG" ]; then
  fail "$WG_CONFIG absent"
elif grep -q 'REMPLACER_' "$WG_CONFIG"; then
  fail "$WG_CONFIG contient encore une valeur d'exemple"
else
  ok "configuration WireGuard présente"
fi

WG_PUBLIC_FILE="$INFRA_DIR/wireguard-hub/wireguard/server_public.key"
WG_PUBLIC_ENV=$(sed -n 's/^HUB_SERVER_PUBLIC_KEY=//p' "$INFRA_DIR/wireguard-hub/.env" 2>/dev/null | tail -n 1)
WG_PUBLIC_DISK=$(tr -d '\r\n' < "$WG_PUBLIC_FILE" 2>/dev/null || true)
if [ -n "$WG_PUBLIC_DISK" ] && [ "$WG_PUBLIC_ENV" = "$WG_PUBLIC_DISK" ]; then
  ok "clé publique WireGuard cohérente"
else
  fail "HUB_SERVER_PUBLIC_KEY ne correspond pas à server_public.key"
fi

if [ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)" = "1" ]; then
  ok "routage IPv4 activé"
else
  fail "net.ipv4.ip_forward n'est pas activé"
fi

if docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" config --quiet; then
  ok "Compose license-api valide"
else
  fail "Compose license-api invalide"
fi

if docker compose -f "$INFRA_DIR/wireguard-hub/docker-compose.yml" \
  --project-directory "$INFRA_DIR/wireguard-hub" config --quiet; then
  ok "Compose wireguard-hub valide"
else
  fail "Compose wireguard-hub invalide"
fi

REVERSE_PROXY_MODE=$(sed -n 's/^REVERSE_PROXY_MODE=//p' "$SCRIPT_DIR/.env" 2>/dev/null | tail -n 1)
if [ "${REVERSE_PROXY_MODE:-caddy}" = "caddy" ]; then
  if docker compose -f "$SCRIPT_DIR/docker-compose.yml" \
    --project-directory "$SCRIPT_DIR" config --quiet; then
    ok "Compose reverse-proxy valide"
  else
    fail "Compose reverse-proxy invalide"
  fi
else
  ok "reverse proxy externe sélectionné"
fi

LICENSE_HUB_TOKEN=$(sed -n 's/^VPN_HUB_MASTER_TOKEN=//p' "$INFRA_DIR/license-api/.env" 2>/dev/null | tail -n 1)
WIREGUARD_HUB_TOKEN=$(sed -n 's/^HUB_MASTER_TOKEN=//p' "$INFRA_DIR/wireguard-hub/.env" 2>/dev/null | tail -n 1)
if [ -n "$LICENSE_HUB_TOKEN" ] && [ "$LICENSE_HUB_TOKEN" = "$WIREGUARD_HUB_TOKEN" ]; then
  ok "jeton interne licence/WireGuard cohérent"
else
  fail "VPN_HUB_MASTER_TOKEN doit être identique à HUB_MASTER_TOKEN"
fi

if [ "$ERRORS" -ne 0 ]; then
  echo "$ERRORS erreur(s) bloquante(s)." >&2
  exit 1
fi

echo "Pré-vérification VPS réussie."
