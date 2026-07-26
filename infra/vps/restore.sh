#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage : BACKUP_PASSPHRASE='...' ./restore.sh sauvegarde.tar.gz.enc" >&2
  exit 1
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "BACKUP_PASSPHRASE doit contenir la phrase secrète de la sauvegarde." >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ARCHIVE=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
WORK_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

umask 077
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$ARCHIVE" \
  -out "$WORK_DIR/backup.tar.gz" \
  -pass env:BACKUP_PASSPHRASE

mkdir -p "$WORK_DIR/payload"
if tar -tzf "$WORK_DIR/backup.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Archive refusée : chemin non sûr détecté." >&2
  exit 1
fi
tar -xzf "$WORK_DIR/backup.tar.gz" -C "$WORK_DIR/payload"
(
  cd "$WORK_DIR/payload"
  sha256sum -c SHA256SUMS
)

docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" down
docker compose -f "$INFRA_DIR/wireguard-hub/docker-compose.yml" \
  --project-directory "$INFRA_DIR/wireguard-hub" down
docker compose -f "$SCRIPT_DIR/docker-compose.yml" \
  --project-directory "$SCRIPT_DIR" down

mkdir -p "$INFRA_DIR/wireguard-hub/wireguard" "$INFRA_DIR/wireguard-hub/data"
cp "$WORK_DIR/payload/license-api/.env" "$INFRA_DIR/license-api/.env"
cp "$WORK_DIR/payload/wireguard-hub/.env" "$INFRA_DIR/wireguard-hub/.env"
cp "$WORK_DIR/payload/vps/.env" "$SCRIPT_DIR/.env"
cp -R "$WORK_DIR/payload/wireguard-hub/wireguard/." "$INFRA_DIR/wireguard-hub/wireguard/"
cp -R "$WORK_DIR/payload/wireguard-hub/data/." "$INFRA_DIR/wireguard-hub/data/"

docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" build license-api
docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" \
  run --rm --no-deps --entrypoint sh license-api \
  -c 'rm -f /data/licenses.sqlite /data/licenses.sqlite-wal /data/licenses.sqlite-shm'
docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" create license-api
docker cp "$WORK_DIR/payload/license-api/licenses.sqlite" \
  ticketpro-license-api:/data/licenses.sqlite

docker compose -f "$INFRA_DIR/wireguard-hub/docker-compose.yml" \
  --project-directory "$INFRA_DIR/wireguard-hub" up -d --build
docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" up -d --build
docker compose -f "$SCRIPT_DIR/docker-compose.yml" \
  --project-directory "$SCRIPT_DIR" up -d

echo "Restauration terminée. Vérifier maintenant les healthchecks et le domaine HTTPS."
