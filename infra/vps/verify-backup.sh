#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage : BACKUP_PASSPHRASE_FILE=/chemin ./verify-backup.sh sauvegarde.tar.gz.enc" >&2
  exit 1
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ] && [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  BACKUP_PASSPHRASE=$(cat "$BACKUP_PASSPHRASE_FILE")
  export BACKUP_PASSPHRASE
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "BACKUP_PASSPHRASE ou BACKUP_PASSPHRASE_FILE est requis." >&2
  exit 1
fi

ARCHIVE_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)
ARCHIVE="$ARCHIVE_DIRECTORY/$(basename -- "$1")"
if [ ! -f "$ARCHIVE" ]; then
  echo "Archive introuvable : $ARCHIVE" >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
case "$WORK_DIR" in
  /tmp/*|/var/tmp/*) ;;
  *) echo "Répertoire temporaire refusé : $WORK_DIR" >&2; exit 1 ;;
esac

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT INT TERM

umask 077
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$ARCHIVE" \
  -out "$WORK_DIR/backup.tar.gz" \
  -pass env:BACKUP_PASSPHRASE

if tar -tzf "$WORK_DIR/backup.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Archive refusée : chemin non sûr détecté." >&2
  exit 1
fi

mkdir -p "$WORK_DIR/payload"
tar -xzf "$WORK_DIR/backup.tar.gz" -C "$WORK_DIR/payload"

for required_file in \
  SHA256SUMS \
  license-api/licenses.sqlite \
  license-api/.env \
  wireguard-hub/.env \
  wireguard-hub/wireguard/wg0.conf \
  vps/.env
do
  if [ ! -f "$WORK_DIR/payload/$required_file" ]; then
    echo "Sauvegarde incomplète : $required_file est absent." >&2
    exit 1
  fi
done

(
  cd "$WORK_DIR/payload"
  sha256sum -c SHA256SUMS
)

echo "Sauvegarde lisible et checksums valides : $(basename -- "$ARCHIVE")"
