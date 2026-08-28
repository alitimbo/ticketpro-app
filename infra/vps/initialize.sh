#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

required() {
  name=$1
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "$name est requis." >&2
    exit 1
  fi
}

for name in API_DOMAIN VPN_PUBLIC_ENDPOINT; do
  required "$name"
done

IPAY_ENV=${IPAY_ENV:-disabled}
if [ "$IPAY_ENV" != "disabled" ]; then
  for name in IPAY_PUBLIC_KEY IPAY_PRIVATE_KEY IPAY_SECRET_HASH; do
    required "$name"
  done
fi

if [ -e "$INFRA_DIR/license-api/.env" ] || [ -e "$INFRA_DIR/wireguard-hub/.env" ] || [ -e "$SCRIPT_DIR/.env" ]; then
  echo "Initialisation refusée : un fichier .env existe déjà. Conservez les secrets en place." >&2
  exit 1
fi

if ! printf '%s' "$API_DOMAIN" | grep -Eq '^[a-zA-Z0-9.-]+$'; then
  echo "API_DOMAIN invalide." >&2
  exit 1
fi
if ! printf '%s' "$VPN_PUBLIC_ENDPOINT" | grep -Eq '^[a-zA-Z0-9.-]+$'; then
  echo "VPN_PUBLIC_ENDPOINT invalide." >&2
  exit 1
fi

umask 077
mkdir -p "$INFRA_DIR/wireguard-hub/wireguard" "$INFRA_DIR/wireguard-hub/data"
mkdir -p "${TICKETPRO_RELEASES_DIR:-/opt/ticketpro/releases}"

WG_PRIVATE_KEY=$(wg genkey)
WG_PUBLIC_KEY=$(printf '%s' "$WG_PRIVATE_KEY" | wg pubkey)
HUB_MASTER_TOKEN=$(openssl rand -hex 32)
LICENSE_MASTER_TOKEN=$(openssl rand -hex 32)
LICENSE_HASH_SECRET=$(openssl rand -hex 48)
ROUTER_VAULT_KEY=$(openssl rand -base64 32 | tr -d '\n')

printf '%s\n' "$WG_PRIVATE_KEY" > "$INFRA_DIR/wireguard-hub/wireguard/server_private.key"
printf '%s\n' "$WG_PUBLIC_KEY" > "$INFRA_DIR/wireguard-hub/wireguard/server_public.key"

{
  echo "[Interface]"
  echo "Address = 10.250.0.1/16"
  echo "ListenPort = 51820"
  echo "PrivateKey = $WG_PRIVATE_KEY"
  echo "SaveConfig = true"
} > "$INFRA_DIR/wireguard-hub/wireguard/wg0.conf"

{
  echo "HUB_MASTER_TOKEN=$HUB_MASTER_TOKEN"
  echo "HUB_PORT=8788"
  echo "HUB_ALLOWED_ORIGIN=null"
  echo "HUB_PUBLIC_ENDPOINT=$VPN_PUBLIC_ENDPOINT"
  echo "HUB_SERVER_PUBLIC_KEY=$WG_PUBLIC_KEY"
  echo "HUB_SERVER_PORT=51820"
  echo "HUB_SUPERNET=10.250.0.0/16"
  echo "HUB_TENANT_PREFIX=24"
} > "$INFRA_DIR/wireguard-hub/.env"

{
  echo "LICENSE_BIND=127.0.0.1"
  echo "LICENSE_PORT=8787"
  echo "LICENSE_DB=/data/licenses.sqlite"
  echo "APP_UPDATE_MANIFEST_PATH=/data/app-updates/stable.json"
  echo "LICENSE_MASTER_TOKEN=$LICENSE_MASTER_TOKEN"
  echo "LICENSE_HASH_SECRET=$LICENSE_HASH_SECRET"
  echo "ROUTER_VAULT_KEY=$ROUTER_VAULT_KEY"
  echo "LICENSE_DEFAULT_ADMIN_PASSWORD=${LICENSE_DEFAULT_ADMIN_PASSWORD:-admin123}"
  echo "IPAY_BASE_URL=${IPAY_BASE_URL:-https://api.i-pay.money}"
  echo "IPAY_ENV=$IPAY_ENV"
  echo "IPAY_PUBLIC_KEY=${IPAY_PUBLIC_KEY:-}"
  echo "IPAY_PRIVATE_KEY=${IPAY_PRIVATE_KEY:-}"
  echo "IPAY_SECRET_HASH=${IPAY_SECRET_HASH:-}"
  echo "SAAS_PASSWORD_RESET_URL=${SAAS_PASSWORD_RESET_URL:-https://www.ticketpro-ne.com/reset-password}"
  echo "SAAS_INVITATION_URL=${SAAS_INVITATION_URL:-https://www.ticketpro-ne.com/accept-invitation}"
  echo "SAAS_SUBSCRIPTION_URL=${SAAS_SUBSCRIPTION_URL:-https://www.ticketpro-ne.com/}"
  echo "LICENSE_CORS_ORIGIN=${LICENSE_CORS_ORIGIN:-http://tauri.localhost,http://localhost:1420,http://localhost:4321,http://127.0.0.1:4321,http://localhost:4322,http://127.0.0.1:4322,https://ticketpro-ne.com,https://www.ticketpro-ne.com}"
  echo "VPN_HUB_URL=http://127.0.0.1:8788"
  echo "VPN_CLIENT_ALLOWED_IPS=10.250.0.0/16"
  echo "VPN_HUB_MASTER_TOKEN=$HUB_MASTER_TOKEN"
} > "$INFRA_DIR/license-api/.env"

{
  printf 'API_DOMAIN=%s\n' "$API_DOMAIN"
  printf 'REVERSE_PROXY_MODE=%s\n' "${REVERSE_PROXY_MODE:-caddy}"
  printf 'TICKETPRO_RELEASES_DIR=%s\n' "${TICKETPRO_RELEASES_DIR:-/opt/ticketpro/releases}"
  printf 'TICKETPRO_LATEST_WINDOWS_SETUP=%s\n' "${TICKETPRO_LATEST_WINDOWS_SETUP:-TicketPro-Setup-unpublished-x64.exe}"
} > "$SCRIPT_DIR/.env"

chmod 600 \
  "$INFRA_DIR/license-api/.env" \
  "$INFRA_DIR/wireguard-hub/.env" \
  "$INFRA_DIR/wireguard-hub/wireguard/server_private.key" \
  "$INFRA_DIR/wireguard-hub/wireguard/wg0.conf" \
  "$SCRIPT_DIR/.env"

echo "Initialisation terminée."
echo "Domaine API : $API_DOMAIN"
echo "Endpoint WireGuard : $VPN_PUBLIC_ENDPOINT:51820"
echo "Clé publique WireGuard : $WG_PUBLIC_KEY"
echo "Les secrets ont été écrits avec des permissions 600 et ne sont pas affichés."
