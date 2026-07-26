#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INFRA_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DESTINATION=${1:-"$INFRA_DIR/backups"}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE_NAME="ticketpro-vps-$TIMESTAMP.tar.gz"
WORK_DIR=$(mktemp -d)

cleanup() {
  docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
    --project-directory "$INFRA_DIR/license-api" \
    exec -T license-api rm -f /data/licenses-backup.sqlite >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "BACKUP_PASSPHRASE doit contenir une phrase secrète longue." >&2
  exit 1
fi

umask 077
mkdir -p "$DESTINATION" "$WORK_DIR/payload/license-api" "$WORK_DIR/payload/wireguard-hub" "$WORK_DIR/payload/vps"

docker compose -f "$INFRA_DIR/license-api/docker-compose.yml" \
  --project-directory "$INFRA_DIR/license-api" \
  exec -T license-api node --experimental-sqlite /app/backup-db.mjs /data/licenses-backup.sqlite

docker cp ticketpro-license-api:/data/licenses-backup.sqlite \
  "$WORK_DIR/payload/license-api/licenses.sqlite"

docker compose -f "$INFRA_DIR/wireguard-hub/docker-compose.yml" \
  --project-directory "$INFRA_DIR/wireguard-hub" \
  exec -T wireguard-hub wg-quick save wg0

cp "$INFRA_DIR/license-api/.env" "$WORK_DIR/payload/license-api/.env"
cp "$INFRA_DIR/wireguard-hub/.env" "$WORK_DIR/payload/wireguard-hub/.env"
cp "$SCRIPT_DIR/.env" "$WORK_DIR/payload/vps/.env"
cp -R "$INFRA_DIR/wireguard-hub/wireguard" "$WORK_DIR/payload/wireguard-hub/wireguard"

if [ -d "$INFRA_DIR/wireguard-hub/data" ]; then
  cp -R "$INFRA_DIR/wireguard-hub/data" "$WORK_DIR/payload/wireguard-hub/data"
else
  mkdir -p "$WORK_DIR/payload/wireguard-hub/data"
fi

(
  cd "$WORK_DIR/payload"
  find . -type f ! -name SHA256SUMS -exec sha256sum {} \; | sort > SHA256SUMS
  tar -czf "$WORK_DIR/$ARCHIVE_NAME" .
)

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 \
  -in "$WORK_DIR/$ARCHIVE_NAME" \
  -out "$DESTINATION/$ARCHIVE_NAME.enc" \
  -pass env:BACKUP_PASSPHRASE

(
  cd "$DESTINATION"
  sha256sum "$ARCHIVE_NAME.enc" > "$ARCHIVE_NAME.enc.sha256"
)

if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "BACKUP_REMOTE est défini mais rclone est absent." >&2
    exit 1
  fi
  rclone copyto "$DESTINATION/$ARCHIVE_NAME.enc" "$BACKUP_REMOTE/$ARCHIVE_NAME.enc"
  rclone copyto "$DESTINATION/$ARCHIVE_NAME.enc.sha256" "$BACKUP_REMOTE/$ARCHIVE_NAME.enc.sha256"
  echo "Copie hors site envoyée vers $BACKUP_REMOTE"
else
  echo "ATTENTION: BACKUP_REMOTE n'est pas défini ; copiez cette archive hors du VPS." >&2
fi

find "$DESTINATION" -type f -name 'ticketpro-vps-*.enc' -mtime "+${BACKUP_RETENTION_DAYS:-35}" -delete
find "$DESTINATION" -type f -name 'ticketpro-vps-*.enc.sha256' -mtime "+${BACKUP_RETENTION_DAYS:-35}" -delete
echo "Sauvegarde créée : $DESTINATION/$ARCHIVE_NAME.enc"
