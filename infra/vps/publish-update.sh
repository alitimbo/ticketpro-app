#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "Utilisation : $0 <setup.exe> <setup.exe.sig> <stable.json>" >&2
  exit 1
fi

INSTALLER=$1
SIGNATURE=$2
MANIFEST=$3
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASES_DIR=$(sed -n 's/^TICKETPRO_RELEASES_DIR=//p' "$SCRIPT_DIR/.env" 2>/dev/null | tail -n 1)
RELEASES_DIR=${RELEASES_DIR:-/opt/ticketpro/releases}

for file in "$INSTALLER" "$SIGNATURE" "$MANIFEST"; do
  if [ ! -f "$file" ]; then
    echo "Fichier introuvable : $file" >&2
    exit 1
  fi
done

install -d -m 755 "$RELEASES_DIR"
install -m 644 "$INSTALLER" "$RELEASES_DIR/$(basename "$INSTALLER")"
install -m 644 "$SIGNATURE" "$RELEASES_DIR/$(basename "$SIGNATURE")"
docker exec ticketpro-license-api mkdir -p /data/app-updates
docker cp "$MANIFEST" ticketpro-license-api:/data/app-updates/stable.json

echo "Mise à jour publiée."
echo "Installateur : $RELEASES_DIR/$(basename "$INSTALLER")"
echo "Manifeste : /data/app-updates/stable.json"

